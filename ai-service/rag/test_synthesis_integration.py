# ai-service/rag/test_synthesis_integration.py
# End-to-end synthesis paths (ingest → profile → retrieval → gaps / review /
# compare / summary / ask) over an in-memory store with fake models.
# No PostgreSQL, no model downloads, no API key.
import os
import sys
import types

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from rag.chunking import build_chunks, finalise_chunks  # noqa: E402
from rag.paper_fixture import build_paper_pdf  # noqa: E402
from rag.paper_profile import build_profile, profile_chunk  # noqa: E402
from rag.pdf_parser import parse_paper  # noqa: E402
from vector_store.text_query import keyword_or_query  # noqa: E402


class FakeStore:
    def __init__(self):
        self.docs = {}
        self.chunks = []

    def add(self, doc_id, title, chunks, metadata):
        self.docs[doc_id] = {"id": doc_id, "title": title, "metadata": metadata, "collectionId": "col"}
        for c in chunks:
            self.chunks.append({**c, "documentId": doc_id, "documentTitle": title})

    def get_documents(self, document_ids=None, collection_id=None, limit=30):
        ids = document_ids or list(self.docs)
        return [{**self.docs[i], "metadata": dict(self.docs[i]["metadata"])} for i in ids if i in self.docs]

    def get_document_chunks(self, document_id):
        return [c for c in self.chunks if c["documentId"] == document_id]

    def get_chunks_by_ids(self, ids):
        by_id = {c["id"]: c for c in self.chunks}
        return [by_id[i] for i in ids if i in by_id]

    def update_document_ingest_metadata(self, document_id, metadata):
        self.docs[document_id]["metadata"].update(metadata)

    def hybrid_search(self, query, emb, collection_id, document_ids=None, top_k=40, exclude_content_types=None, keyword_query=None, embedding_model=None):
        terms = set(keyword_or_query(query).split(" or "))
        pool = [
            c for c in self.chunks
            if (not document_ids or c["documentId"] in document_ids)
            and c["metadata"].get("content_type") not in (exclude_content_types or [])
        ]
        scored = sorted(pool, key=lambda c: -sum(t in c["content"].lower() for t in terms))[:top_k]
        return [{**c, "retrievalSource": "keyword", "retrievalRank": i + 1} for i, c in enumerate(scored)]


class FakeEmbedder:
    def encode(self, text, **_):
        return types.SimpleNamespace(tolist=lambda: [0.0] * 1024)


class FakeReranker:
    def predict(self, pairs):
        return [sum(w in doc.lower() for w in q.lower().split()) - 3 for q, doc in pairs]


@pytest.fixture()
def store(tmp_path, monkeypatch):
    fake = FakeStore()
    module = types.ModuleType("vector_store.pg_store")
    module.pg_store = fake
    module.BGE_M3_DIMENSIONS = 1024
    monkeypatch.setitem(sys.modules, "vector_store.pg_store", module)
    ingest_stub = types.ModuleType("ingest")
    ingest_stub.get_model = lambda: FakeEmbedder()
    ingest_stub.get_reranker = lambda: FakeReranker()
    monkeypatch.setitem(sys.modules, "ingest", ingest_stub)
    monkeypatch.setenv("GEMINI_API_KEY", "")

    paper = parse_paper(build_paper_pdf(str(tmp_path / "p.pdf")))
    for doc_id, title in (("d1", paper.title), ("d2", "A Second Retrieval Paper")):
        chunks = build_chunks(paper, title)
        profile, method = build_profile(title, chunks, paper.abstract)
        card = profile_chunk(title, profile)
        chunks.append(card)
        finalise_chunks(chunks, doc_id, "col")
        # profile stored for d1 only: d2 exercises the on-demand rebuild path
        meta = {"profile": profile.model_dump(), "profileMethod": method} if doc_id == "d1" else {}
        fake.add(doc_id, title, chunks, meta)
    return fake


