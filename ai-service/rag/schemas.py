# ai-service/rag/schemas.py
# ─────────────────────────────────────────────────────────────────────────────
# Pydantic v2 structured output schemas for all LangChain outputs.
# These are the ONLY allowed return shapes from the LLM layer.
# ─────────────────────────────────────────────────────────────────────────────
from __future__ import annotations

from typing import List, Optional, Dict
from pydantic import BaseModel, Field


# ── Citation reference ────────────────────────────────────────────────────────

class CitationRef(BaseModel):
    """
    A grounded reference to a specific chunk from a document.
    Must point to a real chunk_id that exists in the database.
    """
    chunk_id: str = Field(description="UUID of the DocumentChunk in the database")
    document_id: str = Field(description="UUID of the parent Document")
    document_title: str = Field(description="Human-readable title of the source document")
    page_number: Optional[int] = Field(None, description="Page number within the source document")
    source_text: str = Field(
        description="The exact excerpt from the chunk that supports this citation. "
                    "Must be a verbatim substring of the chunk content."
    )
    relevance: float = Field(0.0, description="Retrieval relevance score (0.0–1.0)")


# ── Claim with evidence ───────────────────────────────────────────────────────

class Claim(BaseModel):
    """
    A single factual assertion in the answer.
    Each claim must be independently supported by at least one citation.
    """
    claim_text: str = Field(description="The factual assertion being made")
    supported_by: List[CitationRef] = Field(
        default_factory=list,
        description="Citations that directly support this claim"
    )
    verified: bool = Field(
        False,
        description="True if at least one citation's source_text directly supports the claim"
    )


# ── Structured answer ─────────────────────────────────────────────────────────

class StructuredAnswer(BaseModel):
    """
    Full structured response from the RAG pipeline.
    If insufficient_evidence=True, no answer or claims are fabricated.
    """
    answer: str = Field(
        description="The synthesised answer grounded in the provided evidence"
    )
    claims: List[Claim] = Field(
        default_factory=list,
        description="Individual factual claims within the answer, each with citations"
    )
    citations: List[CitationRef] = Field(
        default_factory=list,
        description="All citations used in the answer"
    )
    insufficient_evidence: bool = Field(
        False,
        description="Set to True when the retrieved evidence is insufficient to answer the question. "
                    "When True, answer should explain what information is missing."
    )
    confidence: float = Field(
        0.0,
        ge=0.0,
        le=1.0,
        description="Overall confidence in the answer (0.0–1.0) based on evidence quality"
    )
    query_was_rewritten: bool = Field(
        False,
        description="True if the original question was rewritten using conversation history"
    )
    rewritten_query: Optional[str] = Field(
        None,
        description="The rewritten query, if query_was_rewritten=True"
    )
    uncited_sentences: int = Field(
        0,
        description="Answer sentences with factual content but no evidence marker (set by the server)"
    )
    evidence_conflict: bool = Field(
        False,
        description="The cited evidence disagrees (different numbers or opposite conclusions)"
    )
    background: Optional[str] = Field(
        None,
        description="General-knowledge context from the model, NOT from the papers; shown separately and never cited"
    )
    abstain_reason: Optional[str] = Field(
        None,
        description="Why the pipeline abstained before generation: no_chunks or low_relevance"
    )
    top_similarity: Optional[float] = Field(None, description="Best BGE-M3 cosine among retrieved chunks")
    top_rerank: Optional[float] = Field(None, description="Best cross-encoder score, when the reranker ran")


# ── Paper comparison ──────────────────────────────────────────────────────────

class PaperComparisonResult(BaseModel):
    """Structured output for paper-to-paper comparison."""
    narrative: str = Field(description="Synthesised comparative narrative")
    methods: List[str] = Field(default_factory=list, description="Methodologies per paper")
    datasets: List[str] = Field(default_factory=list, description="Datasets used per paper")
    strengths: List[str] = Field(default_factory=list, description="Strengths per paper")
    weaknesses: List[str] = Field(default_factory=list, description="Weaknesses per paper")
    findings: List[str] = Field(default_factory=list, description="Key findings per paper")
    future_work: List[str] = Field(default_factory=list, description="Future directions")
    citations: List[CitationRef] = Field(default_factory=list)
    insufficient_evidence: bool = Field(False)


# ── Literature review ─────────────────────────────────────────────────────────

class LiteratureReviewSection(BaseModel):
    heading: str
    content: str
    citations: List[CitationRef] = Field(default_factory=list)


