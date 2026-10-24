# ai-service/rag/test_research_pipeline.py
# Offline tests for the research RAG pipeline (no DB, no models, no API key).
import os
import sys
import types

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from rag.chunking import build_chunks, finalise_chunks, pack_section  # noqa: E402
from rag.evidence import EvidencePack, renumber_markers  # noqa: E402
from rag.paper_fixture import build_paper_pdf  # noqa: E402
from rag.paper_profile import extract_profile_heuristic, profile_chunk, select_profile_evidence  # noqa: E402
from rag.pdf_parser import Paragraph, Section, classify_section, parse_paper  # noqa: E402
from rag.query_router import route_query, section_boost  # noqa: E402
from rag.retriever import cap_per_document  # noqa: E402
from rag.schemas import AnswerDraft, ClaimDraft, CitationRef, PaperProfile, EvidencedPoint  # noqa: E402
from rag.verification import containment, validate_citations  # noqa: E402
from vector_store.text_query import keyword_or_query  # noqa: E402


@pytest.fixture(scope="module")
def paper(tmp_path_factory):
    path = tmp_path_factory.mktemp("pdf") / "paper.pdf"
    return parse_paper(build_paper_pdf(str(path)))


@pytest.fixture(scope="module")
def chunks(paper):
    out = build_chunks(paper, paper.title)
    for chunk in out:
        chunk["documentId"] = "doc-1"
        chunk["documentTitle"] = paper.title
    return finalise_chunks(out, "doc-1", "col-1")


# ── Parsing ──────────────────────────────────────────────────────────────────


def test_parser_recovers_title_abstract_and_sections(paper):
    assert paper.title == "Contrastive Retrieval for Scientific Question Answering"
    assert paper.abstract.startswith("We study retrieval")
    types_ = [s.section_type for s in paper.sections]
    for expected in ("abstract", "introduction", "related_work", "method", "experiments", "limitations"):
        assert expected in types_
    sub = next(s for s in paper.sections if s.heading.startswith("3.1"))
    assert sub.level == 2 and sub.section_type == "method"


def test_parser_strips_running_headers_and_page_numbers(paper):
    text = " ".join(s.text for s in paper.sections)
    assert "Preprint. Under review." not in text


def test_references_are_split_and_kept_out_of_sections(paper):
    assert len(paper.references) == 2
    assert paper.references[0].startswith("[1]")
    assert all(s.section_type != "references" for s in paper.sections)


@pytest.mark.parametrize(
    "heading,expected",
    [
        ("5 Limitations", "limitations"),
        ("IV. EXPERIMENTAL SETUP", "experiments"),
        ("2.3 Related Work", "related_work"),
        ("Conclusion", "conclusion"),
        ("Future Directions", "future_work"),
        ("3 Proposed Method", "method"),
        ("Acknowledgments", "acknowledgements"),
        ("Bibliography", "references"),
        ("Threats to Validity", "limitations"),
        ("A Quiet Heading", "other"),
    ],
)
def test_classify_section(heading, expected):
    assert classify_section(heading) == expected


# ── Chunking ─────────────────────────────────────────────────────────────────


def test_chunks_carry_section_metadata_and_context_header(chunks):
    body = [c for c in chunks if c["metadata"]["content_type"] == "section_text"]
    assert body
    for chunk in body:
        assert chunk["content"].startswith("Paper: Contrastive Retrieval")
        assert "Section: " in chunk["content"].split("\n\n")[0]
        assert chunk["metadata"]["section_type"]
        assert chunk["id"] and chunk["contentHash"]
    assert [c["chunkIndex"] for c in chunks] == list(range(len(chunks)))


def test_reference_and_abstract_chunks_are_typed(chunks):
    kinds = {c["metadata"]["content_type"] for c in chunks}
    assert {"abstract", "reference", "section_text"} <= kinds


def test_pack_section_respects_size_and_overlaps_by_sentence():
    sentences = [f"Sentence number {i} explains a detail of the method." for i in range(80)]
    section = Section("Method", "method", 1, [Paragraph(" ".join(sentences), 2)])
    pieces = pack_section(section, max_chars=600, overlap=120)
    assert len(pieces) > 3
    assert all(len(p["text"]) <= 600 + 130 for p in pieces)
    # overlap: next piece starts with whole sentence(s) from the previous one
    first_tail = pieces[0]["text"].split(". ")[-1].rstrip(".")
    assert first_tail in pieces[1]["text"]


# ── Retrieval helpers ────────────────────────────────────────────────────────


def test_keyword_query_uses_or_and_drops_question_words():
    q = keyword_or_query("What are the limitations of ContraSci on PubMedQA?")
    assert q == "limitations or contrasci or pubmedqa"
    assert keyword_or_query("") == ""


def test_router_boosts_limitation_sections_and_hides_references():
    route = route_query("What are the main limitations of these approaches?")
    assert "limitations" in route.intents
    assert "reference" in route.exclude_content_types
    assert section_boost(route, {"section_type": "limitations"}, 0.08) > section_boost(route, {"section_type": "method"}, 0.08)
    # Disabled by default (it lowered recall with the real reranker).
    assert section_boost(route, {"section_type": "limitations"}) == 0.0


def test_router_keeps_references_for_citation_questions():
    route = route_query("Which prior work does this paper cite for BM25?")
    assert "reference" not in route.exclude_content_types