def test_research_gaps_extractive_are_cited(store):
    from rag.synthesis import research_gaps

    result = research_gaps("col", ["d1", "d2"], "scientific retrieval")
    assert result["gaps"], result
    assert result["method"] == "extractive"
    cited = [g for g in result["gaps"] if g["citations"]]
    assert cited and all(c["chunkId"] for g in cited for c in g["citations"])
    assert "profile" in store.docs["d2"]["metadata"]  # rebuilt + cached on demand
    assert {r["document_id"] for r in result["paperMatrix"]} == {"d1", "d2"}


def test_research_gaps_llm_path_resolves_numbers(store, monkeypatch):
    from rag import llm, synthesis
    from rag.schemas import ResearchGap, ResearchGapResult

    monkeypatch.setattr(llm, "llm_available", lambda: True)
    captured = {}

    def fake_invoke(schema, system, human, llm=None, **_):
        captured["human"] = human
        return ResearchGapResult(
            summary="Both papers evaluate English only [Evidence 1].",
            gaps=[
                ResearchGap(title="Multilingual evaluation", gap_type="coverage", description="No multilingual test.",
                            rationale="Stated limitation [Evidence 1].", evidence_numbers=[1, 999], confidence=0.9),
                ResearchGap(title="Unsupported", gap_type="theoretical", description="x", rationale="y", confidence=0.9),
            ],
        )

    monkeypatch.setattr(llm, "invoke_structured", fake_invoke)
    result = synthesis.research_gaps("col", ["d1", "d2"], None)
    assert "Coverage report" in captured["human"] and "[Evidence 1]" in captured["human"]
    first, second = result["gaps"]
    assert first["grounded"] and len(first["citations"]) == 1 and "[1]" in first["rationale"]
    assert not second["grounded"] and second["confidence"] <= 0.3
    assert result["summary"].endswith("[1].")


def test_literature_review_and_compare_extractive(store):
    from rag.synthesis import REVIEW_SECTIONS, compare_papers, literature_review

    review = literature_review("col", ["d1", "d2"], "retrieval")
    assert set(review["sections"]) == {k for k, _, _ in REVIEW_SECTIONS}
    assert "## Paper Comparison Matrix" in review["markdown"] and "## Sources" in review["markdown"]
    comparison = compare_papers(["d1", "d2"], "col", None)
    assert len(comparison["methods"]) == 2 and comparison["paperMatrix"]


def test_paper_summary_has_cited_sections(store):
    from rag.synthesis import paper_summary

    summary = paper_summary("d1")
    assert "Limitations:" in summary["summary"] and summary["citations"]
    assert "[1]" in summary["summary"]


def test_balanced_retrieval_covers_every_paper(store):
    from rag.retriever import DocLensRetriever

    retriever = DocLensRetriever.create(collection_id="col", document_ids=["d1", "d2"], top_k=6)
    chunks = retriever.balanced_retrieve(["limitations"], ["d1", "d2"], per_document=2)
    assert {c["documentId"] for c in chunks} == {"d1", "d2"}
    assert all(c["metadata"].get("content_type") != "reference" for c in chunks)


def test_ask_chain_end_to_end_with_fake_llm(store, monkeypatch):
    from rag import chain as chain_module
    from rag.schemas import AnswerDraft, ClaimDraft

    def fake_invoke(schema, system, human, llm=None, **_):
        assert "[Evidence 1]" in human
        return AnswerDraft(
            answer="The evaluation covers only English biomedical text [Evidence 1].",
            claims=[ClaimDraft(claim_text="The evaluation covers only English biomedical text", evidence_numbers=[1])],
            confidence=0.8,
        )

    monkeypatch.setattr(chain_module, "invoke_structured", fake_invoke)
    from rag.retriever import DocLensRetriever

    retriever = DocLensRetriever.create(collection_id="col", document_ids=["d1"], top_k=5)
    rag_chain = chain_module.DocLensRAGChain(retriever, llm=lambda _prompt: "unused")
    result = rag_chain.invoke("What are the limitations of the evaluation?")
    assert result.citations and result.answer.endswith("[1].")
    top = result.citations[0]
    assert "English" in top.source_text  # routed to the Limitations section
    assert result.claims[0].verified
