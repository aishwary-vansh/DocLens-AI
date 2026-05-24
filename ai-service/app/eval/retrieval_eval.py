"""Lightweight retrieval evaluation for vector chunk search."""
from __future__ import annotations

import json
import time
from dataclasses import dataclass
from pathlib import Path

from app.core.rag import retrieve


@dataclass
class EvalCase:
    query: str
    collection_id: str
    expected_document_ids: list[str]


def precision_at_k(results: list[dict], expected: set[str], k: int) -> float:
    if not expected or k <= 0:
        return 0.0
    retrieved = [hit["meta"].document_id for hit in results[:k]]
    return len([doc_id for doc_id in retrieved if doc_id in expected]) / min(k, len(retrieved) or k)


def recall_at_k(results: list[dict], expected: set[str], k: int) -> float:
    if not expected:
        return 0.0
    retrieved = {hit["meta"].document_id for hit in results[:k]}
    return len(retrieved & expected) / len(expected)


def evaluate(cases: list[EvalCase], k: int = 5) -> dict:
    rows = []
    for case in cases:
        expected = set(case.expected_document_ids)
        vector_start = time.time()
        vector = retrieve(case.query, case.collection_id, k, "vector")
        vector_ms = int((time.time() - vector_start) * 1000)

        rows.append(
            {
                "query": case.query,
                "vector_precision_at_k": precision_at_k(vector, expected, k),
                "vector_recall_at_k": recall_at_k(vector, expected, k),
                "vector_latency_ms": vector_ms,
            }
        )

    return {
        "k": k,
        "cases": rows,
        "summary": {
            "vector_precision": _avg(rows, "vector_precision_at_k"),
            "vector_recall": _avg(rows, "vector_recall_at_k"),
        },
    }


def _avg(rows: list[dict], key: str) -> float:
    if not rows:
        return 0.0
    return round(sum(row[key] for row in rows) / len(rows), 4)


def load_cases(path: str) -> list[EvalCase]:
    raw = json.loads(Path(path).read_text(encoding="utf-8"))
    return [EvalCase(**item) for item in raw]


if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser()
    parser.add_argument("cases", help="JSON file with query, collection_id, expected_document_ids")
    parser.add_argument("--k", type=int, default=5)
    parser.add_argument("--output", default="retrieval-eval-report.json")
    args = parser.parse_args()

    report = evaluate(load_cases(args.cases), args.k)
    Path(args.output).write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(json.dumps(report["summary"], indent=2))