def test_cap_per_document_keeps_order_and_diversity():
    cands = [{"id": str(i), "documentId": "A" if i < 6 else "B", "score": 1 - i / 10} for i in range(10)]
    kept = cap_per_document(cands, top_k=5, max_per_document=3)
    assert [c["documentId"] for c in kept] == ["A", "A", "A", "B", "B"]


# ── Verification ─────────────────────────────────────────────────────────────


def test_short_verbatim_quote_is_not_dropped_as_hallucination():
    chunk = {"id": "c1", "content": " ".join(["filler words about many unrelated things"] * 40)
             + " The model reaches 81.2 Recall@10 on SciQ."}
    good = CitationRef(chunk_id="c1", document_id="d", document_title="t",
                       source_text="The model reaches 81.2 Recall@10 on SciQ.")
    fake = CitationRef(chunk_id="c1", document_id="d", document_title="t",
                       source_text="Quantum annealing improves protein folding dramatically.")
    kept = validate_citations([good, fake], [chunk])
    assert kept == [good]
    assert containment(good.source_text, chunk["content"]) == 1.0


# ── Evidence pack & answer assembly ──────────────────────────────────────────


def _pack():
    return EvidencePack([
        {"id": "a", "documentId": "d1", "documentTitle": "P1", "pageNumber": 3,
         "content": "Paper: P1\nSection: Results\n\nContraSci reaches 81.2 Recall@10 on SciQ.", "metadata": {"section_type": "results"}},
        {"id": "b", "documentId": "d2", "documentTitle": "P2", "pageNumber": 5,
         "content": "Paper: P2\nSection: Limitations\n\nThe study covers only English text.", "metadata": {"section_type": "limitations"}},
    ])


def test_evidence_pack_format_strips_header_and_numbers_blocks():
    text = _pack().format()
    assert "[Evidence 1]" in text and "[Evidence 2]" in text
    assert "Paper: P1\nSection" not in text


def test_renumber_markers_and_invalid_numbers_ignored():
    pack = _pack()
    assert pack.numbers_in("x [Evidence 2] y [Evidence 1, 9]") == [2, 1]
    assert renumber_markers("a [Evidence 2] b [Evidence 1, 2]", {2: 1, 1: 2}) == "a [1] b [2][1]"


def test_build_structured_answer_resolves_and_verifies_claims():
    from rag.chain import build_structured_answer

    draft = AnswerDraft(
        answer="ContraSci reaches 81.2 Recall@10 [Evidence 1], but only English text is covered [Evidence 2]. [Evidence 7]",
        claims=[
            ClaimDraft(claim_text="ContraSci reaches 81.2 Recall@10 on SciQ", evidence_numbers=[1]),
            ClaimDraft(claim_text="ContraSci was trained on 40 languages simultaneously", evidence_numbers=[2]),
        ],
        confidence=0.9,
    )
    result = build_structured_answer(draft, _pack())
    assert [c.chunk_id for c in result.citations] == ["a", "b"]
    assert "[1]" in result.answer and "[2]" in result.answer and "Evidence 7" not in result.answer
    assert result.claims[0].verified is True
    assert result.claims[1].verified is False
    assert result.confidence < 0.9


# ── Profiles & synthesis fallbacks ───────────────────────────────────────────


def test_heuristic_profile_finds_limitations_and_future_work(paper, chunks):
    profile = extract_profile_heuristic(paper.title, chunks, paper.abstract)
    assert profile.research_problem
    assert any("English" in p.text for p in profile.limitations)
    assert any("multilingual" in p.text.lower() for p in profile.future_work)
    assert all(p.grounded and p.chunk_id for p in profile.limitations)
    card = profile_chunk(paper.title, profile)
    assert card and card["metadata"]["content_type"] == "paper_profile"


def test_profile_evidence_skips_references(chunks):
    picked = select_profile_evidence(chunks)
    assert picked and all(c["metadata"]["content_type"] != "reference" for c in picked)


def test_heuristic_gaps_and_coverage_are_cited():
    from rag.synthesis import _heuristic_gaps, coverage_report

    def prof(lim_chunk, dataset):
        return PaperProfile(
            limitations=[EvidencedPoint(text="Evaluation covers only English text.", chunk_id=lim_chunk, grounded=True)],
            datasets=[EvidencedPoint(text=dataset, chunk_id=lim_chunk, grounded=True)],
        )

    papers = [
        {"id": "d1", "title": "P1", "profile": prof("a", "SciQ")},
        {"id": "d2", "title": "P2", "profile": prof("b", "PubMedQA")},
    ]
    result = _heuristic_gaps(papers, _pack())
    assert result.gaps and all(g.evidence_numbers for g in result.gaps)
    assert "sciq (1/2 papers)" in coverage_report(papers)


# ── Structured output fallback ───────────────────────────────────────────────


class _FakeLLM:
    def with_structured_output(self, schema):
        raise NotImplementedError("tool calling unsupported")

    def invoke(self, messages):
        return types.SimpleNamespace(content=[{"type": "text", "text": 'Sure:\n```json\n{"answer": "ok", "confidence": 0.4}\n```'}])


def test_invoke_structured_falls_back_to_json_parsing():
    from rag.llm import invoke_structured

    result = invoke_structured(AnswerDraft, "sys", "human", llm=_FakeLLM())
    assert result.answer == "ok" and result.confidence == 0.4
