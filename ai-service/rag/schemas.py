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
