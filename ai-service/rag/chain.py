# ai-service/rag/chain.py
# ─────────────────────────────────────────────────────────────────────────────
# Full LangChain RAG pipeline for DocLens.
#
# Pipeline:
#   question
#   → conditional query rewriting (only if history is non-empty)
#   → DocLensRetriever (existing RRF SQL, unchanged)
#   → BGE reranking (inside retriever)
#   → evidence selection
#   → Gemini (structured output via Pydantic)
#   → claim verification
#   → citation validation
#   → StructuredAnswer
# ─────────────────────────────────────────────────────────────────────────────
from __future__ import annotations

import logging
import os
from typing import List, Optional, Dict, Any

from langchain_core.documents import Document as LCDocument
from langchain_core.messages import HumanMessage, AIMessage, SystemMessage
from langchain_core.output_parsers import PydanticOutputParser
from langchain_core.prompts import ChatPromptTemplate, MessagesPlaceholder
from langchain_core.runnables import RunnableBranch, RunnableLambda, RunnablePassthrough
from langchain_google_genai import ChatGoogleGenerativeAI

from .schemas import (
    CitationRef,
    Claim,
    StructuredAnswer,
    PaperComparisonResult,
    LiteratureReviewResult,
    LiteratureReviewSection,
)
from .retriever import DocLensRetriever
from .verification import verify_claims, validate_citations, unsupported_claim_rate

logger = logging.getLogger(__name__)

# Default model — can be overridden via LLM_MODEL env var
DEFAULT_MODEL = "gemini-1.5-flash"


def _get_llm() -> ChatGoogleGenerativeAI:
    """Lazily create the Gemini LLM. Fails loudly if API key is missing."""
    api_key = os.getenv("GEMINI_API_KEY")
    if not api_key:
        raise RuntimeError(
            "GEMINI_API_KEY is not set. Set it in your .env file or environment."
        )
    model = os.getenv("LLM_MODEL", DEFAULT_MODEL)
    # Normalise model name: strip any "google/" prefix or ":free" suffix
    model = model.replace("google/", "").replace(":free", "")
    return ChatGoogleGenerativeAI(
        model=model,
        google_api_key=api_key,
        temperature=0.1,  # Low temperature for factual research answers
    )


def _format_history(history: List[Dict[str, str]]) -> List[HumanMessage | AIMessage]:
    """Convert raw history dicts to LangChain message objects."""
    messages = []
    for h in history or []:
        role = h.get("role", "user")
        content = h.get("content", "")
        if role == "user":
            messages.append(HumanMessage(content=content))
        else:
            messages.append(AIMessage(content=content))
    return messages


def _chunks_to_context(docs: List[LCDocument]) -> str:
    """Format retrieved chunks into a numbered evidence context block."""
    if not docs:
        return "(No evidence retrieved)"
    parts = []
    for i, doc in enumerate(docs, 1):
        meta = doc.metadata
        parts.append(
            f"[Evidence {i}]\n"
            f"chunk_id: {meta.get('chunk_id', 'unknown')}\n"
            f"document_id: {meta.get('document_id', 'unknown')}\n"
            f"page: {meta.get('page_number', 'N/A')}\n"
            f"---\n{doc.page_content}\n"
        )
    return "\n".join(parts)


def _docs_to_raw_chunks(docs: List[LCDocument]) -> list:
    """Convert LangChain Documents back to the raw-chunk format used by pg_store."""
    return [
        {
            "id":          doc.metadata.get("chunk_id", ""),
            "documentId":  doc.metadata.get("document_id", ""),
            "content":     doc.page_content,
            "pageNumber":  doc.metadata.get("page_number"),
            "chunkIndex":  doc.metadata.get("chunk_index"),
            "score":       doc.metadata.get("score", 0.0),
        }
        for doc in docs
    ]


# ── Answer parsing ────────────────────────────────────────────────────────────

_ANSWER_SYSTEM = """You are DocLens AI, a rigorous research assistant.

Your task is to answer the user's question STRICTLY based on the provided evidence.

RULES:
1. Every factual claim MUST be supported by at least one [Evidence N] block.
2. If the evidence is insufficient, set insufficient_evidence=true and explain what is missing.
3. NEVER fabricate citations, source text, or chunk_ids.
4. Use the exact chunk_id and document_id values from the evidence blocks.
5. source_text must be a near-verbatim excerpt (not paraphrase) from the evidence.
6. Citations should point only to evidence that directly supports the specific claim.
7. Be precise and academic in tone.

OUTPUT FORMAT: You must respond with valid JSON matching this schema exactly:
{format_instructions}"""

_ANSWER_HUMAN = """Evidence:
{context}

Question: {question}

Respond with a JSON object matching the schema."""


