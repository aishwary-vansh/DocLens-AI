# ai-service/rag/evaluation.py
# ─────────────────────────────────────────────────────────────────────────────
# RAG evaluation metrics.
#
# Metrics implemented:
#   - Recall@K
#   - MRR (Mean Reciprocal Rank)
#   - Faithfulness score
#   - Answer relevance (Gemini-based)
#   - Citation correctness
#   - Unsupported claim rate
#   - Negative test: unanswerable question handling
#
# These run against real chunks — no mocked or invented benchmark numbers.
# ─────────────────────────────────────────────────────────────────────────────
from __future__ import annotations

import logging
import re
from typing import List, Dict, Optional, Tuple, Any

from .schemas import StructuredAnswer, CitationRef, Claim
from .verification import _token_overlap, unsupported_claim_rate

logger = logging.getLogger(__name__)


# ── Recall@K ─────────────────────────────────────────────────────────────────

def recall_at_k(retrieved_ids: List[str], relevant_ids: List[str], k: int) -> float:
    """
    Recall@K: fraction of relevant chunks that appear in the top-K retrieved.

    Args:
        retrieved_ids: ordered list of retrieved chunk ids (most relevant first)
        relevant_ids:  ground-truth relevant chunk ids
        k:             cutoff rank

    Returns float in [0, 1]. Returns 0.0 if relevant_ids is empty.
    """
    if not relevant_ids:
        return 0.0
    top_k = set(retrieved_ids[:k])
    hits = sum(1 for r in relevant_ids if r in top_k)
    return hits / len(relevant_ids)


# ── MRR ───────────────────────────────────────────────────────────────────────

def mrr(retrieved_ids: List[str], relevant_ids: List[str]) -> float:
    """
    Mean Reciprocal Rank: 1 / rank of the first relevant chunk.

    Returns float in [0, 1]. Returns 0.0 if no relevant chunk is found.
    """
    relevant_set = set(relevant_ids)
    for rank, chunk_id in enumerate(retrieved_ids, start=1):
        if chunk_id in relevant_set:
            return 1.0 / rank
    return 0.0


# ── Faithfulness ──────────────────────────────────────────────────────────────

def faithfulness_score(answer: str, chunks: List[Dict[str, Any]]) -> float:
    """
    Faithfulness: fraction of answer sentences that can be grounded in retrieved chunks.

    A sentence is considered grounded if its token overlap with any chunk content
    exceeds the threshold. This is a heuristic — not an LLM call.

    Returns float in [0, 1].
    """
    # Split answer into sentences
    sentences = [s.strip() for s in re.split(r'(?<=[.!?])\s+', answer) if len(s.strip()) > 20]
    if not sentences:
        return 1.0  # Empty / very short answers are not unfaithful

    chunk_contents = [c.get("content", "") for c in chunks]
    grounded_count = 0

    for sentence in sentences:
        for chunk_content in chunk_contents:
            overlap = _token_overlap(sentence, chunk_content)
            if overlap >= 0.12:  # threshold: at least 12% token overlap
                grounded_count += 1
                break

    return grounded_count / len(sentences)


# ── Answer relevance ──────────────────────────────────────────────────────────

def answer_relevance(question: str, answer: str) -> float:
    """
    Answer relevance: uses Gemini to score how well the answer addresses the question.
    Returns float in [0, 1].

    Falls back to token overlap heuristic if GEMINI_API_KEY is not set.
    """
    import os
    api_key = os.getenv("GEMINI_API_KEY")

    if not api_key:
        # Heuristic fallback: token overlap between question and answer
        logger.warning("answer_relevance: GEMINI_API_KEY not set, using heuristic fallback")
        return min(1.0, _token_overlap(question, answer) * 3)

    try:
        from langchain_google_genai import ChatGoogleGenerativeAI
        from langchain_core.messages import HumanMessage

        model_name = os.getenv("LLM_MODEL", "gemini-1.5-flash").replace("google/", "").replace(":free", "")
        llm = ChatGoogleGenerativeAI(model=model_name, google_api_key=api_key, temperature=0.0)

        prompt = (
            f"Rate how well the following answer addresses the question.\n\n"
            f"Question: {question}\n\n"
            f"Answer: {answer}\n\n"
            f"Respond with ONLY a decimal number between 0.0 and 1.0 "
            f"(1.0 = perfectly answers the question, 0.0 = completely irrelevant)."
        )
        response = llm.invoke([HumanMessage(content=prompt)])
        score_str = response.content.strip().split()[0]
        score = float(score_str)
        return max(0.0, min(1.0, score))
    except Exception as e:
        logger.warning("answer_relevance LLM call failed: %s — using heuristic", e)
        return min(1.0, _token_overlap(question, answer) * 3)


# ── Citation correctness ──────────────────────────────────────────────────────

