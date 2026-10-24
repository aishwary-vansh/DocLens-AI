from __future__ import annotations

import logging
import math
import os
from typing import List, Optional

from langchain_core.documents import Document as LCDocument
from langchain_core.retrievers import BaseRetriever
from langchain_core.callbacks import CallbackManagerForRetrieverRun
from pydantic import model_validator

from .query_router import QueryRoute, route_query, section_boost

logger = logging.getLogger(__name__)
RRF_K = 60
# Candidates sent to the cross-encoder. On CPU the reranker dominates /ask
# latency (about 1.2-1.7 s per pair-batch of 40 measured on a laptop), so the
# pool is small and reranking runs once per request, not once per facet.
RERANK_CANDIDATES = int(os.getenv("RERANK_CANDIDATES", "20"))
# Cross-encoder pairs one multi-paper task (compare / review / gaps) may score
# in total. balanced_retrieve reranks once per paper, so without a budget a
# 20-paper review scores 20 x 20 pairs (~1.1 s each on CPU, measured) and
# outlives every timeout.
SYNTHESIS_RERANK_BUDGET = int(os.getenv("SYNTHESIS_RERANK_BUDGET", "60"))


def _sigmoid_score(value: float) -> float:
    try:
        return 1.0 / (1.0 + math.exp(-float(value)))
    except OverflowError:
        return 0.0 if value < 0 else 1.0


def reciprocal_rank_fusion(candidates: List[dict], top_k: int) -> List[dict]:
    """Fuse independent semantic/keyword candidates without losing provenance."""
    fused: dict[str, dict] = {}
    for candidate in candidates:
        chunk_id = candidate.get("id")
        if not chunk_id:
            continue
        entry = fused.setdefault(chunk_id, {**candidate, "rrf_score": 0.0, "retrieval_sources": []})
        rank = int(candidate.get("retrievalRank", 0))
        if rank > 0:
            entry["rrf_score"] += 1.0 / (RRF_K + rank)
        similarity = candidate.get("similarity")
        if similarity is not None and (entry.get("similarity") is None or similarity > entry["similarity"]):
            entry["similarity"] = similarity
        source = candidate.get("retrievalSource")
        if source and source not in entry["retrieval_sources"]:
            entry["retrieval_sources"].append(source)
    return sorted(
        fused.values(),
        key=lambda item: item["rrf_score"],
        reverse=True,
    )[:top_k]


def top_scores(chunks: List[dict]) -> dict:
    """Best dense cosine and best cross-encoder score among retrieved chunks.
    `top_rerank` is None when the reranker did not run (RERANKER_ENABLED=false
    or a pool too small to rerank): normalised RRF is relative, not a relevance."""
    sims = [c["similarity"] for c in chunks if c.get("similarity") is not None]
    reranked = [c["rerank_score"] for c in chunks if c.get("reranked")]
    return {
        "top_similarity": round(max(sims), 4) if sims else None,
        "top_rerank": round(max(reranked), 4) if reranked else None,
    }


