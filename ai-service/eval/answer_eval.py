# ai-service/eval/answer_eval.py
# ─────────────────────────────────────────────────────────────────────────────
# Live answer/citation check: real parser + chunker + DocLensRAGChain + Gemini,
# over an in-memory store (no PostgreSQL). Retrieval uses a BM25 keyword
# stand-in and a lexical reranker stand-in, NOT BGE-M3 / bge-reranker, so
# these numbers measure generation + citation handling, not production recall.
#
# Metrics per question: gold passage cited, every citation resolves to a
# retrieved chunk, claim verification rate, insufficient_evidence flag.
# Needs GEMINI_API_KEY. Usage: python eval/answer_eval.py [--limit 8]
# ─────────────────────────────────────────────────────────────────────────────
from __future__ import annotations

import argparse
import glob
import json
import os
import re
import sys
import types

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
sys.path.insert(0, os.path.join(ROOT, "eval"))

NEGATIVE = [
    "What dosage of ibuprofen did the authors recommend for patients?",
    "Which quantum annealing hardware was used to train the models?",
]


def _norm(text: str) -> str:
    return re.sub(r"\s+", " ", text or "").strip()


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--pdf-glob", default=os.path.join(ROOT, "..", "backend", "uploads", "*", "*.pdf"))
    parser.add_argument("--limit", type=int, default=8)
    args = parser.parse_args()

    from dotenv import load_dotenv

    load_dotenv(os.path.join(ROOT, ".env"))
    load_dotenv(os.path.join(ROOT, "..", ".env"))
    from retrieval_eval import build_corpus

    corpus = build_corpus(sorted(glob.glob(args.pdf_glob)), "section")

    from vector_store.text_query import keyword_or_query
    from retrieval_eval import Index  # noqa: F401  (keeps import side effects identical)

    class Store:
        def hybrid_search(self, query, emb, collection_id, document_ids=None, top_k=40, exclude_content_types=None, **_):
            terms = [t for t in keyword_or_query(query).split(" or ") if t]
            pool = [c for c in corpus if c["metadata"].get("content_type") not in (exclude_content_types or [])]
            scored = sorted(pool, key=lambda c: -sum(c["norm"].lower().count(t) for t in terms))[:top_k]
            return [{**c, "retrievalSource": "keyword", "retrievalRank": i + 1} for i, c in enumerate(scored)]

    class Embedder:
        def encode(self, text, **_):
            return types.SimpleNamespace(tolist=lambda: [0.0] * 1024)

    class Reranker:
        def predict(self, pairs):
            out = []
            for q, doc in pairs:
                terms = set(keyword_or_query(q).split(" or "))
                out.append(sum(t in doc.lower() for t in terms) - 2.0)
            return out

    store_mod = types.ModuleType("vector_store.pg_store")
    store_mod.pg_store, store_mod.BGE_M3_DIMENSIONS = Store(), 1024
    sys.modules["vector_store.pg_store"] = store_mod
    ingest_mod = types.ModuleType("ingest")
    ingest_mod.get_model, ingest_mod.get_reranker = Embedder, Reranker
    sys.modules["ingest"] = ingest_mod

    from rag.chain import DocLensRAGChain
    from rag.llm import model_name

    questions = json.load(open(os.path.join(ROOT, "eval", "gold_questions.json"), encoding="utf-8"))["questions"]
    rows = []
    rag_chain = DocLensRAGChain.create(collection_id="eval", top_k=8)
    for q in questions[: args.limit]:
        result = rag_chain.invoke(q["question"])
        by_id = {c["id"]: c for c in corpus}
        gold = _norm(q["gold"])
        cited_gold = any(gold in by_id[c.chunk_id]["norm"] for c in result.citations if c.chunk_id in by_id)
        rows.append({
            "id": q["id"],
            "gold_cited": cited_gold,
            "citations": len(result.citations),
            "citations_resolve": all(c.chunk_id in by_id for c in result.citations),
            "claims": len(result.claims),
            "claims_verified": sum(c.verified for c in result.claims),
            "insufficient": result.insufficient_evidence,
            "answer": result.answer[:160],
        })
    negatives = []
    for question in NEGATIVE:
        result = rag_chain.invoke(question)
        negatives.append({"question": question, "insufficient": result.insufficient_evidence, "answer": result.answer[:160]})

    answered = [r for r in rows if not r["insufficient"]]
    total_claims = sum(r["claims"] for r in rows)
    summary = {
        "llm": model_name(),
        "questions": len(rows),
        "gold_passage_cited_rate": sum(r["gold_cited"] for r in rows) / max(1, len(rows)),
        "citations_resolve_rate": sum(r["citations_resolve"] for r in rows) / max(1, len(rows)),
        "claim_verified_rate": sum(r["claims_verified"] for r in rows) / max(1, total_claims),
        "answered_rate": len(answered) / max(1, len(rows)),
        "negatives_flagged_insufficient": sum(n["insufficient"] for n in negatives) / len(negatives),
        "retrieval": "BM25-style keyword stand-in + lexical reranker stand-in (not BGE)",
    }
    print(json.dumps({"summary": summary, "rows": rows, "negatives": negatives}, indent=2, ensure_ascii=False))


if __name__ == "__main__":
    main()
