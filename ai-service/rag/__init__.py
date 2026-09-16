# ai-service/rag/__init__.py
"""
DocLens RAG package.
Exports the main LangChain pipeline components.
"""
from .schemas import (
    CitationRef,
    Claim,
    StructuredAnswer,
    PaperComparisonResult,
    LiteratureReviewSection,
    LiteratureReviewResult,
    KGEntity,
    KGRelationship,
    KGExtractionResult,
)
from .retriever import DocLensRetriever
from .chain import DocLensRAGChain

__all__ = [
    "CitationRef",
    "Claim",
    "StructuredAnswer",
    "PaperComparisonResult",
    "LiteratureReviewSection",
    "LiteratureReviewResult",
    "KGEntity",
    "KGRelationship",
    "KGExtractionResult",
    "DocLensRetriever",
    "DocLensRAGChain",
]
