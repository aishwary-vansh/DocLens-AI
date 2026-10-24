"""Regression tests for the 2026-10-24 pipeline review (docs/RAG_PIPELINE_REVIEW.md):
number-aware claim checks, uncited-sentence disclosure, full-size evidence
blocks, synthesis sentence verification and attribution, grounded-only
profile cards, the multi-paper rerank budget, and the bounded review call."""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from rag.chain import build_structured_answer  # noqa: E402
from rag.evidence import EvidencePack  # noqa: E402
from rag.schemas import AnswerDraft, EvidencedPoint, PaperProfile  # noqa: E402
from rag.synthesis import SynthesisVerifier, _CitationIndex, paper_matrix, profile_cards  # noqa: E402
from rag.test_latency_streaming import CountingReranker, _retriever  # noqa: E402
from rag.verification import check_claim, missing_numbers, numbers_in  # noqa: E402

BLEU = ("Paper: Attention Is All You Need\nSection: Results\n\n"
        "On the WMT 2014 English-to-German translation task, the big transformer model "
        "outperforms the best previously reported models by more than 2.0 BLEU, establishing "
        "a new state-of-the-art BLEU score of 28.4. Training took 3.5 days on eight P100 GPUs.")
BERT = ("Paper: BERT: Pre-training of Deep Bidirectional Transformers\nSection: Results\n\n"
        "BERT obtains new state-of-the-art results on eleven natural language processing tasks, "
        "including pushing the GLUE score to 80.5% and SQuAD v1.1 question answering Test F1 to 93.2.")


def _pack():
    return EvidencePack([
        {"id": "c1", "documentId": "d1", "documentTitle": "Attention Is All You Need", "pageNumber": 8, "content": BLEU},
        {"id": "c2", "documentId": "d2", "documentTitle": "BERT: Pre-training of Deep Bidirectional Transformers",
         "pageNumber": 1, "content": BERT},
    ])


# ── numbers ──────────────────────────────────────────────────────────────────


def test_numbers_are_normalised_and_model_names_ignored():
    assert numbers_in("GPT-3 uses 1,024 dims and reaches 93.2% F1 in 2017.") == {"1024", "93.2", "2017"}
    assert numbers_in("trained on eight GPUs", words=True) == {"8"}


def test_claim_with_wrong_number_is_not_supported_even_with_word_overlap():
    wrong = "The big transformer model establishes a new state-of-the-art BLEU score of 30.1 on WMT 2014 English-to-German."
    right = wrong.replace("30.1", "28.4")
    assert missing_numbers(wrong, BLEU) == ["30.1"]
    assert check_claim(wrong, BLEU) == (False, "numbers")
    assert check_claim(right, BLEU) == (True, "")


def test_spelled_out_numbers_in_evidence_count():
    assert check_claim("Training took 3.5 days on 8 P100 GPUs for the big transformer model.", BLEU)[0]


# ── /ask answer ──────────────────────────────────────────────────────────────


def test_answer_flags_number_mismatch_and_uncited_sentences():
    draft = AnswerDraft(
        answer=("The big transformer reaches a BLEU score of 30.1 on WMT 2014 English-to-German [Evidence 1]. "
                "This result was later confirmed by several independent replication studies across many languages."),
        claims=[{"claim_text": "The big transformer model reaches a state-of-the-art BLEU score of 30.1 on WMT 2014 English-to-German",
                 "evidence_numbers": [1]}],
        confidence=0.9,
    )
    out = build_structured_answer(draft, _pack())
    assert out.claims[0].verified is False
    assert "state numbers that do not appear in their cited passages" in out.answer
    assert out.uncited_sentences == 1
    assert "carry no citation" in out.answer
    assert out.confidence < 0.9


def test_correct_answer_gets_no_note():
    draft = AnswerDraft(
        answer="The big transformer establishes a new state-of-the-art BLEU score of 28.4 on WMT 2014 English-to-German [Evidence 1].",
        claims=[{"claim_text": "The big transformer model establishes a new state-of-the-art BLEU score of 28.4 on WMT 2014",
                 "evidence_numbers": [1]}],
        confidence=0.9,
    )
    out = build_structured_answer(draft, _pack())
    assert out.claims[0].verified and "Note:" not in out.answer and out.uncited_sentences == 0


def test_evidence_block_shows_the_whole_chunk_to_the_model():
    long_body = "word " * 520  # 2600 chars: longer than the old 1800-char cut
    pack = EvidencePack([{"id": "c", "documentTitle": "T", "content": "Paper: T\n\n" + long_body.strip() + " ENDMARK"}])
    assert "ENDMARK" in pack.format()


