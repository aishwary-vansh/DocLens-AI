"""RAG query, summarization, and comparison endpoints."""
from fastapi import APIRouter

from app.core.rag import answer_question, compare_documents, summarise_document
from app.models.schemas import (
    AskRequest,
    AskResponse,
    Citation,
    CompareRequest,
    CompareResponse,
    SummariseRequest,
    SummariseResponse,
)

router = APIRouter()


@router.post("/ask", response_model=AskResponse)
async def ask(req: AskRequest):
    """Citation-aware question answering scoped to a collection."""
    result = answer_question(
        req.question,
        req.collection_id,
        top_k=req.top_k,
        retrieval_mode=req.retrieval_mode,
        document_ids=req.document_ids,
    )
    return AskResponse(
        answer=result["answer"],
        citations=[Citation(**citation) for citation in result["citations"]],
        latency_ms=result["latency_ms"],
        model_used=result["model_used"],
        retrieval_mode=result["retrieval_mode"],
    )


@router.post("/summarise", response_model=SummariseResponse)
async def summarise(req: SummariseRequest):
    """Summarise a single document by ID."""
    summary = summarise_document(req.document_id)
    return SummariseResponse(document_id=req.document_id, summary=summary)


@router.post("/compare", response_model=CompareResponse)
async def compare(req: CompareRequest):
    """Cross-document or collection-level comparison."""
    result = compare_documents(
        document_ids=req.document_ids,
        collection_id=req.collection_id,
        question=req.question,
        top_k=req.top_k,
    )
    return CompareResponse(**result)
