# ai-service/query.py
# ─────────────────────────────────────────────────────────────────────────────
# All public function signatures are UNCHANGED so main.py needs no edits.
# The implementation now routes through the LangChain pipeline (rag/chain.py)
# while preserving the existing fallback paths.
# ─────────────────────────────────────────────────────────────────────────────
import logging
import os
import math
from typing import List, Optional, Dict, Any

from vector_store.pg_store import pg_store
from ingest import get_model, get_reranker

logger = logging.getLogger(__name__)


def _sigmoid_score(value: float) -> float:
    try:
        return 1.0 / (1.0 + math.exp(-float(value)))
    except OverflowError:
        return 0.0 if value < 0 else 1.0


# ── Legacy helper kept for summarise/review (no LangChain needed) ─────────────

def _call_gemini_direct(prompt: str, system_message: str = "You are a helpful research assistant.") -> str:
    """
    Direct Gemini call for simple tasks (summarise, review) that don't need
    the full RAG chain. Kept for backward compatibility.
    """
    api_key = os.getenv("GEMINI_API_KEY")
    if not api_key:
        return "GEMINI_API_KEY is not configured. Please set it in your environment."

    model_name = os.getenv("LLM_MODEL", "gemini-1.5-flash").replace("google/", "").replace(":free", "")

    try:
        import google.generativeai as genai
        genai.configure(api_key=api_key)
        model = genai.GenerativeModel(model_name=model_name, system_instruction=system_message)
        response = model.generate_content(prompt)
        return response.text
    except Exception as e:
        logger.error("Gemini direct call failed: %s", e)
        return f"LLM call failed: {e}"


