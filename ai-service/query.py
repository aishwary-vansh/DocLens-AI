# ai-service/query.py
# ─────────────────────────────────────────────────────────────────────────────
# Use cases called by main.py. Q&A goes through rag/chain.py; multi-paper
# synthesis (compare, literature review, research gaps, summaries) goes
# through rag/synthesis.py. Each keeps a simple fallback path.
# ─────────────────────────────────────────────────────────────────────────────
import logging
import os
import math
import time
from typing import List, Optional, Dict, Any

from rag.llm import model_name as configured_model

logger = logging.getLogger(__name__)


def _sigmoid_score(value: float) -> float:
    try:
        return 1.0 / (1.0 + math.exp(-float(value)))
    except OverflowError:
        return 0.0 if value < 0 else 1.0


# ── Legacy helper kept for summarise/review (no LangChain needed) ─────────────

def _call_gemini_direct(prompt: str, system_message: str = "You are a helpful research assistant.") -> str:
    """
    Direct Gemini call for free-text tasks (review, legacy fallbacks).
    Raises instead of returning error text, so callers never present an
    error message as model output.
    """
    from rag.llm import llm_available

    if not llm_available():
        raise RuntimeError("GEMINI_API_KEY is not configured")

    from langchain_core.messages import HumanMessage, SystemMessage

    from rag.llm import get_llm, message_text

    # Same client as every other task: bounded by LLM_TIMEOUT_S / LLM_MAX_RETRIES.
    # (The google.generativeai SDK used before had no timeout at all.)
    return message_text(get_llm().invoke([SystemMessage(content=system_message), HumanMessage(content=prompt)]))


def _retrieve_and_rerank(query: str, collection_id: str, document_ids: list, top_k: int, rerank_top: Optional[int] = None) -> list:
    """Shared routed hybrid retrieval + BGE reranking for non-chain functions."""
    from rag.retriever import DocLensRetriever

    retriever = DocLensRetriever.create(collection_id=collection_id, document_ids=document_ids, top_k=top_k)
    if rerank_top:
        retriever.rerank_top_k = rerank_top
    return retriever.retrieve_chunks(query)


def _format_citations_legacy(chunks: list) -> tuple[str, list]:
    """Format chunks into legacy citation format for backward compatibility."""
    context_text = ""
    citations = []
    for i, c in enumerate(chunks):
        context_text += f"\n[Citation {i + 1}]: {c['content']}\n"
        citations.append({
            "chunkId":    c["id"],
            "documentId": c["documentId"],
            "documentTitle": c.get("documentTitle", ""),
            "pageNumber": c["pageNumber"],
            "chunkIndex": c.get("chunkIndex"),
            "sourceText": c["content"],
            "relevance":  c.get("score"),
        })
    return context_text, citations


# ── ask_question — now uses full LangChain pipeline ───────────────────────────

def ask_question(
    question: str,
    collection_id: str,
    document_ids: Optional[List[str]] = None,
    top_k: int = 10,
    history: Optional[List[Dict[str, Any]]] = None,
    on_stage=None,
) -> Dict[str, Any]:
    """
    Main Q&A endpoint. Uses the LangChain RAG chain.
    `on_stage(name)` receives progress stage names (used by /ask/stream).
    Returns format compatible with existing NestJS QueryService expectations.
    """
    from rag.chain import DocLensRAGChain

    logger.info(
        "ask_question: question=%r collection=%s doc_ids=%s top_k=%d history_len=%d",
        question[:60],
        collection_id,
        document_ids,
        top_k,
        len(history or []),
    )

    # No silent fallback here: an unverified free-text answer must not be
    # returned as if it were grounded. Errors surface as HTTP 500 and the
    # backend shows its clearly labelled extractive fallback instead.
    started = time.perf_counter()
    if on_stage:
        on_stage("loading_models")
    chain = DocLensRAGChain.create(
        collection_id=collection_id,
        document_ids=document_ids,
        top_k=top_k,
    )
    setup_ms = round((time.perf_counter() - started) * 1000)
    result = chain.invoke(question=question, history=history or [], on_stage=on_stage)

    # Convert StructuredAnswer → legacy response format (NestJS expects this shape)
    citations_out = []
    for cit in result.citations:
        citations_out.append({
            "chunkId":     cit.chunk_id,
            "documentId":  cit.document_id,
            "documentTitle": cit.document_title,
            "pageNumber":  cit.page_number,
            "chunkIndex":  None,
            "sourceText":  cit.source_text,
            "relevance":   cit.relevance,
        })

    claims_out = []
    for claim in result.claims:
        claims_out.append({
            "claimText":  claim.claim_text,
            "verified":   claim.verified,
            "supportedBy": [c.chunk_id for c in claim.supported_by],
        })

    return {
        "answer":                result.answer,
        "citations":             citations_out,
        "claims":                claims_out,
        "insufficient_evidence": result.insufficient_evidence,
        "confidence":            result.confidence,
        "uncited_sentences":     result.uncited_sentences,
        "evidence_conflict":     result.evidence_conflict,
        "background":            result.background,
        "abstain_reason":        result.abstain_reason,
        "top_similarity":        result.top_similarity,
        "top_rerank":            result.top_rerank,
        "query_was_rewritten":   result.query_was_rewritten,
        "rewritten_query":       result.rewritten_query,
        "model_used":            configured_model(),
        "timings_ms":            {"setup": setup_ms, **chain.last_timings,
                                  "total": round((time.perf_counter() - started) * 1000)},
    }