def _build_answer_chain(llm: ChatGoogleGenerativeAI):
    parser = PydanticOutputParser(pydantic_object=StructuredAnswer)
    prompt = ChatPromptTemplate.from_messages([
        SystemMessage(content=_ANSWER_SYSTEM.format(format_instructions=parser.get_format_instructions())),
        MessagesPlaceholder(variable_name="history", optional=True),
        HumanMessage(content=_ANSWER_HUMAN),
    ])
    # We use a plain prompt + LLM + parser chain
    return prompt | llm | parser


def _build_query_rewrite_chain(llm: ChatGoogleGenerativeAI):
    """Rewrite a question in the context of conversation history."""
    rewrite_prompt = ChatPromptTemplate.from_messages([
        SystemMessage(content=(
            "Given the conversation history and a follow-up question, "
            "rewrite the follow-up as a standalone question that captures "
            "all necessary context. "
            "Return ONLY the rewritten question — no explanation, no prefix."
        )),
        MessagesPlaceholder(variable_name="history"),
        HumanMessage(content="Follow-up question: {question}\n\nRewritten standalone question:"),
    ])
    return rewrite_prompt | llm | (lambda msg: msg.content.strip())


# ── Main pipeline class ───────────────────────────────────────────────────────

class DocLensRAGChain:
    """
    Full DocLens RAG pipeline using LangChain.

    Usage:
        chain = DocLensRAGChain.create(collection_id="...", top_k=10)
        result: StructuredAnswer = chain.invoke(
            question="What is the main contribution?",
            history=[{"role": "user", "content": "..."}, ...],
        )
    """

    def __init__(self, retriever: DocLensRetriever, llm: ChatGoogleGenerativeAI):
        self._retriever = retriever
        self._llm = llm
        self._answer_chain = _build_answer_chain(llm)
        self._rewrite_chain = _build_query_rewrite_chain(llm)

    @classmethod
    def create(
        cls,
        collection_id: Optional[str] = None,
        document_ids: Optional[List[str]] = None,
        top_k: int = 10,
    ) -> "DocLensRAGChain":
        retriever = DocLensRetriever.create(
            collection_id=collection_id,
            document_ids=document_ids,
            top_k=top_k,
        )
        llm = _get_llm()
        return cls(retriever, llm)

    def invoke(
        self,
        question: str,
        history: Optional[List[Dict[str, str]]] = None,
    ) -> StructuredAnswer:
        """
        Run the full RAG pipeline.

        Returns StructuredAnswer with:
        - answer: grounded response
        - claims: individual verified claims
        - citations: validated citations
        - insufficient_evidence: True if evidence is lacking
        """
        history = history or []
        lc_history = _format_history(history)

        # ── Step 1: Conditional query rewriting ─────────────────────────────
        # Only rewrite if there's conversation history (the question may be
        # a follow-up like "what about the second method?")
        effective_question = question
        query_was_rewritten = False

        if history:
            try:
                rewritten = self._rewrite_chain.invoke({
                    "question": question,
                    "history": lc_history,
                })
                if rewritten and rewritten.lower() != question.lower():
                    logger.info(
                        "Query rewritten: %r → %r",
                        question[:60],
                        rewritten[:60],
                    )
                    effective_question = rewritten
                    query_was_rewritten = True
            except Exception as e:
                logger.warning("Query rewriting failed, using original: %s", e)

        # ── Step 2: Retrieve (RRF + BGE reranking inside retriever) ─────────
        docs = self._retriever.invoke(effective_question)

        if not docs:
            return StructuredAnswer(
                answer=(
                    "I could not find sufficient evidence in the uploaded documents "
                    "to answer this question. Please ensure the relevant papers have "
                    "been uploaded and processed."
                ),
                claims=[],
                citations=[],
                insufficient_evidence=True,
                confidence=0.0,
                query_was_rewritten=query_was_rewritten,
                rewritten_query=effective_question if query_was_rewritten else None,
            )

        # ── Step 3: Format context block ─────────────────────────────────────
        context = _chunks_to_context(docs)
        raw_chunks = _docs_to_raw_chunks(docs)

        # ── Step 4: Gemini with structured output ────────────────────────────
        try:
            result: StructuredAnswer = self._answer_chain.invoke({
                "question":   effective_question,
                "context":    context,
                "history":    lc_history,
            })
        except Exception as e:
            logger.error("LLM chain failed: %s", e)
            # Fallback: return insufficient_evidence rather than crashing
            return StructuredAnswer(
                answer=f"The AI service encountered an error: {e}. "
                       f"Retrieved {len(docs)} relevant chunks but could not generate an answer.",
                claims=[],
                citations=[],
                insufficient_evidence=True,
                confidence=0.0,
            )

        # ── Step 5: Citation validation ───────────────────────────────────────
        validated_citations = validate_citations(result.citations, raw_chunks)

        # ── Step 6: Claim verification (NO EVIDENCE = NO CLAIM) ──────────────
        verified_claims = verify_claims(result.claims)
        ucr = unsupported_claim_rate(verified_claims)
        if ucr > 0:
            logger.warning(
                "Answer has %.0f%% unsupported claims (%d/%d)",
                ucr * 100,
                sum(1 for c in verified_claims if not c.verified),
                len(verified_claims),
            )

        return StructuredAnswer(
            answer=result.answer,
            claims=verified_claims,
            citations=validated_citations,
            insufficient_evidence=result.insufficient_evidence,
            confidence=result.confidence,
            query_was_rewritten=query_was_rewritten,
            rewritten_query=effective_question if query_was_rewritten else None,
        )