def _retrieve_and_rerank(query: str, collection_id: str, document_ids: list, top_k: int, rerank_top: int = 40) -> list:
    """Shared retrieval + BGE reranking for non-chain functions."""
    model = get_model()
    query_embedding = model.encode(query, normalize_embeddings=True).tolist()
    chunks = pg_store.search(query, query_embedding, collection_id, document_ids, top_k=rerank_top)
    if chunks:
        reranker = get_reranker()
        pairs = [[query, c["content"]] for c in chunks]
        scores = reranker.predict(pairs)
        for i, chunk in enumerate(chunks):
            chunk["score"] = _sigmoid_score(float(scores[i]))
        chunks = sorted(chunks, key=lambda x: x["score"], reverse=True)[:top_k]
    return chunks


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
) -> Dict[str, Any]:
    """
    Main Q&A endpoint. Uses the LangChain RAG chain.
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

    try:
        chain = DocLensRAGChain.create(
            collection_id=collection_id,
            document_ids=document_ids,
            top_k=top_k,
        )
        result = chain.invoke(question=question, history=history or [])
    except Exception as e:
        logger.error("LangChain RAG chain failed: %s — falling back to legacy path", e)
        # Fallback: direct Gemini without LangChain
        chunks = _retrieve_and_rerank(question, collection_id, document_ids, top_k)
        if not chunks:
            return {
                "answer":               "No relevant evidence found in the uploaded documents.",
                "citations":            [],
                "insufficient_evidence": True,
            }
        context_text, citations = _format_citations_legacy(chunks)
        prompt = (
            f"Answer strictly based on the context.\n\nContext:\n{context_text}\n\nQuestion: {question}"
        )
        answer = _call_gemini_direct(prompt)
        return {
            "answer":               answer,
            "citations":            citations,
            "insufficient_evidence": False,
        }

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
        "query_was_rewritten":   result.query_was_rewritten,
        "rewritten_query":       result.rewritten_query,
    }


# ── summarize_document — unchanged logic ─────────────────────────────────────

def summarize_document(document_id: str) -> Dict[str, Any]:
    """Summarise a document using its top chunks. No LangChain needed here."""
    query = "summary overview abstract introduction"
    chunks = _retrieve_and_rerank(query, collection_id=None, document_ids=[document_id], top_k=10)

    if not chunks:
        return {"summary": "No text found for this document to summarize."}

    context_text, _ = _format_citations_legacy(chunks)
    prompt = f"Summarize the following document excerpts:\n\n{context_text}"
    summary = _call_gemini_direct(prompt, "You are an expert summarizer.")
    return {"summary": summary}


# ── review_document — unchanged logic ────────────────────────────────────────

def review_document(document_id: str) -> Dict[str, Any]:
    """Critical review of a document. No LangChain needed here."""
    query = "conclusion findings limitations future work"
    chunks = _retrieve_and_rerank(query, collection_id=None, document_ids=[document_id], top_k=10)

    if not chunks:
        return {"review": "No text found for this document to review."}

    context_text, _ = _format_citations_legacy(chunks)
    prompt = f"Provide a critical review of the following document excerpts:\n\n{context_text}"
    review = _call_gemini_direct(prompt, "You are a critical academic reviewer.")
    return {"review": review}


# ── compare_documents — now uses LangChain structured output ─────────────────

def compare_documents(
    document_ids: List[str],
    collection_id: Optional[str],
    question: Optional[str],
    top_k: int = 12,
) -> Dict[str, Any]:
    """Paper comparison using LangChain structured output."""
    from rag.chain import run_comparison_chain

    query = question or "Compare the main findings, methodologies, and conclusions."

    try:
        result = run_comparison_chain(
            document_ids=document_ids,
            collection_id=collection_id,
            question=query,
            top_k=top_k,
        )

        citations_out = [
            {
                "chunkId":    c.chunk_id,
                "documentId": c.document_id,
                "documentTitle": c.document_title,
                "pageNumber": c.page_number,
                "sourceText": c.source_text,
                "relevance":  c.relevance,
            }
            for c in result.citations
        ]

        return {
            "answer":                result.narrative,
            "narrative":             result.narrative,
            "methods":               result.methods,
            "datasets":              result.datasets,
            "strengths":             result.strengths,
            "weaknesses":            result.weaknesses,
            "findings":              result.findings,
            "futureWork":            result.future_work,
            "citations":             citations_out,
            "insufficient_evidence": result.insufficient_evidence,
        }
    except Exception as e:
        logger.error("compare_documents LangChain failed: %s — falling back", e)
        # Fallback to direct Gemini
        chunks = _retrieve_and_rerank(query, collection_id, document_ids, top_k)
        if not chunks:
            return {"answer": "No relevant context found to compare.", "citations": []}
        context_text, citations = _format_citations_legacy(chunks)
        prompt = f"Compare the documents. Query: '{query}'\n\nContext:\n{context_text}"
        answer = _call_gemini_direct(prompt, "You are an expert academic researcher comparing papers.")
        return {"answer": answer, "citations": citations}


# ── literature_review — now uses LangChain structured output ─────────────────

def literature_review(
    collection_id: Optional[str],
    document_ids: Optional[List[str]],
    topic: Optional[str],
) -> Dict[str, Any]:
    """Literature review using LangChain structured output."""
    from rag.chain import run_literature_review_chain

    topic = topic or "Comprehensive literature review"

    try:
        result = run_literature_review_chain(
            collection_id=collection_id,
            document_ids=document_ids,
            topic=topic,
        )

        citations_out = [
            {
                "chunkId":    c.chunk_id,
                "documentId": c.document_id,
                "documentTitle": c.document_title,
                "pageNumber": c.page_number,
                "sourceText": c.source_text,
                "relevance":  c.relevance,
            }
            for c in (result.citations or [])
        ]

        # Convert sections dict to the shape NestJS QueryService expects
        sections_out = {}
        for key, section in result.sections.items():
            sections_out[key] = {
                "heading":   section.heading,
                "content":   section.content,
                "citations": [
                    {
                        "chunkId":    c.chunk_id,
                        "documentId": c.document_id,
                        "documentTitle": c.document_title,
                        "pageNumber": c.page_number,
                        "sourceText": c.source_text,
                        "relevance":  c.relevance,
                    }
                    for c in (section.citations or [])
                ],
            }

        return {
            "title":                 result.title,
            "topic":                 result.topic,
            "sections":              sections_out,
            "markdown":              result.markdown,
            "citations":             citations_out,
            "insufficient_evidence": result.insufficient_evidence,
        }
    except Exception as e:
        logger.error("literature_review LangChain failed: %s — falling back", e)
        chunks = _retrieve_and_rerank(topic, collection_id, document_ids, 15)
        if not chunks:
            return {"review": "No relevant context found."}
        context_text, _ = _format_citations_legacy(chunks)
        prompt = f"Write a literature review on '{topic}':\n\n{context_text}"
        review = _call_gemini_direct(prompt, "You are an expert academic writer.")
        return {"review": review}