class DocLensRetriever(BaseRetriever):
    """
    LangChain BaseRetriever backed by the existing PostgreSQL RRF hybrid search.

    This retriever does NOT use LangChain's built-in PGVector — it wraps the
    hand-tuned RRF SQL in pg_store.py so nothing about retrieval changes.

    After retrieval the BGE reranker is applied to re-score results.
    """

    collection_id: Optional[str] = None
    document_ids: Optional[List[str]] = None
    top_k: int = 10
    rerank_top_k: int = RERANK_CANDIDATES  # candidates to fetch before reranking
    max_per_document: Optional[int] = None  # cap so one paper cannot crowd out the rest

    # Non-pydantic fields injected after construction
    _pg_store: object = None          # type: ignore[assignment]
    _embed_model: object = None       # type: ignore[assignment]
    _reranker: object = None          # type: ignore[assignment]
    _embedding_model: Optional[str] = None

    class Config:
        arbitrary_types_allowed = True

    @classmethod
    def create(
        cls,
        collection_id: Optional[str] = None,
        document_ids: Optional[List[str]] = None,
        top_k: int = 10,
        max_per_document: Optional[int] = None,
    ) -> "DocLensRetriever":
        """
        Factory that lazily imports heavy models to avoid importing at module
        load time (which would slow down startup and fail if CUDA is absent).
        """
        # Import here to keep module-level imports lightweight
        from vector_store.pg_store import pg_store
        import ingest
        from ingest import get_model, get_reranker

        instance = cls(
            collection_id=collection_id,
            document_ids=document_ids,
            top_k=top_k,
            max_per_document=max_per_document,
        )
        instance._pg_store   = pg_store
        instance._embed_model = get_model()
        instance._reranker    = get_reranker()
        instance._embedding_model = getattr(ingest, "EMBEDDING_MODEL", None)
        return instance

    # ── LangChain required method ─────────────────────────────────────────

    def _get_relevant_documents(
        self,
        query: str,
        *,
        run_manager: CallbackManagerForRetrieverRun,
    ) -> List[LCDocument]:
        """
        Routed hybrid retrieval (see retrieve_chunks), returned as LangChain
        Documents with full metadata.
        """
        logger.info(
            "DocLensRetriever: fetching candidates — collection=%s doc_ids=%s top_k=%d",
            self.collection_id,
            self.document_ids,
            self.top_k,
        )

        candidates = self.retrieve_chunks(query)
        logger.info("DocLensRetriever: returning %d reranked chunks", len(candidates))

        docs = []
        for chunk in candidates:
            docs.append(
                LCDocument(
                    page_content=chunk["content"],
                    metadata={
                        "chunk_id":      chunk["id"],
                        "document_id":   chunk["documentId"],
                        "document_title": chunk.get("documentTitle", ""),
                        "page_number":   chunk.get("pageNumber"),
                        "chunk_index":   chunk.get("chunkIndex"),
                        "content_type":  chunk.get("metadata", {}).get("content_type", "page_text"),
                        "section":        chunk.get("metadata", {}).get("section", ""),
                        "section_type":   chunk.get("metadata", {}).get("section_type", ""),
                        "metadata":       chunk.get("metadata", {}),
                        "score":         chunk["score"],
                        "rrf_score":     chunk.get("rrf_score", 0.0),
                        "retrieval_sources": chunk.get("retrieval_sources", []),
                    },
                )
            )
        return docs

    # ── Raw-chunk API used by synthesis tasks ─────────────────────────────

    def retrieve_chunks(
        self,
        query: str,
        route: Optional[QueryRoute] = None,
        document_ids: Optional[List[str]] = None,
        top_k: Optional[int] = None,
    ) -> List[dict]:
        """
        1. Route the query (section boosts, excluded content types)
        2. Embed with BAAI/bge-m3; semantic + OR-keyword candidates from pgvector
        3. Reciprocal Rank Fusion
        4. BGE cross-encoder rerank + section-intent boost
        5. Optional per-document cap for multi-paper diversity
        """
        route = route or route_query(query)
        doc_filter = document_ids if document_ids is not None else self.document_ids
        return self.rerank(query, self.candidates(query, route, doc_filter), route, top_k or self.top_k)

    def candidates(self, query: str, route: QueryRoute, doc_filter: Optional[List[str]]) -> List[dict]:
        """Raw semantic + keyword candidates (with ranks) for one query, before fusion."""
        query_embedding = self._embed_model.encode(query, normalize_embeddings=True).tolist()
        return self._pg_store.hybrid_search(
            query,
            query_embedding,
            self.collection_id,
            doc_filter,
            top_k=self.rerank_top_k,
            exclude_content_types=route.exclude_content_types,
            embedding_model=self._embedding_model,
        )

    def rerank(self, query: str, raw: List[dict], route: QueryRoute, top_k: int,
               pool: Optional[int] = None) -> List[dict]:
        """RRF over every candidate list in `raw`, then one cross-encoder pass over
        the top `pool` (default rerank_top_k). When the pool is no larger than
        what is returned, the cross-encoder could only reorder, so it is skipped."""
        pool = pool or self.rerank_top_k
        candidates = reciprocal_rank_fusion(raw, pool)
        if not candidates:
            logger.warning("DocLensRetriever: no candidates returned from RRF search")
            return []

        if self._reranker is None or (pool < self.rerank_top_k and len(candidates) <= top_k):
            # RERANKER_ENABLED=false: normalised RRF stands in for the reranker score.
            top = max(c["rrf_score"] for c in candidates) or 1.0
            scores = [c["rrf_score"] / top for c in candidates]
            reranked = False
        else:
            scores = [_sigmoid_score(float(x)) for x in self._reranker.predict([[query, c["content"]] for c in candidates])]
            reranked = True
        for chunk, score in zip(candidates, scores):
            chunk["rerank_score"] = score
            chunk["reranked"] = reranked
            chunk["score"] = min(1.0, score + section_boost(route, chunk.get("metadata", {})))
        candidates.sort(key=lambda x: x["score"], reverse=True)
        return cap_per_document(candidates, top_k, self.max_per_document)

    def retrieve_multi(
        self, queries: List[str], rerank_query: str, route: QueryRoute, top_k: int,
        document_ids: Optional[List[str]] = None, pool: Optional[int] = None,
    ) -> List[dict]:
        """Retrieve for several query variants, fuse them, and rerank the union once."""
        doc_filter = document_ids if document_ids is not None else self.document_ids
        raw = [c for q in queries for c in self.candidates(q, route, doc_filter)]
        return self.rerank(rerank_query, raw, route, top_k, pool=pool)

    def balanced_retrieve(
        self,
        queries: List[str],
        document_ids: List[str],
        per_document: int = 3,
        route: Optional[QueryRoute] = None,
        rerank_query: Optional[str] = None,
        pair_budget: Optional[int] = None,
    ) -> List[dict]:
        """Retrieve `per_document` chunks for every paper and every query.

        Multi-paper tasks (compare, review, gaps) need evidence from EACH paper;
        a single global top-k lets the longest or best-matching paper dominate.
        The cross-encoder budget (`pair_budget`, default SYNTHESIS_RERANK_BUDGET)
        is split across papers; with many papers each pool shrinks to what is
        kept and the paper is ranked by fused RRF alone.
        """
        keep = per_document * max(1, len(queries))
        budget = pair_budget if pair_budget is not None else SYNTHESIS_RERANK_BUDGET
        pool = min(self.rerank_top_k, max(keep, budget // max(1, len(document_ids))))
        rerank_query = (rerank_query or " ".join(queries))[:500]
        out: List[dict] = []
        for document_id in document_ids:
            # One rerank per paper over the union of all queries' candidates.
            out.extend(self.retrieve_multi(queries, rerank_query, route or route_query(queries[0]),
                                           keep, document_ids=[document_id], pool=pool))
        return out


def cap_per_document(candidates: List[dict], top_k: int, max_per_document: Optional[int]) -> List[dict]:
    """Keep score order but allow at most `max_per_document` chunks per paper."""
    if not max_per_document:
        return candidates[:top_k]
    counts: dict[str, int] = {}
    kept: List[dict] = []
    for chunk in candidates:
        doc = chunk.get("documentId", "")
        if counts.get(doc, 0) >= max_per_document:
            continue
        counts[doc] = counts.get(doc, 0) + 1
        kept.append(chunk)
        if len(kept) >= top_k:
            break
    return kept
