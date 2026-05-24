"""Semantic search endpoints."""
from fastapi import APIRouter

from app.core.rag import retrieve, semantic_search
from app.models.schemas import ChunkResult, SearchRequest, SearchResponse

router = APIRouter()


def _to_response(req: SearchRequest, results: list[dict]) -> SearchResponse:
    chunk_results = [
        ChunkResult(
            chunk_text=hit["meta"].text,
            score=round(float(hit["score"]), 4),
            document_id=hit["meta"].document_id,
            document_title=hit["meta"].document_title,
            page_number=hit["meta"].page_number,
            chunk_index=hit["meta"].chunk_index,
            vector_id=str(hit["meta"].faiss_id),
            retrieval_path=hit.get("retrieval_path", [req.retrieval_mode]),
            matched_entities=hit.get("matched_entities", []),
        )
        for hit in results
    ]
    return SearchResponse(
        results=chunk_results,
        query=req.query,
        total=len(chunk_results),
        retrieval_mode=req.retrieval_mode,
    )


@router.post("", response_model=SearchResponse)
async def search(req: SearchRequest):
    """Search indexed chunks using vector retrieval."""
    results = retrieve(
        req.query,
        req.collection_id,
        top_k=req.top_k,
        retrieval_mode=req.retrieval_mode,
        document_ids=req.document_ids,
    )
    return _to_response(req, results)


@router.post("/semantic", response_model=SearchResponse)
async def semantic(req: SearchRequest):
    """Explicit vector-only semantic search endpoint."""
    raw = semantic_search(req.query, req.collection_id, top_k=req.top_k, document_ids=req.document_ids)
    results = [
        {"meta": meta, "score": score, "retrieval_path": ["vector"], "matched_entities": []}
        for meta, score in raw
    ]
    return _to_response(req.model_copy(update={"retrieval_mode": "vector"}), results)
