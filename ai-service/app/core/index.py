"""
FAISS index manager — persistent flat L2 index with document metadata sidecar.
"""
from __future__ import annotations
import json
import logging
import os
import threading
from dataclasses import asdict, dataclass
from pathlib import Path

import numpy as np

from app.config import get_settings

logger = logging.getLogger("doclens.ai.index")
settings = get_settings()

_lock  = threading.Lock()
_index_singleton = None


@dataclass
class ChunkMeta:
    """Metadata stored alongside each FAISS vector (by position)."""
    faiss_id: int = 0
    document_id: str = ""
    collection_id: str = ""
    chunk_index: int = 0
    page_number: int | None = None
    text: str = ""
    document_title: str = ""
    chunk_id: str = ""
    token_count: int | None = None


class FaissIndex:
    """
    Wraps a FAISS IndexFlatIP (inner-product on L2-normalised vectors = cosine).
    Persists index + metadata sidecar as JSON.
    """

    SIDECAR_SUFFIX = ".meta.json"

    def __init__(self, path: str):
        import faiss
        self.path = Path(path)
        self.meta_path = self.path.with_suffix("").with_suffix(self.SIDECAR_SUFFIX)
        self.dim = 384
        self._meta: list[ChunkMeta] = []

        if self.path.exists():
            logger.info("Loading existing FAISS index from %s", self.path)
            self._index = faiss.read_index(str(self.path))
            self._load_meta()
        else:
            logger.info("Creating new FAISS IndexFlatIP (dim=%d)", self.dim)
            self.path.parent.mkdir(parents=True, exist_ok=True)
            self._index = faiss.IndexFlatIP(self.dim)

    # ── Write ──────────────────────────────────────────────────────────────

    def add(self, embeddings: np.ndarray, metas: list[ChunkMeta]) -> list[int]:
        """Add vectors + metadata. Returns list of assigned FAISS IDs."""
        if len(metas) == 0:
            return []
        if embeddings.shape[0] != len(metas):
            raise ValueError("Embeddings and metadata counts do not match")
        if embeddings.shape[1] != self.dim:
            raise ValueError(f"Expected embedding dim {self.dim}, got {embeddings.shape[1]}")

        with _lock:
            start_id = self._index.ntotal
            self._index.add(embeddings)
            ids = list(range(start_id, start_id + len(metas)))
            for i, meta in enumerate(metas):
                meta.faiss_id = ids[i]
                meta.chunk_id = meta.chunk_id or f"{meta.document_id}:{meta.chunk_index}"
                self._meta.append(meta)
            self._save()
        return ids

    # ── Read ───────────────────────────────────────────────────────────────

    def search(
        self,
        query_vec: np.ndarray,
        top_k: int,
        collection_id: str | None = None,
        document_ids: list[str] | None = None,
    ) -> list[tuple[ChunkMeta, float]]:
        """
        Search index. If collection_id given, over-retrieve and filter.
        Returns list of (ChunkMeta, score) sorted by descending score.
        """
        if self._index.ntotal == 0:
            return []

        needs_filter = collection_id is not None or bool(document_ids)
        retrieve_k = min(self._index.ntotal, top_k * 12 if needs_filter else top_k)
        allowed_docs = set(document_ids or [])
        scores, ids = self._index.search(query_vec, retrieve_k)

        results: list[tuple[ChunkMeta, float]] = []
        for score, idx in zip(scores[0], ids[0]):
            if idx == -1:
                continue
            meta = self._meta[idx]
            if collection_id and meta.collection_id != collection_id:
                continue
            if allowed_docs and meta.document_id not in allowed_docs:
                continue
            results.append((meta, float(score)))
            if len(results) >= top_k:
                break

        return results

    # ── Persistence ────────────────────────────────────────────────────────

    def _save(self):
        import faiss
        faiss.write_index(self._index, str(self.path))
        with open(self.meta_path, "w", encoding="utf-8") as f:
            json.dump([asdict(m) for m in self._meta], f)

    def _load_meta(self):
        if self.meta_path.exists():
            with open(self.meta_path, encoding="utf-8") as f:
                raw = json.load(f)
            self._meta = [ChunkMeta(**r) for r in raw]

    # ── Stats ──────────────────────────────────────────────────────────────

    @property
    def size(self) -> int:
        return self._index.ntotal

    def get_collection_chunks(self, collection_id: str) -> list[ChunkMeta]:
        return [m for m in self._meta if m.collection_id == collection_id]

    def get_document_chunks(self, document_id: str) -> list[ChunkMeta]:
        return [m for m in self._meta if m.document_id == document_id]

    def get_documents(self, collection_id: str | None = None) -> dict[str, str]:
        documents: dict[str, str] = {}
        for meta in self._meta:
            if collection_id and meta.collection_id != collection_id:
                continue
            documents.setdefault(meta.document_id, meta.document_title)
        return documents


def get_faiss_index() -> FaissIndex:
    global _index_singleton
    if _index_singleton is None:
        with _lock:
            if _index_singleton is None:
                _index_singleton = FaissIndex(settings.faiss_index_path)
    return _index_singleton
