# ai-service/rag/chain.py
# ─────────────────────────────────────────────────────────────────────────────
# Conversational research Q&A.
#
# Pipeline:
#   question
#   → conditional query rewriting (only if history is non-empty)
#   → query routing (section boosts, reference filtering)
#   → multi-query hybrid retrieval (BGE-M3 + OR keyword) → RRF → BGE rerank
#   → relevance floor: no relevant chunk → abstain (optional labelled background
#     for general-knowledge questions, never cited)
#   → numbered evidence pack
#   → Gemini structured output (claims cite [Evidence N])
#   → server-side citation resolution + claim verification
#   → StructuredAnswer
#
# Multi-paper synthesis (compare / literature review / gaps) is in
# rag/synthesis.py.
# ─────────────────────────────────────────────────────────────────────────────
from __future__ import annotations

import logging
import os
import re
import time
from typing import Callable, Dict, List, Optional

from langchain_core.messages import AIMessage, HumanMessage
from langchain_core.prompts import ChatPromptTemplate, MessagesPlaceholder

from .evidence import EvidencePack, renumber_markers
from .llm import get_llm, invoke_structured, message_text
from .query_router import route_query
from .retriever import DocLensRetriever, top_scores
from .schemas import AnswerDraft, BackgroundDraft, Claim, StructuredAnswer
from .verification import check_claim, is_content_sentence, unsupported_claim_rate

logger = logging.getLogger(__name__)

# No-relevant-evidence floor (eval/abstention_calibration.py, 2026-10-24, 12 local
# PDFs): every answerable gold/validation question had a top BGE-M3 cosine
# >= 0.55 and every off-topic question <= 0.44. Questions about the papers whose
# answer is absent overlap the answerable range (0.53-0.66), so this floor only
# catches off-topic questions; the prompt rules and claim checks handle the rest.
RETRIEVAL_MIN_SIMILARITY = float(os.getenv("RETRIEVAL_MIN_SIMILARITY", "0.48") or 0)
# Same idea for the cross-encoder score when the reranker runs; 0 disables it.
RETRIEVAL_MIN_RERANK = float(os.getenv("RETRIEVAL_MIN_RERANK", "0") or 0)

NO_EVIDENCE_ANSWER = (
    "Your uploaded papers do not contain passages relevant to this question, so DocLens cannot "
    "answer it from your sources. Check that the right papers are in scope and fully processed."
)


def below_relevance_floor(scores: dict) -> bool:
    """True when the best retrieved chunk is too dissimilar to be evidence.
    A missing score (keyword-only hits, reranker off) never triggers abstention."""
    sim, rerank = scores.get("top_similarity"), scores.get("top_rerank")
    if RETRIEVAL_MIN_SIMILARITY and sim is not None and sim < RETRIEVAL_MIN_SIMILARITY:
        return True
    return bool(RETRIEVAL_MIN_RERANK and rerank is not None and rerank < RETRIEVAL_MIN_RERANK)


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


def _history_text(history: List[Dict[str, str]], limit: int = 6) -> str:
    return "\n".join(f"{h.get('role', 'user')}: {h.get('content', '')[:800]}" for h in (history or [])[-limit:])


def split_facets(question: str) -> List[str]:
    """Split compound research questions into bounded facets without a model call."""
    facets = [
        part.strip()
        for part in re.split(r"\s+(?:and|also|while|versus|vs\.?)\s+|[?;]", question, flags=re.IGNORECASE)
        if len(part.strip().split()) >= 3
    ]
    return list(dict.fromkeys([question, *facets[:3]]))