class LiteratureReviewResult(BaseModel):
    """Structured output for a literature review."""
    title: str
    topic: Optional[str] = None
    sections: Dict[str, LiteratureReviewSection] = Field(default_factory=dict)
    citations: List[CitationRef] = Field(default_factory=list)
    markdown: str = Field(description="Full markdown rendition of the review")
    insufficient_evidence: bool = Field(False)


# ── Knowledge Graph ───────────────────────────────────────────────────────────

class KGEntity(BaseModel):
    """An entity extracted from a document for the Knowledge Graph."""
    name: str
    normalized_name: str
    entity_type: str = Field(
        description="One of: AUTHOR, PAPER, CONCEPT, DATASET, METHOD, MODEL, METRIC"
    )
    mentions: int = Field(1, ge=1)
    pages: List[int] = Field(default_factory=list)
    confidence: float = Field(1.0, ge=0.0, le=1.0)
    supporting_chunk_ids: List[str] = Field(
        default_factory=list,
        description="chunk_ids from which this entity was extracted"
    )


class KGRelationship(BaseModel):
    """A relationship between two KG entities, with source evidence."""
    source_name: str
    source_type: str
    target_name: str
    target_type: str
    relation_type: str = Field(
        description="One of: USES, EVALUATED_ON, REPORTS, COMPARED_WITH, BASED_ON, "
                    "RELATED_TO, AUTHORED_BY, HAS_CONCEPT, HAS_METHOD, HAS_DATASET, "
                    "HAS_METRIC, HAS_MODEL"
    )
    confidence: float = Field(1.0, ge=0.0, le=1.0)
    evidence_chunk_id: Optional[str] = Field(
        None,
        description="chunk_id of the chunk that provides evidence for this relationship"
    )
    evidence_text: Optional[str] = Field(
        None,
        description="The verbatim text excerpt that supports this relationship"
    )


class KGExtractionResult(BaseModel):
    """Complete KG extraction result for one document."""
    document_id: str
    entities: List[KGEntity] = Field(default_factory=list)
    relationships: List[KGRelationship] = Field(default_factory=list)


# ── Paper profile (per-paper structured extraction, built at ingest) ─────────

class EvidencedPoint(BaseModel):
    """One extracted fact about a paper, tied to the chunk it came from."""
    text: str = Field(description="Concise statement of the fact, in your own words")
    evidence_number: Optional[int] = Field(None, description="N of the [Evidence N] block that supports it")
    quote: Optional[str] = Field(None, description="Short verbatim excerpt (<= 30 words) from that evidence block")
    chunk_id: Optional[str] = Field(None, description="Set by the server; leave empty")
    page_number: Optional[int] = None
    grounded: bool = Field(False, description="Set by the server after validation; leave false")


class PaperProfile(BaseModel):
    """Structured research card for one paper. Each list item cites evidence."""
    research_problem: str = Field("", description="The problem or question the paper addresses (1-2 sentences)")
    paper_type: str = Field(
        "empirical",
        description="One of: empirical, method, system, theoretical, survey, dataset, position, case_study",
    )
    domain: str = Field("", description="Research field / application domain")
    contributions: List[EvidencedPoint] = Field(default_factory=list)
    methods: List[EvidencedPoint] = Field(default_factory=list, description="Methods, models, algorithms used or proposed")
    datasets: List[EvidencedPoint] = Field(default_factory=list, description="Datasets, corpora, cohorts, benchmarks")
    metrics: List[EvidencedPoint] = Field(default_factory=list, description="Evaluation metrics")
    key_results: List[EvidencedPoint] = Field(default_factory=list, description="Main quantitative/qualitative findings")
    baselines: List[EvidencedPoint] = Field(default_factory=list, description="Methods compared against")
    limitations: List[EvidencedPoint] = Field(default_factory=list, description="Limitations stated by the authors")
    assumptions: List[EvidencedPoint] = Field(default_factory=list, description="Explicit or clearly implied assumptions")
    future_work: List[EvidencedPoint] = Field(default_factory=list, description="Future work / open problems stated by the authors")
    keywords: List[str] = Field(default_factory=list)


# ── Research gap analysis ─────────────────────────────────────────────────────

