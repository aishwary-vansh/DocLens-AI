# ai-service/rag/test_audit_regressions.py
# Regression tests for bugs found in the RAG accuracy/reliability audit.
# Offline: no DB, models or API key.
import os
import sys
import types

import pytest

AI_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, AI_ROOT)

import internal_auth  # noqa: E402
from rag.chunking import reconcile_chunk_ids  # noqa: E402
from rag.evidence import EvidencePack, best_window  # noqa: E402
from rag.schemas import AnswerDraft, ClaimDraft  # noqa: E402
from vector_store.text_query import scope_filter  # noqa: E402


# ── Data isolation: retrieval scope ──────────────────────────────────────────


def test_scope_filter_intersects_documents_with_collection():
    sql, params = scope_filter("col-A", ["doc-from-col-B"])
    assert sql == 'WHERE d."collectionId" = %s AND d.id = ANY(%s)'
    assert params == ("col-A", ["doc-from-col-B"])


def test_scope_filter_refuses_unscoped_retrieval():
    # Previously "WHERE TRUE": every user's chunks.
    with pytest.raises(ValueError):
        scope_filter(None, None)
    with pytest.raises(ValueError):
        scope_filter("", [])


# ── Internal service authentication ──────────────────────────────────────────


def test_internal_secret_required_when_configured(monkeypatch):
    monkeypatch.setenv("INTERNAL_API_SECRET", "s3cret-value")
    assert not internal_auth.is_authorised("/ask", None)
    assert not internal_auth.is_authorised("/ask", "wrong")
    assert internal_auth.is_authorised("/ask", "s3cret-value")
    assert internal_auth.is_authorised("/health", None)


def test_placeholder_or_missing_secret_means_open_dev_mode(monkeypatch):
    monkeypatch.setenv("INTERNAL_API_SECRET", "REPLACE_WITH_STRONG_RANDOM_SECRET")
    assert internal_auth.configured_secret() is None
    monkeypatch.delenv("INTERNAL_API_SECRET")
    assert internal_auth.is_authorised("/ask", None)


def test_ingest_path_must_stay_inside_upload_dir(monkeypatch, tmp_path):
    upload = tmp_path / "uploads"
    upload.mkdir()
    monkeypatch.setenv("INGEST_ALLOWED_DIR", str(upload))
    assert internal_auth.ingest_path_allowed(str(upload / "user" / "a.pdf"))
    assert not internal_auth.ingest_path_allowed(str(upload / ".." / "secrets.env"))
    assert not internal_auth.ingest_path_allowed("/etc/passwd")


@pytest.fixture()
def app_client(monkeypatch):
    """FastAPI app with DB driver stubs (pgvector is not installed in CI python)."""
    fastapi_testclient = pytest.importorskip("fastapi.testclient")
    pgvector = types.ModuleType("pgvector")
    pgvector_pg = types.ModuleType("pgvector.psycopg2")
    pgvector_pg.register_vector = lambda conn: None
    monkeypatch.setitem(sys.modules, "pgvector", pgvector)
    monkeypatch.setitem(sys.modules, "pgvector.psycopg2", pgvector_pg)
    monkeypatch.setenv("DATABASE_URL", "postgresql://unused")
    monkeypatch.setenv("INTERNAL_API_SECRET", "s3cret-value")
    sys.modules.pop("main", None)
    import main

    return fastapi_testclient.TestClient(main.app)


def test_http_middleware_rejects_calls_without_secret(app_client):
    assert app_client.get("/health").status_code == 200
    assert app_client.post("/ask", json={"question": "q", "collectionId": "c"}).status_code == 401
    bad = app_client.post("/ask", json={}, headers={"X-Internal-Secret": "nope"})
    assert bad.status_code == 401
    # Correct secret passes auth and reaches validation (422 for empty body).
    ok = app_client.post("/ask", json={}, headers={"X-Internal-Secret": "s3cret-value"})
    assert ok.status_code == 422


def test_ingest_rejects_paths_outside_upload_dir(app_client, monkeypatch, tmp_path):
    monkeypatch.setenv("INGEST_ALLOWED_DIR", str(tmp_path))
    res = app_client.post(
        "/ingest",
        json={"documentId": "d", "filePath": "/etc/passwd", "collectionId": "c"},
        headers={"X-Internal-Secret": "s3cret-value"},
    )
    assert res.status_code == 400


# ── Re-index keeps citations and vectors ─────────────────────────────────────


def test_reconcile_reuses_ids_for_unchanged_text_only():
    existing = [
        {"id": "old-1", "contentHash": "h1", "embeddingModel": "BAAI/bge-m3"},
        {"id": "old-2", "contentHash": "h2", "embeddingModel": "other-model"},
        {"id": "old-3", "contentHash": "h3", "embeddingModel": None},
    ]
    chunks = [
        {"id": "n1", "contentHash": "h1"},
        {"id": "n2", "contentHash": "h2"},
        {"id": "n4", "contentHash": "h-new"},
    ]
    stats = reconcile_chunk_ids(chunks, existing, "BAAI/bge-m3")
    assert [c["id"] for c in chunks] == ["old-1", "old-2", "n4"]
    assert chunks[0]["keepEmbedding"] is True
    assert chunks[1]["keepEmbedding"] is False  # vector from another model → re-embed
    assert "reuseExisting" not in chunks[2]
    assert stats == {"reused": 2, "reembed": 1, "new": 1}


