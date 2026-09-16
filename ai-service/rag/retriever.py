# ai-service/rag/retriever.py
# ─────────────────────────────────────────────────────────────────────────────
# DocLensRetriever — wraps the existing RRF hybrid SQL in a LangChain
# BaseRetriever so it slots into any LangChain chain without replacing the
# existing retrieval logic.
#
# The original pg_store.search() SQL is UNCHANGED — this is purely a thin
# adapter layer.
# ─────────────────────────────────────────────────────────────────────────────
from __future__ import annotations

import logging
from typing import List, Optional

from langchain_core.documents import Document as LCDocument
from langchain_core.retrievers import BaseRetriever
from langchain_core.callbacks import CallbackManagerForRetrieverRun
from pydantic import model_validator

logger = logging.getLogger(__name__)


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
    rerank_top_k: int = 40  # candidates to fetch before reranking

    # Non-pydantic fields injected after construction
    _pg_store: object = None          # type: ignore[assignment]
    _embed_model: object = None       # type: ignore[assignment]
    _reranker: object = None          # type: ignore[assignment]

    class Config:
        arbitrary_types_allowed = True

    @classmethod
    def create(
        cls,
        collection_id: Optional[str] = None,
        document_ids: Optional[List[str]] = None,
        top_k: int = 10,
    ) -> "DocLensRetriever":
        """
        Factory that lazily imports heavy models to avoid importing at module
        load time (which would slow down startup and fail if CUDA is absent).
        """
        # Import here to keep module-level imports lightweight
        from vector_store.pg_store import pg_store
        from ingest import get_model, get_reranker

        instance = cls(
            collection_id=collection_id,
            document_ids=document_ids,
            top_k=top_k,
        )
        instance._pg_store   = pg_store
        instance._embed_model = get_model()
        instance._reranker    = get_reranker()
        return instance

    # ── LangChain required method ─────────────────────────────────────────

    def _get_relevant_documents(
        self,
        query: str,
        *,
        run_manager: CallbackManagerForRetrieverRun,
    ) -> List[LCDocument]:
        """
        1. Embed the query with BAAI/bge-m3
        2. Run the existing RRF hybrid SQL (unchanged)
        3. BGE-rerank the candidates
        4. Return top_k as LangChain Documents with full metadata
        """
        logger.info(
            "DocLensRetriever: fetching candidates — collection=%s doc_ids=%s top_k=%d",
            self.collection_id,
            self.document_ids,
            self.top_k,
        )

        # Step 1 — embed query
        query_embedding = self._embed_model.encode(query).tolist()

        # Step 2 — existing RRF hybrid search (SQL unchanged)
        candidates = self._pg_store.search(
            query,
            query_embedding,
            self.collection_id,
            self.document_ids,
            top_k=self.rerank_top_k,
        )

        if not candidates:
            logger.warning("DocLensRetriever: no candidates returned from RRF search")
            return []

        # Step 3 — BGE reranker
        pairs = [[query, c["content"]] for c in candidates]
        scores = self._reranker.predict(pairs)
        for i, chunk in enumerate(candidates):
            chunk["rerank_score"] = float(scores[i])
        candidates = sorted(candidates, key=lambda x: x["rerank_score"], reverse=True)[: self.top_k]

        logger.info("DocLensRetriever: returning %d reranked chunks", len(candidates))

        # Step 4 — wrap in LangChain Documents
        docs = []
        for chunk in candidates:
            docs.append(
                LCDocument(
                    page_content=chunk["content"],
                    metadata={
                        "chunk_id":      chunk["id"],
                        "document_id":   chunk["documentId"],
                        "page_number":   chunk.get("pageNumber"),
                        "chunk_index":   chunk.get("chunkIndex"),
                        "score":         chunk["rerank_score"],
                        "rrf_score":     chunk.get("score", 0.0),
                    },
                )
            )
        return docs