# ── synthesis ────────────────────────────────────────────────────────────────


PAPERS = [
    {"id": "d1", "title": "Attention Is All You Need"},
    {"id": "d2", "title": "BERT: Pre-training of Deep Bidirectional Transformers"},
]


def test_synthesis_verifier_catches_wrong_paper_and_wrong_number():
    v = SynthesisVerifier(_pack(), PAPERS)
    ok = v.check("Attention Is All You Need: the big transformer model reaches a new state-of-the-art BLEU score of 28.4 [Evidence 1].", "findings")
    assert ok["supported"] == 1 and ok["misattributed"] == 0
    # Result of the Transformer paper attributed to BERT, citing the Transformer block.
    bad = v.check("BERT: Pre-training of Deep Bidirectional Transformers: the big transformer model reaches "
                  "a new state-of-the-art BLEU score of 28.4 [Evidence 1].", "findings")
    assert bad["misattributed"] == 1
    wrong = v.check("BERT pushes the GLUE score to 85.0% on natural language processing tasks [Evidence 2].", "findings")
    assert wrong["unsupported"] == 1
    summary = v.summary()
    assert summary["checked"] == 3 and len(summary["issues"]) == 2
    assert "2 of 3 cited sentences matched" in v.note() and "1 may cite the wrong paper" in v.note()


def test_not_reported_items_are_not_counted_as_uncited():
    v = SynthesisVerifier(_pack(), PAPERS)
    assert v.check("BERT: Pre-training of Deep Bidirectional Transformers: not reported", "datasets")["uncited"] == 0


def test_citation_index_shows_supporting_window_not_chunk_head():
    long_chunk = "Paper: P\n\n" + " ".join(f"Filler sentence number {i} about nothing in particular." for i in range(30)) + \
        " The ablation shows that removing positional encoding lowers BLEU by 0.9 points."
    pack = EvidencePack([{"id": "c", "documentId": "d", "documentTitle": "P", "content": long_chunk}])
    index = _CitationIndex(pack)
    index.render("Removing positional encoding lowers BLEU by 0.9 points [Evidence 1].")
    assert "positional encoding" in index.citations[0].source_text


def test_ungrounded_profile_items_stay_out_of_cards_and_matrix():
    profile = PaperProfile(
        methods=[EvidencedPoint(text="Grounded multi-head attention", grounded=True),
                 EvidencedPoint(text="Invented reinforcement learning stage", grounded=False)],
    )
    papers = [{"id": "d1", "title": "T", "profile": profile}]
    assert "Invented" not in profile_cards(papers)
    assert paper_matrix(papers)[0].method == "Grounded multi-head attention"


# ── latency ──────────────────────────────────────────────────────────────────


def test_balanced_retrieve_respects_the_rerank_budget():
    reranker = CountingReranker()
    r = _retriever(reranker, pool=20)
    docs = [f"d{i}" for i in range(6)]
    r.balanced_retrieve(["limitations", "future work"], docs, per_document=1, pair_budget=60)
    assert reranker.pairs <= 60  # 6 papers x pool 10, not 6 x 20

    many = CountingReranker()
    r = _retriever(many, pool=20)
    out = r.balanced_retrieve(["limitations", "future work"], [f"d{i}" for i in range(30)], per_document=1, pair_budget=60)
    assert many.pairs == 0  # pool == kept chunks: the cross-encoder could only reorder, so it is skipped
    assert out and all(0.0 <= c["score"] <= 1.0 for c in out)


def test_review_uses_the_bounded_gemini_client(monkeypatch):
    import query
    from rag import llm

    seen = {}

    class FakeLLM:
        def invoke(self, messages):
            seen["messages"] = messages
            return type("M", (), {"content": "review text"})()

    monkeypatch.setenv("GEMINI_API_KEY", "test-key-not-real")
    monkeypatch.setattr(llm, "get_llm", lambda temperature=0.1: FakeLLM())
    assert query._call_gemini_direct("prompt", "system") == "review text"
    assert len(seen["messages"]) == 2


def test_synthesis_uses_its_own_longer_gemini_timeout(monkeypatch):
    from rag import llm, synthesis

    captured = {}

    def fake_get_llm(temperature=0.1, timeout=None):
        captured["timeout"] = timeout
        raise RuntimeError("stop before the network")

    monkeypatch.setattr(llm, "get_llm", fake_get_llm)
    try:
        llm.invoke_structured(PaperProfile, "s", "h", timeout=synthesis.SYNTHESIS_LLM_TIMEOUT_S)
    except RuntimeError:
        pass
    assert captured["timeout"] == llm.SYNTHESIS_LLM_TIMEOUT_S > llm.LLM_TIMEOUT_S