class ResearchGap(BaseModel):
    title: str = Field(description="Short name of the gap")
    gap_type: str = Field(
        description="One of: methodological, empirical, dataset, evaluation, theoretical, "
                    "population, application, reproducibility, contradiction"
    )
    description: str = Field(description="What is missing or unresolved across the papers")
    rationale: str = Field(description="Why the evidence implies this gap (cite papers)")
    evidence_numbers: List[int] = Field(default_factory=list, description="N of each [Evidence N] block that motivates the gap")
    evidence: List[CitationRef] = Field(default_factory=list, description="Set by the server; leave empty")
    related_document_ids: List[str] = Field(default_factory=list, description="Set by the server; leave empty")
    suggested_research_questions: List[str] = Field(default_factory=list)
    suggested_approach: str = Field("", description="A concrete study design that could close the gap")
    confidence: float = Field(0.5, ge=0.0, le=1.0)
    grounded: bool = Field(False, description="Set by the server after validation; leave false")


class ContradictionPosition(BaseModel):
    paper_title: str
    stance: str
    evidence_number: Optional[int] = Field(None, description="N of the [Evidence N] block stating this stance")
    document_id: Optional[str] = Field(None, description="Set by the server; leave empty")
    citation: Optional[CitationRef] = Field(None, description="Set by the server; leave empty")


class Contradiction(BaseModel):
    topic: str
    positions: List[ContradictionPosition] = Field(default_factory=list)
    possible_explanation: str = ""


class ResearchGapResult(BaseModel):
    summary: str = Field(description="2-4 sentence overview of the research landscape and its main gaps")
    consensus: List[str] = Field(default_factory=list, description="Points most papers agree on")
    contradictions: List[Contradiction] = Field(default_factory=list)
    gaps: List[ResearchGap] = Field(default_factory=list)
    insufficient_evidence: bool = False


# ── Literature review draft (list-based, safe for native structured output) ──

class ReviewSectionDraft(BaseModel):
    key: str = Field(
        description="One of: introduction, existingApproaches, commonMethodologies, keyFindings, "
                    "limitations, researchGaps, futureDirections"
    )
    heading: str
    content: str = Field(description="Synthesised prose. Cite inline as [Evidence N].")
    evidence_numbers: List[int] = Field(default_factory=list, description="Evidence block numbers cited in content")


class PaperMatrixRow(BaseModel):
    document_id: str = ""
    title: str
    problem: str = ""
    method: str = ""
    datasets: str = ""
    metrics: str = ""
    key_result: str = ""
    limitation: str = ""


class LiteratureReviewDraft(BaseModel):
    title: str
    sections: List[ReviewSectionDraft] = Field(default_factory=list)
    themes: List[str] = Field(default_factory=list, description="Cross-paper themes found")
    insufficient_evidence: bool = False


class ComparisonDraft(BaseModel):
    narrative: str = Field(description="Comparative narrative. Cite inline as [Evidence N].")
    methods: List[str] = Field(default_factory=list, description="'<paper title>: <method>' per paper")
    datasets: List[str] = Field(default_factory=list, description="'<paper title>: <datasets>' per paper")
    strengths: List[str] = Field(default_factory=list)
    weaknesses: List[str] = Field(default_factory=list)
    findings: List[str] = Field(default_factory=list)
    future_work: List[str] = Field(default_factory=list)
    agreements: List[str] = Field(default_factory=list, description="Where the papers agree")
    disagreements: List[str] = Field(default_factory=list, description="Where the papers conflict")
    evidence_numbers: List[int] = Field(default_factory=list)
    insufficient_evidence: bool = False


# ── Q&A draft (LLM cites evidence numbers; server builds CitationRefs) ───────

class ClaimDraft(BaseModel):
    claim_text: str
    evidence_numbers: List[int] = Field(default_factory=list, description="N of each [Evidence N] block supporting the claim")


class AnswerDraft(BaseModel):
    answer: str = Field(description="Grounded answer. Cite inline as [Evidence N].")
    claims: List[ClaimDraft] = Field(default_factory=list, description="Each factual claim in the answer")
    insufficient_evidence: bool = False
    confidence: float = Field(0.0, ge=0.0, le=1.0)
    evidence_conflict: bool = Field(False, description="True when evidence blocks disagree on the answer")
    background: str = Field("", description="Optional general-knowledge context, only for general/conceptual "
                                            "questions. Never paper-specific facts. No [Evidence N] markers.")


class BackgroundDraft(BaseModel):
    """Used when the papers hold no relevant evidence at all."""
    is_general: bool = Field(description="True only for general-knowledge questions not about the user's papers")
    background: str = Field("", description="Short general-knowledge answer when is_general, else empty")