# ── summarize_document — structured paper card + cited summary ──────────────

def summarize_document(document_id: str) -> Dict[str, Any]:
    """Summarise a paper from its evidence-linked profile (built at ingest)."""
    from rag.synthesis import paper_summary

    return paper_summary(document_id)


# ── review_document — critical review routed to limitation/method evidence ───

def review_document(document_id: str) -> Dict[str, Any]:
    """Peer-review style critique grounded in the paper's own sections."""
    from rag.synthesis import load_papers, profile_cards

    chunks = _retrieve_and_rerank(
        "methodology evaluation limitations threats to validity assumptions", None, [document_id], top_k=12
    )
    if not chunks:
        return {"review": "No text found for this document to review."}

    try:
        card = profile_cards(load_papers([document_id], None))
    except Exception as e:
        logger.warning("Profile unavailable for review: %s", e)
        card = ""
    context_text, citations = _format_citations_legacy(chunks)
    prompt = (
        "Write a structured peer review with sections: Summary, Strengths, Weaknesses, "
        "Methodological concerns, Missing experiments, Questions for the authors, Overall assessment. "
        "Ground every point in the excerpts and cite them as [Citation N].\n\n"
        f"Paper card:\n{card}\n\nExcerpts:\n{context_text}"
    )
    review = _call_gemini_direct(prompt, "You are a critical, fair academic reviewer.")
    # Free-text output: [Citation N] markers are NOT claim-verified.
    return {"review": review, "citations": citations, "verified": False}


# ── compare_documents — balanced multi-paper synthesis ──────────────────────

def compare_documents(
    document_ids: List[str],
    collection_id: Optional[str],
    question: Optional[str],
    top_k: int = 12,
) -> Dict[str, Any]:
    """Paper comparison: per-paper profiles + balanced evidence → structured comparison."""
    from rag.synthesis import compare_papers

    query = question or "Compare the main findings, methodologies, and conclusions."
    # compare_papers has its own cited extractive fallback when Gemini fails.
    return compare_papers(document_ids, collection_id, query)


# ── literature_review — map (profiles) → reduce (thematic synthesis) ────────

def literature_review(
    collection_id: Optional[str],
    document_ids: Optional[List[str]],
    topic: Optional[str],
) -> Dict[str, Any]:
    """Thematic literature review with comparison matrix and cited sections."""
    from rag.synthesis import literature_review as synthesise_review

    return synthesise_review(collection_id, document_ids, topic)


# ── research_gaps — cross-paper gap analysis ────────────────────────────────

def research_gaps(
    collection_id: Optional[str],
    document_ids: Optional[List[str]],
    topic: Optional[str],
    max_gaps: int = 8,
) -> Dict[str, Any]:
    """Find stated, recurring, coverage and methodological gaps across papers."""
    from rag.synthesis import research_gaps as analyse_gaps

    return analyse_gaps(collection_id, document_ids, topic, max_gaps=max_gaps)
