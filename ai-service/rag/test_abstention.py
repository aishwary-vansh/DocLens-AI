"""Evidence-first answering: relevance floor, labelled background knowledge,
evidence conflicts, and no second Gemini call on quota/auth errors."""
import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from rag import chain as chain_module  # noqa: E402
from rag.evidence import EvidencePack  # noqa: E402
from rag.retriever import reciprocal_rank_fusion, top_scores  # noqa: E402
from rag.schemas import AnswerDraft, BackgroundDraft, ClaimDraft  # noqa: E402

CHUNK = {"id": "c1", "documentId": "d", "documentTitle": "P",
         "content": "Paper: P\nSection: Results\n\nContraSci reaches 91.2 F1 on SciFact.", "score": 0.9}


class Retriever:
    top_k = 5

    def __init__(self, chunks):
        self.chunks = chunks

    def retrieve_multi(self, queries, rerank_query, route, top_k):
        return self.chunks


def _run(chunks, fake_invoke, question="What does ContraSci reach?"):
    calls = []

    def recording(schema, *a, **k):
        calls.append(schema)
        return fake_invoke(schema)

    original = chain_module.invoke_structured
    chain_module.invoke_structured = recording
    try:
        result = chain_module.DocLensRAGChain(Retriever(chunks), llm=lambda _p: "unused").invoke(question)
    finally:
        chain_module.invoke_structured = original
    return result, calls


def test_rrf_keeps_best_semantic_similarity():
    fused = reciprocal_rank_fusion([
        {"id": "a", "retrievalSource": "keyword", "retrievalRank": 1, "similarity": None},
        {"id": "a", "retrievalSource": "semantic", "retrievalRank": 3, "similarity": 0.61},
        {"id": "b", "retrievalSource": "semantic", "retrievalRank": 1, "similarity": 0.70},
    ], 10)
    by_id = {c["id"]: c for c in fused}
    assert by_id["a"]["similarity"] == 0.61
    assert top_scores(fused) == {"top_similarity": 0.7, "top_rerank": None}


def test_floor_ignores_missing_scores():
    assert not chain_module.below_relevance_floor({"top_similarity": None, "top_rerank": None})
    assert chain_module.below_relevance_floor({"top_similarity": 0.30, "top_rerank": None})
    assert not chain_module.below_relevance_floor({"top_similarity": 0.60, "top_rerank": None})


def test_off_topic_question_abstains_without_the_answer_prompt():
    low = [{**CHUNK, "similarity": 0.31}]
    result, calls = _run(low, lambda schema: BackgroundDraft(is_general=False, background=""),
                         question="Who won the 2018 FIFA World Cup?")
    assert calls == [BackgroundDraft]  # the evidence-answer prompt never ran
    assert result.insufficient_evidence and result.abstain_reason == "low_relevance"
    assert result.citations == [] and result.claims == []
    assert result.background is None
    assert result.top_similarity == 0.31


def test_general_question_gets_labelled_background_only():
    low = [{**CHUNK, "similarity": 0.40}]
    result, _ = _run(low, lambda schema: BackgroundDraft(
        is_general=True, background="A learning rate scales each gradient step [Evidence 1]."))
    assert result.answer == chain_module.NO_EVIDENCE_ANSWER
    assert result.background == "A learning rate scales each gradient step."
    assert result.citations == []


def test_background_failure_still_abstains_cleanly():
    def boom(schema):
        raise RuntimeError("ResourceExhausted: quota")

    result, _ = _run([{**CHUNK, "similarity": 0.2}], boom)
    assert result.insufficient_evidence and result.background is None


def test_relevant_evidence_reaches_the_answer_prompt():
    draft = AnswerDraft(answer="ContraSci reaches 91.2 F1 [Evidence 1].",
                        claims=[ClaimDraft(claim_text="ContraSci reaches 91.2 F1", evidence_numbers=[1])],
                        confidence=0.9)
    result, calls = _run([{**CHUNK, "similarity": 0.66}], lambda schema: draft)
    assert calls == [AnswerDraft]
    assert not result.insufficient_evidence and result.claims[0].verified
    assert result.top_similarity == 0.66


def test_conflict_is_flagged_and_lowers_confidence():
    draft = AnswerDraft(answer="Paper A reports 91.2 F1 [Evidence 1].", confidence=1.0, evidence_conflict=True,
                        background="F1 is the harmonic mean of precision and recall.")
    out = chain_module.build_structured_answer(draft, EvidencePack([CHUNK]))
    assert out.evidence_conflict and out.confidence == 0.8
    assert out.background == "F1 is the harmonic mean of precision and recall."
    # Background is separate: it never adds uncited-sentence warnings to the answer.
    assert out.uncited_sentences == 0


@pytest.mark.parametrize("message,kind", [
    ("429 ResourceExhausted: You exceeded your current quota", "unavailable"),
    ("PermissionDenied: API key not valid", "unavailable"),
    ("DeadlineExceeded: 504", "timeout"),
    ("Invalid JSON in model reply", None),
])
def test_llm_error_kind(message, kind):
    from rag.llm import llm_error_kind

    assert llm_error_kind(RuntimeError(message)) == kind


def test_quota_error_is_not_retried_with_the_json_fallback():
    from rag import llm

    class QuotaLLM:
        fallback_calls = 0

        def with_structured_output(self, schema):
            class Runner:
                def invoke(self, messages):
                    raise RuntimeError("429 ResourceExhausted: You exceeded your current quota")

            return Runner()

        def invoke(self, messages):
            self.fallback_calls += 1
            return "{}"

    quota = QuotaLLM()
    with pytest.raises(RuntimeError):
        llm.invoke_structured(AnswerDraft, "sys", "human", llm=quota)
    assert quota.fallback_calls == 0
