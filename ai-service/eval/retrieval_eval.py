# ai-service/eval/retrieval_eval.py
# ─────────────────────────────────────────────────────────────────────────────
# Offline retrieval + citation-window evaluation on real PDFs with known
# supporting passages (eval/gold_questions.json).
#
# It reuses the production pieces (parser, chunker, keyword_or_query, RRF,
# query router, cap_per_document, best_window) over an in-memory index, so it
# needs no PostgreSQL. Two approximations, printed in the report:
#   * keyword list: BM25 over the OR-terms instead of PostgreSQL ts_rank_cd;
#   * embedding / reranker models are whatever you pass (production uses
#     BAAI/bge-m3 + BAAI/bge-reranker-v2-m3). Without --reranker the fused RRF
#     score (normalised to [0, 1]) stands in for the reranker score.
#
# Usage:
#   python eval/retrieval_eval.py --pdf-glob "../backend/uploads/*/*.pdf"
#   python eval/retrieval_eval.py --model BAAI/bge-m3 --reranker BAAI/bge-reranker-v2-m3
#   python eval/retrieval_eval.py ... --gold eval/validation_questions.json --tune
#
# Ranking goes through the production DocLensRetriever (facet split, RRF over
# all facet lists, ONE rerank against the full question, per-paper cap); only
# the candidate store is replaced by this in-memory index. --tune sweeps the
# router section boost and rerank pool on a (validation) set; reranker scores
# are cached per (query, chunk) so the sweep does not re-run the cross-encoder.
# ─────────────────────────────────────────────────────────────────────────────
from __future__ import annotations

import argparse
import glob
import json
import math
import os
import re
import sys
import types
from collections import Counter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)


def _norm(text: str) -> str:
    return re.sub(r"\s+", " ", text or "").strip()


def legacy_page_chunks(path: str, title: str) -> list[dict]:
    """The pre-upgrade chunker (page text, 3600 chars), loaded without the DB driver."""
    if "vector_store.pg_store" not in sys.modules:
        stub = types.ModuleType("vector_store.pg_store")
        stub.BGE_M3_DIMENSIONS, stub.pg_store = 1024, None
        sys.modules["vector_store.pg_store"] = stub
    os.environ.setdefault("CHUNK_MAX_CHARS", "3600")
    import ingest

    chunks = ingest._pymupdf_chunks(path, title)
    for i, chunk in enumerate(chunks):
        chunk["id"] = f"legacy-{i}"
    return chunks


def build_corpus(paths: list[str], chunker: str) -> list[dict]:
    from rag.chunking import build_chunks
    from rag.pdf_parser import parse_paper

    corpus, seen_titles = [], set()
    for path in paths:
        paper = parse_paper(path)
        if paper.title in seen_titles:  # duplicate uploads of the same paper
            continue
        seen_titles.add(paper.title)
        chunks = build_chunks(paper, paper.title) if chunker == "section" else legacy_page_chunks(path, paper.title)
        for i, chunk in enumerate(chunks):
            chunk.setdefault("id", f"{len(corpus)}-{i}")
            chunk["documentId"] = paper.title
            chunk["documentTitle"] = paper.title
            chunk["norm"] = _norm(chunk["content"])
            corpus.append(chunk)
    return corpus


