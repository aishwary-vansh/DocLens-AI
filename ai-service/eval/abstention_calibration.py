# ai-service/eval/abstention_calibration.py
# ─────────────────────────────────────────────────────────────────────────────
# Calibrates the "no relevant evidence" floor (RETRIEVAL_MIN_SIMILARITY /
# RETRIEVAL_MIN_RERANK) on answerable vs unanswerable questions.
#
# For each question it runs the production retrieval (DocLensRetriever over the
# in-memory index from retrieval_eval.py) and records:
#   top_similarity  highest BGE-M3 cosine among the returned chunks
#   top_rerank      highest sigmoid cross-encoder score (only with --reranker)
#
# Thresholds are picked on the gold set + half of the unanswerable set and
# checked on the validation set + the other half, so the reported numbers are
# not tuned on the questions they are reported for.
#
#   python eval/abstention_calibration.py [--reranker]
# ─────────────────────────────────────────────────────────────────────────────
from __future__ import annotations

import argparse
import glob
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
sys.path.insert(0, os.path.join(ROOT, "eval"))

from retrieval_eval import Index, build_corpus  # noqa: E402


def _load(name: str) -> list[dict]:
    with open(os.path.join(ROOT, "eval", name), encoding="utf-8") as f:
        return json.load(f)["questions"]


def score_questions(index: Index, questions: list[dict], reranker) -> list[dict]:
    from rag.chain import split_facets
    from rag.query_router import route_query
    from rag.retriever import DocLensRetriever, top_scores

    retriever = DocLensRetriever(top_k=10, rerank_top_k=20)
    retriever._pg_store, retriever._embed_model, retriever._reranker = index, index.model, reranker
    rows = []
    for q in questions:
        ranked = retriever.retrieve_multi(split_facets(q["question"]), q["question"], route_query(q["question"]), 10)
        scores = top_scores(ranked)
        rows.append({"id": q["id"], "answerable": q["answerable"], "kind": q.get("kind", "gold"), **scores})
    return rows


def evaluate(rows: list[dict], key: str, threshold: float) -> dict:
    """Abstain when rows[key] < threshold."""
    ans = [r for r in rows if r["answerable"]]
    una = [r for r in rows if not r["answerable"]]
    return {
        "threshold": threshold,
        "answerable_kept": sum(r[key] >= threshold for r in ans) / max(1, len(ans)),
        "unanswerable_abstained": sum(r[key] < threshold for r in una) / max(1, len(una)),
        "off_topic_abstained": _share([r for r in una if r["kind"] == "off_topic"], key, threshold),
        "in_domain_abstained": _share([r for r in una if r["kind"] == "in_domain"], key, threshold),
    }


def _share(rows: list[dict], key: str, threshold: float) -> float:
    return sum(r[key] < threshold for r in rows) / max(1, len(rows))


def pick_threshold(rows: list[dict], key: str) -> float:
    """Highest threshold that keeps every answerable question: abstaining on a
    question the papers do answer is the worse error, so it is not traded off."""
    lowest_answerable = min(r[key] for r in rows if r["answerable"])
    return round(lowest_answerable - 0.02, 3)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--pdf-glob", default=os.path.join(ROOT, "..", "backend", "uploads", "*", "*.pdf"))
    parser.add_argument("--reranker", action="store_true", help="also score with bge-reranker-v2-m3 (slow on CPU)")
    args = parser.parse_args()

    gold = [{**q, "answerable": True} for q in _load("gold_questions.json")]
    val = [{**q, "answerable": True} for q in _load("validation_questions.json")]
    una = [{**q, "answerable": False} for q in _load("unanswerable_questions.json")]
    # Alternate split keeps both kinds (off_topic / in_domain) on each side.
    una_tune, una_check = una[0::2], una[1::2]

    reranker = None
    if args.reranker:
        from sentence_transformers import CrossEncoder

        reranker = CrossEncoder("BAAI/bge-reranker-v2-m3", max_length=512)

    index = Index(build_corpus(sorted(glob.glob(args.pdf_glob)), "section"), "BAAI/bge-m3", 4)
    tune = score_questions(index, gold + una_tune, reranker)
    check = score_questions(index, val + una_check, reranker)

    out = {"per_question": tune + check}
    for key in ("top_similarity", "top_rerank") if reranker else ("top_similarity",):
        threshold = pick_threshold(tune, key)
        out[key] = {"tuning": evaluate(tune, key, threshold), "held_out": evaluate(check, key, threshold)}
    print(json.dumps(out, indent=2))


if __name__ == "__main__":
    main()
