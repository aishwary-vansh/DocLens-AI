"""Health check endpoint."""
from fastapi import APIRouter
from app.core import embedder as _embedder_mod
from app.core.index import get_faiss_index
router = APIRouter()

@router.get("/health")
async def health():
    idx = get_faiss_index()
    return {
        "status": "ok",
        "model_loaded": _embedder_mod._model is not None,
        "faiss_index_size": idx.size,
    }