class Index:
    _models: dict = {}

    def __init__(self, corpus: list[dict], model_name: str, batch_size: int = 8):
        from sentence_transformers import SentenceTransformer

        self.corpus = corpus
        # One copy per model: two BGE-M3 copies plus the reranker exhaust a 16 GB machine.
        if model_name not in Index._models:
            Index._models[model_name] = SentenceTransformer(model_name)
        self.model = Index._models[model_name]
        # Small models default to 256 word pieces; chunks are ~450. Use what the
        # model's position table allows (BGE-M3 allows 8192).
        limit = getattr(getattr(self.model[0], "auto_model", None), "config", None)
        limit = getattr(limit, "max_position_embeddings", 512) if limit else 512
        self.model.max_seq_length = max(self.model.max_seq_length, min(int(limit), 8192))
        self.vectors = self.model.encode([c["content"] for c in corpus], normalize_embeddings=True, batch_size=batch_size)
        self.tokens = [Counter(re.findall(r"[a-z0-9]+", c["content"].lower())) for c in corpus]
        self.avg_len = sum(sum(t.values()) for t in self.tokens) / max(1, len(self.tokens))
        self.df = Counter(term for t in self.tokens for term in t)

    def hybrid_search(self, query, query_embedding, collection_id, doc_filter, top_k=40,
                      exclude_content_types=None, embedding_model=None):
        """Same contract as pg_store.hybrid_search, so DocLensRetriever can use this index."""
        import numpy as np

        return self.candidates(query, top_k, exclude_content_types or [], np.asarray(query_embedding))

    def candidates(self, query: str, top_k: int, exclude: list[str], qv=None) -> list[dict]:
        from vector_store.text_query import keyword_or_query

        allowed = [i for i, c in enumerate(self.corpus) if c["metadata"].get("content_type") not in exclude]
        if qv is None:
            qv = self.model.encode(query, normalize_embeddings=True)
        dense = sorted(allowed, key=lambda i: -float(self.vectors[i] @ qv))[:top_k]
        terms = [t for t in keyword_or_query(query).split(" or ") if t]
        n = len(self.corpus)

        def bm25(i):
            length = sum(self.tokens[i].values())
            score = 0.0
            for term in terms:
                for part in re.findall(r"[a-z0-9]+", term):
                    tf = self.tokens[i].get(part, 0)
                    if tf:
                        idf = math.log(1 + (n - self.df[part] + 0.5) / (self.df[part] + 0.5))
                        score += idf * tf * 2.2 / (tf + 1.2 * (0.25 + 0.75 * length / self.avg_len))
            return score

        keyword = [i for i in sorted(allowed, key=lambda i: -bm25(i)) if bm25(i) > 0][:top_k]
        out = []
        for source, ranked in (("semantic", dense), ("keyword", keyword)):
            for rank, i in enumerate(ranked, 1):
                similarity = float(self.vectors[i] @ qv) if source == "semantic" else None
                out.append({**self.corpus[i], "retrievalSource": source, "retrievalRank": rank,
                            "similarity": similarity})
        return out


class CachedReranker:
    """Wraps a CrossEncoder; remembers scores per (query, chunk text) and time spent."""

    def __init__(self, model):
        self.model, self.cache, self.seconds, self.pairs = model, {}, 0.0, 0

    def predict(self, pairs):
        import time

        missing = [p for p in pairs if (p[0], p[1]) not in self.cache]
        if missing:
            started = time.perf_counter()
            for p, score in zip(missing, self.model.predict(missing)):
                self.cache[(p[0], p[1])] = float(score)
            self.seconds += time.perf_counter() - started
            self.pairs += len(missing)
        return [self.cache[(p[0], p[1])] for p in pairs]


