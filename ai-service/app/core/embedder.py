"""
Sentence-Transformer embedder — singleton, thread-safe.
"""
from __future__ import annotations
import logging
import threading
import numpy as np

from app.config import get_settings

logger = logging.getLogger("doclens.ai.embedder")
settings = get_settings()

_lock = threading.Lock()
_model = None


def get_embedder():
    """Return the singleton SentenceTransformer model (lazy-loaded)."""
    global _model
    if _model is None:
        with _lock:
            if _model is None:
                try:
                    from sentence_transformers import SentenceTransformer
                    logger.info("Loading model: %s", settings.model_name)
                    _model = SentenceTransformer(settings.model_name)
                    logger.info("Model loaded — embedding dim: %d", _model.get_sentence_embedding_dimension())
                except ImportError:
                    logger.error("sentence-transformers not installed")
                    raise
    return _model


def embed_texts(texts: list[str], batch_size: int = 64) -> np.ndarray:
    """
    Embed a list of strings.
    Returns shape (N, dim) float32 numpy array.
    """
    if not texts:
        return np.empty((0, 384), dtype=np.float32)

    model = get_embedder()
    embeddings = model.encode(
        texts,
        batch_size=batch_size,
        show_progress_bar=False,
        convert_to_numpy=True,
        normalize_embeddings=True,   # cosine similarity via dot product
    )
    return embeddings.astype(np.float32)


def embed_query(query: str) -> np.ndarray:
    """Embed a single query string. Returns shape (1, dim)."""
    return embed_texts([query])
