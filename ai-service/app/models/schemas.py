"""Pydantic request/response schemas for the DocLens AI service."""
from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field


ProcessingStage = Literal[
    "UPLOADED",
    "EXTRACTING",
    "CHUNKING",
    "EMBEDDING",
    "INDEXING",
    "READY",
    "FAILED",
]

RetrievalMode = Literal["vector"]


class IngestRequest(BaseModel):
    document_id: str
    file_path: str
    collection_id: str
    workspace_id: str | None = None
    callback_url: str | None = None


class IngestResponse(BaseModel):
    document_id: str
    status: str
    message: str = ""


class StatusResponse(BaseModel):
    document_id: str
    stage: ProcessingStage
    progress_pct: int
    error: str | None = None


class SearchRequest(BaseModel):
    query: str
    collection_id: str
    top_k: int = Field(default=5, ge=1, le=50)
    retrieval_mode: RetrievalMode = "vector"
    document_ids: list[str] | None = None


class ChunkResult(BaseModel):
    chunk_text: str
    score: float
    document_id: str
    document_title: str
    page_number: int | None = None
    chunk_index: int | None = None
    vector_id: str | None = None
    retrieval_path: list[str] = Field(default_factory=list)
    matched_entities: list[str] = Field(default_factory=list)


class SearchResponse(BaseModel):
    results: list[ChunkResult]
    query: str
    total: int
    retrieval_mode: RetrievalMode = "vector"


class AskRequest(BaseModel):
    question: str
    collection_id: str
    session_id: str | None = None
    top_k: int = Field(default=5, ge=1, le=50)
    retrieval_mode: RetrievalMode = "vector"
    document_ids: list[str] | None = None


class Citation(BaseModel):
    document_id: str
    document_title: str
    page_number: int | None = None
    chunk_index: int | None = None
    chunk_text: str
    score: float
    retrieval_path: list[str] = Field(default_factory=list)


class AskResponse(BaseModel):
    answer: str
    citations: list[Citation]
    latency_ms: int
    model_used: str
    retrieval_mode: RetrievalMode = "vector"


class SummariseRequest(BaseModel):
    document_id: str


class SummariseResponse(BaseModel):
    document_id: str
    summary: str


class CompareRequest(BaseModel):
    document_ids: list[str] = Field(default_factory=list)
    collection_id: str | None = None
    question: str | None = None
    top_k: int = Field(default=12, ge=2, le=50)


class CompareResponse(BaseModel):
    methods: list[str]
    strengths: list[str]
    weaknesses: list[str]
    datasets: list[str]
    metrics: list[str]
    narrative: str
    citations: list[Citation] = Field(default_factory=list)


class GraphNode(BaseModel):
    id: str
    name: str
    type: str
    document_id: str | None = None
    count: int = 1


class GraphEdge(BaseModel):
    source: str
    target: str
    type: str
    weight: float = 1.0
    document_id: str | None = None


class GraphResponse(BaseModel):
    nodes: list[GraphNode]
    edges: list[GraphEdge]


class ExpandRequest(BaseModel):
    entity_name: str
    collection_id: str
    depth: int = Field(default=2, ge=1, le=4)


class EntitySearchResponse(BaseModel):
    entities: list[dict[str, Any]]
    total: int
    source: str = "neo4j"


class InsightsResponse(BaseModel):
    top_concepts: list[dict[str, Any]]
    top_methods: list[dict[str, Any]]
    most_connected: list[dict[str, Any]]
    concept_co_occurrences: list[dict[str, Any]]
    related_concepts: list[dict[str, Any]] = Field(default_factory=list)
    total_entities: int
    total_relationships: int