def test_reconcile_handles_duplicate_text_without_sharing_ids():
    existing = [{"id": "a", "contentHash": "h", "embeddingModel": "m"}]
    chunks = [{"id": "x", "contentHash": "h"}, {"id": "y", "contentHash": "h"}]
    reconcile_chunk_ids(chunks, existing, "m")
    assert [c["id"] for c in chunks] == ["a", "y"]


# ── Citations show the supporting passage ────────────────────────────────────

LONG_CHUNK = (
    "Paper: P\nSection: Results\n\n"
    + " ".join(f"Filler sentence {i} discusses an unrelated implementation detail." for i in range(30))
    + " ContraSci reaches 81.2 Recall@10 on the SciQ benchmark."
    + " More filler about hardware and training time follows here."
)


def test_best_window_contains_supporting_sentence():
    window = best_window(LONG_CHUNK, "ContraSci reaches 81.2 Recall@10 on SciQ")
    assert "81.2 Recall@10" in window
    assert len(window) <= 600


def test_answer_citation_source_text_is_the_supporting_window():
    from rag.chain import build_structured_answer

    pack = EvidencePack([{"id": "c1", "documentId": "d", "documentTitle": "P", "pageNumber": 4, "content": LONG_CHUNK}])
    draft = AnswerDraft(
        answer="ContraSci reaches 81.2 Recall@10 on SciQ [Evidence 1].",
        claims=[ClaimDraft(claim_text="ContraSci reaches 81.2 Recall@10 on SciQ", evidence_numbers=[1])],
        confidence=0.9,
    )
    result = build_structured_answer(draft, pack)
    assert "81.2 Recall@10" in result.citations[0].source_text
    assert "81.2 Recall@10" in result.claims[0].supported_by[0].source_text


# ── Honest handling of unsupported claims and failures ───────────────────────


def test_unverified_claims_are_disclosed_in_answer():
    from rag.chain import build_structured_answer

    pack = EvidencePack([{"id": "c1", "documentId": "d", "documentTitle": "P", "content": LONG_CHUNK}])
    draft = AnswerDraft(
        answer="ContraSci reaches 81.2 Recall@10 [Evidence 1]. It also cures diseases [Evidence 1].",
        claims=[
            ClaimDraft(claim_text="ContraSci reaches 81.2 Recall@10", evidence_numbers=[1]),
            ClaimDraft(claim_text="ContraSci cures rare tropical diseases in patients", evidence_numbers=[1]),
        ],
        confidence=0.9,
    )
    result = build_structured_answer(draft, pack)
    assert "1 of 2 claims" in result.answer
    assert [c.verified for c in result.claims] == [True, False]


def test_answer_with_only_invalid_evidence_numbers_is_insufficient():
    from rag.chain import build_structured_answer

    pack = EvidencePack([{"id": "c1", "documentId": "d", "documentTitle": "P", "content": LONG_CHUNK}])
    draft = AnswerDraft(answer="Made-up fact [Evidence 9].", claims=[], confidence=0.8)
    result = build_structured_answer(draft, pack)
    assert result.citations == [] and result.insufficient_evidence is True
    assert "[" not in result.answer


def test_llm_failure_raises_instead_of_returning_error_text():
    from rag import chain as chain_module

    class Retriever:
        top_k = 5

        def retrieve_multi(self, queries, rerank_query, route, top_k):
            return [{"id": "c1", "documentId": "d", "documentTitle": "P", "content": LONG_CHUNK, "score": 0.9}]

    def boom(*args, **kwargs):
        raise RuntimeError("quota exceeded")

    original = chain_module.invoke_structured
    chain_module.invoke_structured = boom
    try:
        rag_chain = chain_module.DocLensRAGChain(Retriever(), llm=lambda _p: "unused")
        with pytest.raises(RuntimeError):
            rag_chain.invoke("What does ContraSci reach?")
    finally:
        chain_module.invoke_structured = original


def test_gemini_direct_raises_without_key(monkeypatch):
    monkeypatch.setenv("GEMINI_API_KEY", "")
    stub = types.ModuleType("ingest")
    monkeypatch.setitem(sys.modules, "ingest", stub)
    sys.modules.pop("query", None)
    import query

    with pytest.raises(RuntimeError):
        query._call_gemini_direct("prompt")


# ── Chunking never drops short sections ──────────────────────────────────────


def test_short_section_text_is_carried_into_next_chunk():
    from rag.chunking import build_chunks
    from rag.pdf_parser import Paragraph, ParsedPaper, Section

    long_text = "Dropout is applied to every sub-layer output before the residual addition. " * 4
    paper = ParsedPaper(
        title="T", authors=[], abstract="", references=[], captions=[], tables=[], page_count=2,
        sections=[
            Section("Regularization", "method", 1, [Paragraph("We employ three types of regularization:", 1)]),
            Section("Residual Dropout", "method", 1, [Paragraph(long_text, 1)]),
            Section("Tail", "conclusion", 1, [Paragraph("Short closing remark.", 2)]),
        ],
    )
    texts = [c["content"] for c in build_chunks(paper, "T")]
    assert any("three types of regularization" in t and "Dropout is applied" in t for t in texts)
    assert any("Short closing remark." in t for t in texts)


@pytest.mark.parametrize(
    "answer,expected",
    [
        ("Based on the provided evidence, there is no mention of quantum annealing hardware. It used GPUs [1].", True),
        ("The provided evidence does not contain any information about ibuprofen.", True),
        ("BERT masks 15% of tokens [1]. The paper does not mention other rates.", False),
        ("The Transformer achieves 28.4 BLEU [1].", False),
    ],
)
def test_refusal_opening_marks_insufficient(answer, expected):
    from rag.chain import opens_with_refusal

    assert opens_with_refusal(answer) is expected
