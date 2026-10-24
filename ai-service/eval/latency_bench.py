# ai-service/eval/latency_bench.py
# ─────────────────────────────────────────────────────────────────────────────
# Per-stage latency of /ask retrieval on this machine (CPU), old vs new path,
# over the local uploads and the in-memory index from retrieval_eval.py.
#
#   old: one routed retrieval + rerank PER FACET, 40 candidates, reranker
#        max_length 8192 (the CrossEncoder default), results merged.
#   new: candidates for every facet fused by RRF, ONE rerank of
#        RERANK_CANDIDATES (20) pairs, reranker max_length 512.
#
# With --llm it also runs the full DocLensRAGChain (new path) with live Gemini
# for a few questions and prints its stage timings (needs GEMINI_API_KEY).
#
#   python eval/latency_bench.py --questions 6 --llm 3
# ─────────────────────────────────────────────────────────────────────────────
from __future__ import annotations

import argparse
import glob
import json
import os
import statistics
import sys
import time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
sys.path.insert(0, os.path.join(ROOT, "eval"))

from retrieval_eval import Index, build_corpus  # noqa: E402


def _summary(values: list[float]) -> dict:
    return {"mean_s": round(statistics.mean(values), 2), "median_s": round(statistics.median(values), 2),
            "max_s": round(max(values), 2), "n": len(values)}


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--pdf-glob", default=os.path.join(ROOT, "..", "backend", "uploads", "*", "*.pdf"))
    parser.add_argument("--gold", default=os.path.join(ROOT, "eval", "gold_questions.json"))
    parser.add_argument("--questions", type=int, default=6)
    parser.add_argument("--llm", type=int, default=0, help="full chain runs with live Gemini")
    parser.add_argument("--no-old", action="store_true", help="skip the slow pre-fix retrieval path")
    args = parser.parse_args()

    from sentence_transformers import CrossEncoder

    from rag.chain import split_facets
    from rag.query_router import route_query
    from rag.retriever import DocLensRetriever

    out: dict = {}
    corpus = build_corpus(sorted(glob.glob(args.pdf_glob)), "section")
    t = time.perf_counter()
    index = Index(corpus, "BAAI/bge-m3", 4)
    out["index_build_s"] = round(time.perf_counter() - t, 1)

    old_reranker = CrossEncoder("BAAI/bge-reranker-v2-m3")  # max_length from model config (8192)
    new_reranker = CrossEncoder("BAAI/bge-reranker-v2-m3", max_length=512)

    def retriever(reranker, pool):
        r = DocLensRetriever(top_k=10, rerank_top_k=pool)
        r._pg_store, r._embed_model, r._reranker = index, index.model, reranker
        return r

    questions = json.load(open(args.gold, encoding="utf-8"))["questions"]
    # Spread the sample across papers.
    sample = [questions[i] for i in range(0, len(questions), max(1, len(questions) // args.questions))][: args.questions]
    old_r, new_r = retriever(old_reranker, 40), retriever(new_reranker, 20)
    new_r.retrieve_multi(["warm up"], "warm up", route_query("warm up"), 10)
    old_times, new_times, facets = [], [], []
    for q in sample:
        question = q["question"]
        route = route_query(question)
        parts = split_facets(question)
        facets.append(len(parts))
        if not args.no_old:
            t = time.perf_counter()
            for part in parts:  # the pre-fix chain.retrieve_merged
                old_r.retrieve_chunks(part, route=route)
            old_times.append(time.perf_counter() - t)
        t = time.perf_counter()
        new_r.retrieve_multi(parts, question, route, 10)
        new_times.append(time.perf_counter() - t)
        old = f"{old_times[-1]:.1f}s" if old_times else "skipped"
        print(f"{q['id']}: facets={len(parts)} old={old} new={new_times[-1]:.1f}s", file=sys.stderr, flush=True)
    if old_times:
        out["retrieval_old"] = _summary(old_times)
    out["retrieval_new"] = _summary(new_times)
    out["facets_per_question"] = facets

    if args.llm:
        from dotenv import load_dotenv

        load_dotenv(os.path.join(ROOT, "..", ".env"))  # GEMINI_API_KEY; never printed
        from rag.chain import DocLensRAGChain
        from rag.llm import get_llm, model_name

        chain = DocLensRAGChain(new_r, get_llm())
        runs = []
        for q in sample[: args.llm]:
            t = time.perf_counter()
            run = {"id": q["id"]}
            try:
                answer = chain.invoke(q["question"])
                run.update(citations=len(answer.citations), insufficient_evidence=answer.insufficient_evidence)
            except Exception as exc:  # a timeout is a result here, not a crash
                run["error"] = f"{type(exc).__name__}: {str(exc)[:120]}"
            run.update(total_s=round(time.perf_counter() - t, 2), stages_ms=dict(chain.last_timings))
            runs.append(run)
            print(json.dumps(run), file=sys.stderr, flush=True)
        out["chain_new_with_llm"] = {"model": model_name(), "runs": runs}
    print(json.dumps(out, indent=1))


if __name__ == "__main__":
    main()