def run(index: Index, questions: list[dict], use_router: bool, reranker, k: int,
        pool: int = 20, boost: float = 0.0) -> dict:
    from rag import query_router
    from rag.chain import split_facets
    from rag.evidence import best_window, snippet
    from rag.query_router import QueryRoute, route_query
    from rag.retriever import DocLensRetriever

    retriever = DocLensRetriever(top_k=10, rerank_top_k=pool)
    retriever._pg_store, retriever._embed_model, retriever._reranker = index, index.model, reranker
    saved_boost, query_router.SECTION_BOOST = query_router.SECTION_BOOST, boost

    hits, rr, paper_hits, window_hits, snippet_hits, coverable, rows = 0, 0.0, 0, 0, 0, 0, []
    ndcg = 0.0
    try:
        for q in questions:
            gold = _norm(q["gold"])
            route = route_query(q["question"]) if use_router else QueryRoute(exclude_content_types=[])
            ranked = retriever.retrieve_multi(split_facets(q["question"]), q["question"], route, 10)
            in_corpus = any(gold in c["norm"] for c in index.corpus)
            coverable += in_corpus
            rank = next((i for i, c in enumerate(ranked, 1) if gold in c["norm"]), None)
            hits += bool(rank and rank <= k)
            rr += 1.0 / rank if rank else 0.0
            # nDCG@10, binary relevance: every chunk containing the gold passage
            # is relevant (duplicate PDFs give several); ideal = all of them on top.
            relevant = sum(gold in c["norm"] for c in index.corpus)
            dcg = sum(1.0 / math.log2(i + 1) for i, c in enumerate(ranked[:10], 1) if gold in c["norm"])
            ideal = sum(1.0 / math.log2(i + 1) for i in range(1, min(relevant, 10) + 1))
            ndcg += dcg / ideal if ideal else 0.0
            paper_hits += sum(q["paper"].lower() in c["documentTitle"].lower() for c in ranked[:k]) / k
            if rank:
                chunk = ranked[rank - 1]
                window_hits += gold in _norm(best_window(chunk["content"], q["gold"]))
                snippet_hits += gold in _norm(snippet(chunk["content"]))
            rows.append((q["id"], rank, in_corpus))
    finally:
        query_router.SECTION_BOOST = saved_boost

    n = len(questions)
    found = sum(1 for _, r, _ in rows if r)
    return {
        "recall_at_k": hits / n,
        "mrr_at_10": rr / n,
        "ndcg_at_10": ndcg / n,
        "gold_in_some_chunk": coverable / n,
        "right_paper_share_top_k": paper_hits / n,
        "citation_window_contains_gold": window_hits / found if found else 0.0,
        "first600_snippet_contains_gold": snippet_hits / found if found else 0.0,
        "per_question_rank": {qid: r for qid, r, _ in rows},
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--pdf-glob", default=os.path.join(ROOT, "..", "backend", "uploads", "*", "*.pdf"))
    parser.add_argument("--gold", default=os.path.join(ROOT, "eval", "gold_questions.json"))
    parser.add_argument("--model", default="sentence-transformers/all-MiniLM-L6-v2")
    parser.add_argument("--reranker", default=None)
    parser.add_argument("--k", type=int, default=5)
    parser.add_argument("--batch-size", type=int, default=8, help="encode batch; large models on CPU need small batches")
    parser.add_argument("--json", action="store_true", help="print machine-readable JSON only")
    parser.add_argument("--pool", type=int, default=20, help="rerank candidates (production RERANK_CANDIDATES)")
    parser.add_argument("--reranker-max-length", type=int, default=512)
    parser.add_argument("--tune", action="store_true", help="sweep boost x pool on --gold (use the validation set)")
    args = parser.parse_args()

    paths = sorted(glob.glob(args.pdf_glob))
    questions = json.load(open(args.gold, encoding="utf-8"))["questions"]
    if args.tune:
        configs = [(f"section + router, boost={b}, pool={p}", "section", True, p, b)
                   for p in (10, 20, 40) for b in (0.0, 0.02, 0.04, 0.08)]
    else:
        configs = [
            ("legacy page chunks, no router", "page", False, args.pool, 0.0),
            ("section chunks, no router", "section", False, args.pool, 0.0),
            ("section + router filter, boost off (new default)", "section", True, args.pool, 0.0),
            ("section + router, boost 0.08 (old default)", "section", True, args.pool, 0.08),
            ("section + router filter, boost off, pool 40 (old pool)", "section", True, 40, 0.0),
        ]
    results = {}
    indexes = {}
    reranker = None
    for label, chunker, router, pool, boost in configs:
        if chunker not in indexes:
            corpus = build_corpus(paths, chunker)
            available = {c["documentTitle"].lower() for c in corpus}
            usable = [q for q in questions if any(q["paper"].lower() in t for t in available)]
            indexes[chunker] = (Index(corpus, args.model, args.batch_size), usable, len(corpus))
        index, usable, size = indexes[chunker]
        if args.reranker and reranker is None:
            from sentence_transformers import CrossEncoder

            reranker = CachedReranker(CrossEncoder(args.reranker, max_length=args.reranker_max_length))
        results[label] = {**run(index, usable, router, reranker, args.k, pool, boost),
                          "chunks": size, "questions": len(usable), "pool": pool, "boost": boost}

    meta = {"pdfs": len(paths), "embedding_model": args.model, "reranker": args.reranker or "none (normalised RRF)", "k": args.k,
            "reranker_max_length": args.reranker_max_length, "gold_file": os.path.basename(args.gold),
            "keyword_list": "BM25 approximation of ts_rank_cd",
            "reranker_seconds_total": round(reranker.seconds, 1) if reranker else 0,
            "reranker_pairs_scored": reranker.pairs if reranker else 0}
    if args.json:
        print(json.dumps({"meta": meta, "results": results}, indent=2))
        return
    print(json.dumps(meta, indent=2))
    for label, r in results.items():
        print(f"\n== {label}  ({r['questions']} questions, {r['chunks']} chunks)")
        for key in ("recall_at_k", "mrr_at_10", "ndcg_at_10", "gold_in_some_chunk", "right_paper_share_top_k",
                    "citation_window_contains_gold", "first600_snippet_contains_gold"):
            print(f"  {key:32s} {r[key]:.3f}")
        print("  ranks:", r["per_question_rank"])


if __name__ == "__main__":
    main()
