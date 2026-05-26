"""Health check endpoint — intentionally lightweight, does NOT trigger model/index loading."""
from fastapi import APIRouter
from app.core import embedder as _embedder_mod
from app.core import index as _index_mod

router = APIRouter()


@router.get("/health")
async def health():
    """
    Returns service status without loading any heavy resources.
    model_loaded and faiss_index_size reflect current in-memory state only.
    """
    faiss_size = 0
    if _index_mod._index_singleton is not None:
        faiss_size = _index_mod._index_singleton.size

    return {
        "status": "ok",
        "model_loaded": _embedder_mod._model is not None,
        "faiss_index_size": faiss_size,
    }