def production_retriever(
    collection_id: Optional[str], document_ids: Optional[List[str]], top_k: int
) -> DocLensRetriever:
    """The retriever /ask uses. /evaluate builds the same one so metrics match production."""
    # Cap chunks per paper so a multi-paper question sees more than one paper.
    max_per_doc = None if document_ids and len(document_ids) == 1 else max(3, top_k // 2)
    return DocLensRetriever.create(
        collection_id=collection_id,
        document_ids=document_ids,
        top_k=top_k,
        max_per_document=max_per_doc,
    )


def retrieve_merged(retriever: DocLensRetriever, question: str) -> List[dict]:
    """Multi-query retrieval over the question and its facets."""
    # Facet candidates are fused by RRF and reranked once against the full
    # question: one cross-encoder pass instead of one per facet.
    return retriever.retrieve_multi(split_facets(question), question, route_query(question), max(retriever.top_k, 10))


_ANSWER_SYSTEM = """You are DocLens AI, a rigorous research assistant. Answer STRICTLY from the evidence blocks.
RULES:
1. Cite every factual sentence inline as [Evidence N] (several: [Evidence 2, 5]).
2. List each factual claim in `claims` with the evidence_numbers that directly support it.
3. If the evidence is insufficient, set insufficient_evidence=true and say what is missing. Never guess.
4. Keep numbers, metric names, dataset names and units exactly as written in the evidence.
5. When several papers are involved, attribute statements to papers by title and contrast them.
6. type=table blocks: preserve labels and values. type=profile blocks are structured paper summaries;
   prefer citing the original section blocks when both say the same thing.
7. If evidence blocks disagree (different numbers, opposite conclusions), say so explicitly, cite each
   side, do not silently pick one, and set evidence_conflict=true.
8. confidence reflects how directly the evidence answers the question (0-1).
9. `answer` contains ONLY what the evidence says. Never add facts, results, numbers or citations from memory.
10. `background` is optional and usually empty. Fill it (at most 3 sentences) only when the question asks
    about a general concept (e.g. a definition) that the evidence assumes but does not explain. It is general
    knowledge, NOT from the papers: never put paper-specific results, numbers or [Evidence N] markers in it,
    and never use it to answer a question about what the papers report."""

_BACKGROUND_SYSTEM = """The user's uploaded research papers contain no passage relevant to their question.
Decide whether the question is a general-knowledge question (a definition, concept or widely known fact that
is not about the user's specific papers). If it is, set is_general=true and answer it in at most 4 sentences
from general knowledge. If it asks about the user's papers, their results, or anything you would have to
guess, set is_general=false and leave background empty. Never invent citations, studies or numbers."""


def clean_background(text: Optional[str]) -> Optional[str]:
    """Background text is never cited: drop any evidence markers the model added."""
    text = re.sub(r"\s*\[(?:Evidence|Source)[^\]]*\]", "", text or "").strip()
    return text or None


def _build_query_rewrite_chain(llm):
    """Rewrite a question in the context of conversation history."""
    rewrite_prompt = ChatPromptTemplate.from_messages([
        ("system", (
            "Given the conversation history and a follow-up question, "
            "rewrite the follow-up as a standalone question that captures "
            "all necessary context. "
            "Return ONLY the rewritten question — no explanation, no prefix."
        )),
        MessagesPlaceholder(variable_name="history"),
        ("human", "Follow-up question: {question}\n\nRewritten standalone question:"),
    ])
    return rewrite_prompt | llm | (lambda msg: message_text(msg).strip())


class DocLensRAGChain:
    """
    Full DocLens RAG pipeline for conversational Q&A.

    Usage:
        chain = DocLensRAGChain.create(collection_id="...", top_k=10)
        result: StructuredAnswer = chain.invoke(
            question="What is the main contribution?",
            history=[{"role": "user", "content": "..."}, ...],
        )
    """

    def __init__(self, retriever: DocLensRetriever, llm):
        self._retriever = retriever
        self._llm = llm
        self._rewrite_chain = _build_query_rewrite_chain(llm)
        # Wall-clock milliseconds per stage of the last invoke(), for logs and /ask.
        self.last_timings: Dict[str, int] = {}

    @classmethod
    def create(
        cls,
        collection_id: Optional[str] = None,
        document_ids: Optional[List[str]] = None,
        top_k: int = 10,
    ) -> "DocLensRAGChain":
        return cls(production_retriever(collection_id, document_ids, top_k), get_llm())

    def _retrieve(self, question: str) -> List[dict]:
        return retrieve_merged(self._retriever, question)

    def _background(self, question: str) -> Optional[str]:
        """Labelled general-knowledge context for a general question the papers
        do not cover. Any failure means no background, never an error."""
        try:
            draft = invoke_structured(BackgroundDraft, _BACKGROUND_SYSTEM, f"Question: {question}", llm=self._llm)
        except Exception as exc:
            logger.info("Background answer skipped: %s", exc)
            return None
        return clean_background(draft.background) if draft.is_general else None

    def invoke(
        self,
        question: str,
        history: Optional[List[Dict[str, str]]] = None,
        on_stage: Optional[Callable[[str], None]] = None,
    ) -> StructuredAnswer:
        """`on_stage(name)` is called before each stage (rewriting, retrieving,
        generating, verifying); it may raise to cancel the request between stages."""
        history = history or []
        self.last_timings = {}
        clock = {"stage": None, "start": time.perf_counter()}

        def stage(name: Optional[str]) -> None:
            now = time.perf_counter()
            if clock["stage"]:
                self.last_timings[clock["stage"]] = round((now - clock["start"]) * 1000)
            clock["stage"], clock["start"] = name, now
            if name and on_stage:
                on_stage(name)

        # ── Step 1: Conditional query rewriting ─────────────────────────────
        # Only rewrite if there's conversation history (the question may be
        # a follow-up like "what about the second method?")
        effective_question = question
        query_was_rewritten = False
        if history:
            stage("rewriting")
            try:
                rewritten = self._rewrite_chain.invoke({
                    "question": question,
                    "history": _format_history(history),
                })
                if rewritten and rewritten.lower() != question.lower():
                    logger.info("Query rewritten: %r → %r", question[:60], rewritten[:60])
                    effective_question = rewritten
                    query_was_rewritten = True
            except Exception as e:
                logger.warning("Query rewriting failed, using original: %s", e)

        # ── Step 2: Routed multi-query retrieval ────────────────────────────
        stage("retrieving")
        chunks = self._retrieve(effective_question)
        scores = top_scores(chunks)
        if not chunks or below_relevance_floor(scores):
            reason = "no_chunks" if not chunks else "low_relevance"
            logger.info("Abstaining before generation (%s): %s", reason, scores)
            stage("background")
            background = self._background(effective_question)
            stage(None)
            return StructuredAnswer(
                answer=NO_EVIDENCE_ANSWER,
                insufficient_evidence=True,
                confidence=0.0,
                query_was_rewritten=query_was_rewritten,
                rewritten_query=effective_question if query_was_rewritten else None,
                background=background,
                abstain_reason=reason,
                **scores,
            )
        pack = EvidencePack(chunks)

        # ── Step 3: Gemini structured answer over numbered evidence ─────────
        human = f"Evidence:\n{pack.format()}\n\nQuestion: {effective_question}"
        if history:
            human = f"Conversation so far:\n{_history_text(history)}\n\n{human}"
        # LLM errors propagate: an error message must never be returned as an answer.
        stage("generating")
        draft = invoke_structured(AnswerDraft, _ANSWER_SYSTEM, human, llm=self._llm)

        stage("verifying")
        answer = build_structured_answer(draft, pack, query_was_rewritten, effective_question)
        answer.top_similarity, answer.top_rerank = scores["top_similarity"], scores["top_rerank"]
        stage(None)
        logger.info("ask timings (ms): %s", self.last_timings)
        return answer


_REFUSAL = re.compile(
    r"\b(not (mentioned|stated|reported|provided|specified|discussed|covered|found)|no (mention|information|evidence)"
    r"|does not (contain|mention|provide|include|specify)|do not (contain|mention|provide|include|specify)"
    r"|cannot be (determined|answered)|insufficient (evidence|information))\b",
    re.IGNORECASE,
)


def opens_with_refusal(answer: str) -> bool:
    """The model sometimes says "the evidence does not mention X" but leaves
    insufficient_evidence false. Only the opening sentence is checked, so a
    limitation mentioned later in a real answer does not trigger it."""
    first = re.split(r"(?<=[.!?])\s+", (answer or "").strip(), maxsplit=1)[0]
    return bool(_REFUSAL.search(first))


def build_structured_answer(
    draft: AnswerDraft,
    pack: EvidencePack,
    query_was_rewritten: bool = False,
    effective_question: Optional[str] = None,
) -> StructuredAnswer:
    """Resolve [Evidence N] markers to real chunks and verify every claim."""
    order: Dict[int, int] = {}
    for number in pack.numbers_in(draft.answer) + [n for c in draft.claims for n in c.evidence_numbers]:
        if pack.block(number) and number not in order:
            order[number] = len(order) + 1
    # Show the passage window that supports the sentences citing each block,
    # not just the first characters of the chunk.
    cited_sentences: Dict[int, List[str]] = {}
    for sentence in re.split(r"(?<=[.!?])\s+", draft.answer or ""):
        for number in pack.numbers_in(sentence):
            cited_sentences.setdefault(number, []).append(sentence)
    for claim in draft.claims:
        for number in claim.evidence_numbers:
            cited_sentences.setdefault(number, []).append(claim.claim_text)
    citations = [pack.citation(n, hint=" ".join(cited_sentences.get(n, []))) for n in order]

    # NO EVIDENCE = NO CLAIM: a claim is verified only if one of its cited
    # chunks (full text, not the display snippet) actually contains it.
    verified_claims = []
    number_mismatches = 0
    for c in draft.claims:
        claim_text = re.sub(r"\[Evidence[^\]]*\]", "", c.claim_text).strip()
        supporting, reasons = [], []
        for n in c.evidence_numbers:
            if not pack.block(n):
                continue
            ok, reason = check_claim(claim_text, pack.block(n).get("content", ""))
            if ok:
                supporting.append(pack.citation(n, hint=claim_text))
            else:
                reasons.append(reason)
        if not supporting and "numbers" in reasons:
            number_mismatches += 1
        verified_claims.append(Claim(claim_text=claim_text, supported_by=supporting, verified=bool(supporting)))
    ucr = unsupported_claim_rate(verified_claims)
    if ucr > 0:
        logger.warning(
            "Answer has %.0f%% unsupported claims (%d/%d)",
            ucr * 100,
            sum(1 for c in verified_claims if not c.verified),
            len(verified_claims),
        )
    # Factual-looking sentences with no [Evidence N] marker at all: the claims
    # list can omit them, so they would otherwise read as grounded.
    uncited = [
        s for s in re.split(r"(?<=[.!?])\s+", draft.answer or "")
        if is_content_sentence(s) and not pack.numbers_in(s) and not _REFUSAL.search(s)
    ]
    confidence = draft.confidence * (1.0 - 0.5 * ucr)
    answer = renumber_markers(draft.answer, order)
    unsupported = [c.claim_text for c in verified_claims if not c.verified]
    notes = []
    if unsupported:
        # Be explicit instead of presenting every sentence as equally grounded.
        detail = (f" ({number_mismatches} state numbers that do not appear in their cited passages)"
                  if number_mismatches else "")
        notes.append(
            f"{len(unsupported)} of {len(verified_claims)} claims in this answer could not be "
            f"matched to the cited passages{detail} and should be checked against the sources."
        )
    if uncited and citations:
        notes.append(f"{len(uncited)} sentence(s) carry no citation and are not backed by a specific passage.")
    if notes:
        answer += "\n\nNote: " + " ".join(notes)

    return StructuredAnswer(
        answer=answer,
        claims=verified_claims,
        citations=citations,
        insufficient_evidence=draft.insufficient_evidence or not citations or opens_with_refusal(draft.answer),
        confidence=round(confidence * (0.8 if draft.evidence_conflict else 1.0), 3),
        evidence_conflict=draft.evidence_conflict,
        background=clean_background(draft.background),
        query_was_rewritten=query_was_rewritten,
        rewritten_query=effective_question if query_was_rewritten else None,
        uncited_sentences=len(uncited),
    )