def citation_correctness(citations: List[CitationRef], retrieved_chunks: List[Dict]) -> float:
    """
    Citation correctness: fraction of citations where:
    1. The chunk_id exists in retrieved_chunks
    2. The source_text has at least minimal overlap with the chunk content

    Returns float in [0, 1]. Returns 1.0 if citations list is empty.
    """
    if not citations:
        return 1.0

    chunk_map = {c.get("id", c.get("chunk_id", "")): c.get("content", "") for c in retrieved_chunks}
    correct = 0

    for cit in citations:
        chunk_content = chunk_map.get(cit.chunk_id, "")
        if not chunk_content:
            logger.warning("Citation chunk_id %s not found in retrieved set", cit.chunk_id)
            continue
        if not cit.source_text:
            correct += 1  # No source_text to verify — give benefit of doubt
            continue
        overlap = _token_overlap(cit.source_text, chunk_content)
        if overlap >= 0.05:
            correct += 1
        else:
            logger.warning(
                "Citation source_text has low overlap with chunk (%.2f): chunk_id=%s",
                overlap, cit.chunk_id,
            )

    return correct / len(citations)


def citation_precision(citations: List[CitationRef], retrieved_chunks: List[Dict]) -> float:
    """Fraction of generated citations that resolve to valid evidence."""
    if not citations:
        return 1.0
    valid_ids = {
        chunk.get("id") or chunk.get("chunk_id")
        for chunk in retrieved_chunks
    }
    return sum(citation.chunk_id in valid_ids for citation in citations) / len(citations)


def citation_coverage(answer: StructuredAnswer) -> float:
    """Fraction of claims that have at least one citation."""
    if not answer.claims:
        return 1.0 if answer.insufficient_evidence else 0.0
    return sum(bool(claim.supported_by) for claim in answer.claims) / len(answer.claims)


def reranking_improvement(
    pre_rerank_ids: List[str],
    post_rerank_ids: List[str],
    relevant_ids: List[str],
) -> Optional[float]:
    """Difference in Recall@K before and after reranking."""
    if not relevant_ids:
        return None
    k = max(len(pre_rerank_ids), len(post_rerank_ids))
    return recall_at_k(post_rerank_ids, relevant_ids, k) - recall_at_k(
        pre_rerank_ids,
        relevant_ids,
        k,
    )


# ── Negative test: unanswerable question ─────────────────────────────────────

def test_unanswerable(answer: StructuredAnswer, question: str) -> Tuple[bool, str]:
    """
    Test whether the system correctly returns insufficient_evidence=True
    for a question that has no answer in the uploaded documents.

    Returns (passed: bool, reason: str).
    """
    if answer.insufficient_evidence:
        return True, "✅ System correctly flagged insufficient_evidence=True for unanswerable question"

    # Check if the answer is suspiciously confident with no citations
    if not answer.citations:
        return False, (
            "❌ System returned an answer with no citations but did not flag insufficient_evidence. "
            "Possible hallucination."
        )

    if answer.confidence < 0.3:
        return True, f"✅ Low confidence ({answer.confidence:.2f}) indicates system is uncertain (acceptable)"

    return False, (
        f"❌ System returned a confident answer (confidence={answer.confidence:.2f}) "
        f"with {len(answer.citations)} citations for what should be an unanswerable question. "
        "Manual review required."
    )


# ── Full evaluation report ────────────────────────────────────────────────────

class EvaluationReport:
    """Run all metrics for a single query and return a structured report."""

    def __init__(
        self,
        question: str,
        answer: StructuredAnswer,
        retrieved_chunks: List[Dict],
        relevant_chunk_ids: Optional[List[str]] = None,
        k: int = 5,
    ):
        self.question = question
        self.answer = answer
        self.retrieved_chunks = retrieved_chunks
        self.relevant_ids = relevant_chunk_ids or []
        self.k = k
        self.latency_ms: Optional[float] = None

    def run(self) -> Dict[str, Any]:
        retrieved_ids = [c.get("id", c.get("chunk_id", "")) for c in self.retrieved_chunks]
        report = {
            "question":              self.question,
            "answer_length":         len(self.answer.answer),
            "num_citations":         len(self.answer.citations),
            "num_claims":            len(self.answer.claims),
            "insufficient_evidence": self.answer.insufficient_evidence,
            "confidence":            self.answer.confidence,
            "query_was_rewritten":   self.answer.query_was_rewritten,
        }

        # Retrieval metrics (only if ground truth provided)
        if self.relevant_ids:
            report["recall_at_k"]   = recall_at_k(retrieved_ids, self.relevant_ids, self.k)
            report["mrr"]           = mrr(retrieved_ids, self.relevant_ids)
        else:
            report["recall_at_k"]   = None
            report["mrr"]           = None

        # Generation quality
        report["faithfulness"]         = faithfulness_score(self.answer.answer, self.retrieved_chunks)
        report["answer_relevance"]     = answer_relevance(self.question, self.answer.answer)
        report["citation_correctness"] = citation_correctness(self.answer.citations, self.retrieved_chunks)
        report["citation_precision"] = citation_precision(self.answer.citations, self.retrieved_chunks)
        report["citation_coverage"] = citation_coverage(self.answer)
        report["unsupported_claim_rate"] = unsupported_claim_rate(self.answer.claims)
        report["latency_ms"] = self.latency_ms

        logger.info(
            "Evaluation — faithfulness=%.2f relevance=%.2f citation_correctness=%.2f ucr=%.2f",
            report["faithfulness"],
            report["answer_relevance"],
            report["citation_correctness"],
            report["unsupported_claim_rate"],
        )
        return report