# ── Paper comparison chain ────────────────────────────────────────────────────

_COMPARE_SYSTEM = """You are a rigorous academic researcher comparing scientific papers.
Compare ONLY based on the provided evidence. Do not fabricate any information.
If the evidence is insufficient for comparison, set insufficient_evidence=true.
Output valid JSON matching: {format_instructions}"""

_COMPARE_HUMAN = """Evidence from the papers being compared:
{context}

Comparison question or focus: {question}

Provide a structured comparison."""


def run_comparison_chain(
    document_ids: List[str],
    collection_id: Optional[str],
    question: str,
    top_k: int = 12,
) -> PaperComparisonResult:
    """LangChain-backed paper comparison using structured output."""
    llm = _get_llm()
    parser = PydanticOutputParser(pydantic_object=PaperComparisonResult)
    prompt = ChatPromptTemplate.from_messages([
        SystemMessage(content=_COMPARE_SYSTEM.format(format_instructions=parser.get_format_instructions())),
        HumanMessage(content=_COMPARE_HUMAN),
    ])

    retriever = DocLensRetriever.create(
        collection_id=collection_id,
        document_ids=document_ids,
        top_k=top_k,
    )
    docs = retriever.invoke(question or "Compare the main findings, methods, and conclusions")
    raw_chunks = _docs_to_raw_chunks(docs)

    if not docs:
        return PaperComparisonResult(
            narrative="Insufficient evidence to compare the selected documents.",
            insufficient_evidence=True,
        )

    context = _chunks_to_context(docs)
    chain = prompt | llm | parser
    try:
        result = chain.invoke({"question": question, "context": context})
        # Validate citations
        result.citations = validate_citations(result.citations, raw_chunks)
        return result
    except Exception as e:
        logger.error("Comparison chain failed: %s", e)
        return PaperComparisonResult(
            narrative=f"Comparison failed due to an error: {e}",
            insufficient_evidence=True,
        )


# ── Literature review chain ───────────────────────────────────────────────────

_REVIEW_SYSTEM = """You are an expert academic writer producing a structured literature review.
Write ONLY based on the provided evidence. Cite every claim.
If evidence is insufficient, set insufficient_evidence=true.
Output valid JSON matching: {format_instructions}"""

_REVIEW_HUMAN = """Evidence:
{context}

Topic: {topic}

Write a structured literature review with sections: Introduction, Methods, Findings, Gaps, Conclusion.
Also generate a full markdown version in the 'markdown' field."""


def run_literature_review_chain(
    collection_id: Optional[str],
    document_ids: Optional[List[str]],
    topic: str,
    top_k: int = 15,
) -> LiteratureReviewResult:
    """LangChain-backed literature review using structured output."""
    llm = _get_llm()
    parser = PydanticOutputParser(pydantic_object=LiteratureReviewResult)
    prompt = ChatPromptTemplate.from_messages([
        SystemMessage(content=_REVIEW_SYSTEM.format(format_instructions=parser.get_format_instructions())),
        HumanMessage(content=_REVIEW_HUMAN),
    ])

    retriever = DocLensRetriever.create(
        collection_id=collection_id,
        document_ids=document_ids,
        top_k=top_k,
    )
    docs = retriever.invoke(topic or "comprehensive literature review")
    raw_chunks = _docs_to_raw_chunks(docs)

    if not docs:
        return LiteratureReviewResult(
            title=f"Literature Review: {topic}",
            topic=topic,
            sections={},
            markdown="Insufficient evidence to generate a literature review.",
            insufficient_evidence=True,
        )

    context = _chunks_to_context(docs)
    chain = prompt | llm | parser
    try:
        result = chain.invoke({"topic": topic, "context": context})
        result.citations = validate_citations(result.citations or [], raw_chunks)
        return result
    except Exception as e:
        logger.error("Literature review chain failed: %s", e)
        return LiteratureReviewResult(
            title=f"Literature Review: {topic}",
            topic=topic,
            sections={},
            markdown=f"Literature review failed due to an error: {e}",
            insufficient_evidence=True,
        )
