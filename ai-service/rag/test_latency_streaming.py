"""Regression tests for the latency fixes: one rerank per request, bounded
LLM waits, and the /ask/stream SSE endpoint."""
import os
import sys
import types

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from rag.query_router import route_query  # noqa: E402
from rag.retriever import DocLensRetriever  # noqa: E402


class FakeStore:
    def __init__(self):
        self.calls = 0

    def hybrid_search(self, query, embedding, collection_id, doc_filter, top_k, exclude_content_types, embedding_model):
        self.calls += 1
        out = []
        for rank in range(1, top_k + 1):
            out.append({"id": f"{query[:6]}-{rank}", "documentId": "d1", "documentTitle": "P",
                        "content": f"{query} passage {rank}", "metadata": {"section_type": "results"},
                        "retrievalSource": "semantic", "retrievalRank": rank})
        return out


class FakeEmbedder:
    def encode(self, text, normalize_embeddings=True):
        import numpy as np

        return np.zeros(4)


class CountingReranker:
    def __init__(self):
        self.calls, self.pairs = 0, 0

    def predict(self, pairs):
        self.calls += 1
        self.pairs += len(pairs)
        return [float(len(pairs) - i) for i in range(len(pairs))]


def _retriever(reranker, pool=8):
    r = DocLensRetriever(top_k=5, rerank_top_k=pool)
    r._pg_store, r._embed_model, r._reranker = FakeStore(), FakeEmbedder(), reranker
    return r


def test_multi_query_retrieval_reranks_once_with_bounded_pool():
    reranker = CountingReranker()
    r = _retriever(reranker, pool=8)
    queries = ["first facet question", "second facet question", "third facet question"]
    out = r.retrieve_multi(queries, "full question", route_query("full question"), top_k=5)
    assert r._pg_store.calls == 3  # one candidate search per facet
    assert reranker.calls == 1  # but a single cross-encoder pass
    assert reranker.pairs <= 8
    assert len(out) == 5 and out[0]["score"] >= out[-1]["score"]


def test_balanced_retrieve_reranks_once_per_paper():
    reranker = CountingReranker()
    r = _retriever(reranker)
    r.balanced_retrieve(["limitations", "future work"], ["d1", "d2"], per_document=2)
    assert reranker.calls == 2


def test_reranker_disabled_falls_back_to_rrf_order():
    r = _retriever(None)
    out = r.retrieve_chunks("what is the result")
    assert out and all(0.0 <= c["score"] <= 1.0 for c in out)
    assert out[0]["score"] == 1.0


def test_structured_call_does_not_retry_after_timeout():
    from rag import llm

    class SlowLLM:
        def __init__(self):
            self.fallback_calls = 0

        def with_structured_output(self, schema):
            class Runner:
                def invoke(self, messages):
                    raise TimeoutError("Deadline exceeded")

            return Runner()

        def invoke(self, messages):
            self.fallback_calls += 1
            return "{}"

    slow = SlowLLM()
    from rag.schemas import AnswerDraft

    with pytest.raises(TimeoutError):
        llm.invoke_structured(AnswerDraft, "sys", "human", llm=slow)
    assert slow.fallback_calls == 0


def test_gemini_client_has_bounded_timeout_and_retries(monkeypatch):
    from rag import llm

    monkeypatch.setenv("GEMINI_API_KEY", "test-key-not-real")
    client = llm.get_llm()
    assert client.timeout == llm.LLM_TIMEOUT_S and client.timeout > 0
    assert client.max_retries == llm.LLM_MAX_RETRIES <= 2


@pytest.fixture()
def stream_client(monkeypatch):
    fastapi_testclient = pytest.importorskip("fastapi.testclient")
    pgvector = types.ModuleType("pgvector")
    pgvector_pg = types.ModuleType("pgvector.psycopg2")
    pgvector_pg.register_vector = lambda conn: None
    monkeypatch.setitem(sys.modules, "pgvector", pgvector)
    monkeypatch.setitem(sys.modules, "pgvector.psycopg2", pgvector_pg)
    monkeypatch.setenv("DATABASE_URL", "postgresql://unused")
    monkeypatch.setenv("INTERNAL_API_SECRET", "s3cret-value")
    monkeypatch.setenv("MODEL_WARMUP", "false")
    sys.modules.pop("main", None)
    import main

    return main, fastapi_testclient.TestClient(main.app)


def _events(text):
    out = []
    for frame in text.split("\n\n"):
        lines = dict(line.split(": ", 1) for line in frame.splitlines() if ": " in line and not line.startswith(":"))
        if "event" in lines:
            out.append((lines["event"], lines.get("data")))
    return out


def test_ask_stream_emits_stages_then_result(stream_client, monkeypatch):
    import json

    main, client = stream_client

    def fake_ask(question, collection_id, document_ids, top_k, history, on_stage=None):
        for name in ("loading_models", "retrieving", "generating", "verifying"):
            on_stage(name)
        return {"answer": "A [1]", "citations": [{"chunkId": "c1"}], "insufficient_evidence": False}

    monkeypatch.setattr(main.query, "ask_question", fake_ask)
    assert client.post("/ask/stream", json={"question": "q", "collectionId": "c"}).status_code == 401
    res = client.post("/ask/stream", json={"question": "q", "collectionId": "c"},
                      headers={"X-Internal-Secret": "s3cret-value"})
    assert res.status_code == 200 and res.headers["content-type"].startswith("text/event-stream")
    events = _events(res.text)
    assert [e for e, _ in events] == ["stage"] * 4 + ["result"]
    assert json.loads(events[-1][1])["citations"][0]["chunkId"] == "c1"


def test_ask_stream_reports_errors_as_events(stream_client, monkeypatch):
    main, client = stream_client

    def failing_ask(*args, on_stage=None, **kwargs):
        on_stage("retrieving")
        raise RuntimeError("Gemini timed out")

    monkeypatch.setattr(main.query, "ask_question", failing_ask)
    res = client.post("/ask/stream", json={"question": "q", "collectionId": "c"},
                      headers={"X-Internal-Secret": "s3cret-value"})
    events = _events(res.text)
    assert events[-1][0] == "error" and "timed out" in events[-1][1]


def test_chain_records_stage_timings():
    from rag import chain as chain_module
    from rag.schemas import AnswerDraft

    class Retriever:
        top_k = 5

        def retrieve_multi(self, queries, rerank_query, route, top_k):
            return [{"id": "c1", "documentId": "d", "documentTitle": "P",
                     "content": "Paper: P\nSection: Results\n\nContraSci reaches 91.2 F1.", "score": 0.9}]

    seen = []
    original = chain_module.invoke_structured
    chain_module.invoke_structured = lambda *a, **k: AnswerDraft(answer="ContraSci reaches 91.2 F1 [Evidence 1].", claims=[], confidence=0.9)
    try:
        rag_chain = chain_module.DocLensRAGChain(Retriever(), llm=lambda _p: "unused")
        rag_chain.invoke("What does ContraSci reach?", on_stage=seen.append)
    finally:
        chain_module.invoke_structured = original
    assert seen == ["retrieving", "generating", "verifying"]
    assert set(rag_chain.last_timings) == {"retrieving", "generating", "verifying"}
