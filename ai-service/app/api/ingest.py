"""Document ingestion API and background processing pipeline."""
from __future__ import annotations

import io
import logging
import json
import threading
from pathlib import Path

import httpx
from fastapi import APIRouter, BackgroundTasks, Form, HTTPException, UploadFile, File

from app.config import get_settings
from app.core import chunker, pdf
from app.core.embedder import embed_texts
from app.core.index import ChunkMeta, get_faiss_index
from app.models.schemas import IngestResponse, StatusResponse

router = APIRouter()
settings = get_settings()
logger = logging.getLogger("doclens.ai.ingest")

_status_lock = threading.Lock()
_status_path = Path("./data/processing-status.json")


def _load_status() -> dict[str, dict]:
    try:
        if _status_path.exists():
            return json.loads(_status_path.read_text(encoding="utf-8"))
    except Exception as exc:
        logger.warning("Could not load processing status file: %s", exc)
    return {}


# Local durable status cache for recovery after AI service restarts.
_status: dict[str, dict] = _load_status()


async def _notify_nestjs(
    document_id: str,
    status: str,
    data: dict | None = None,
    callback_url: str | None = None,
):
    """Push a processing-stage callback to the NestJS backend."""
    payload = {"document_id": document_id, "status": status, **(data or {})}
    url = callback_url or settings.nestjs_callback_url
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            await client.post(
                url,
                json=payload,
                headers={"x-internal-secret": settings.internal_api_secret},
            )
    except Exception as exc:
        logger.warning("NestJS callback failed (%s): %s", document_id, exc)


def _set_status(document_id: str, stage: str, progress: int, error: str | None = None):
    with _status_lock:
        _status[document_id] = {"stage": stage, "progress_pct": progress, "error": error}
        try:
            _status_path.parent.mkdir(parents=True, exist_ok=True)
            _status_path.write_text(json.dumps(_status, indent=2), encoding="utf-8")
        except Exception as exc:
            logger.warning("Could not persist processing status file: %s", exc)


async def _run_pipeline(
    document_id: str,
    pdf_bytes: bytes,
    collection_id: str,
    callback_url: str | None = None,
):
    """
    Run extraction, chunking, embedding, FAISS indexing, and concept extraction.

    Accepts raw PDF bytes — no filesystem path required.  This makes the
    pipeline work correctly when the NestJS backend and FastAPI AI service
    are deployed as separate services (e.g. on Render) with no shared disk.
    """
    try:
        _set_status(document_id, "EXTRACTING", 10)
        await _notify_nestjs(document_id, "EXTRACTING", callback_url=callback_url)

        logger.info("[%s] Extracting PDF from memory (%d bytes)", document_id, len(pdf_bytes))
        # Pass bytes directly — no temp file needed
        content = pdf.extract_bytes(pdf_bytes)

        _set_status(document_id, "CHUNKING", 35)
        await _notify_nestjs(document_id, "CHUNKING", callback_url=callback_url)
        logger.info("[%s] Chunking %d pages", document_id, content.total_pages)
        chunks = chunker.chunk_pages(content.pages, document_id=document_id)

        if not chunks:
            raise ValueError("No chunks produced; PDF may be image-only or empty")

        _set_status(document_id, "EMBEDDING", 60)
        await _notify_nestjs(document_id, "EMBEDDING", callback_url=callback_url)
        logger.info("[%s] Embedding %d chunks", document_id, len(chunks))
        embeddings = embed_texts([c.text for c in chunks])

        metas = [
            ChunkMeta(
                document_id=document_id,
                collection_id=collection_id,
                chunk_index=c.chunk_index,
                page_number=c.page_number,
                text=c.text,
                document_title=content.title,
                chunk_id=f"{document_id}:{c.chunk_index}",
                token_count=c.token_count,
            )
            for c in chunks
        ]

        _set_status(document_id, "INDEXING", 78)
        await _notify_nestjs(document_id, "INDEXING", callback_url=callback_url)
        index = get_faiss_index()
        vector_ids = index.add(embeddings, metas)
        logger.info("[%s] Added %d vectors to FAISS", document_id, len(metas))

        _set_status(document_id, "READY", 100)
        await _notify_nestjs(
            document_id,
            "READY",
            {
                "chunks_count": len(chunks),
                "entities_count": 0,
                "relationships_count": 0,
                "chunks": [
                    {
                        "chunk_id": meta.chunk_id,
                        "chunk_index": meta.chunk_index,
                        "page_number": meta.page_number,
                        "text": meta.text,
                        "vector_id": str(vector_ids[i]) if i < len(vector_ids) else str(meta.faiss_id),
                        "token_count": meta.token_count,
                    }
                    for i, meta in enumerate(metas)
                ],
                "entities": [],
                "relationships": [],
                "title": content.title,
                "page_count": content.total_pages,
                "doi": content.doi,
                "keywords": content.keywords,
                "model_name": settings.model_name,
                "embedding_dimensions": embeddings.shape[1],
                "vector_store": "faiss",
            },
            callback_url=callback_url,
        )
        logger.info("[%s] Pipeline ready: %d chunks", document_id, len(chunks))

    except Exception as exc:
        _set_status(document_id, "FAILED", 0, str(exc))
        await _notify_nestjs(document_id, "FAILED", {"error": str(exc)}, callback_url)
        logger.exception("[%s] Pipeline failed: %s", document_id, exc)


@router.post("/process", response_model=IngestResponse)
async def process_document(
    background_tasks: BackgroundTasks,
    document_id: str = Form(...),
    collection_id: str = Form(...),
    callback_url: str | None = Form(default=None),
    file: UploadFile = File(...),
):
    """
    Accept a PDF upload and queue it for processing.

    The endpoint receives the PDF as multipart/form-data so no shared
    filesystem between the NestJS backend and this AI service is required.
    Works on Render, Railway, Fly.io, and any other platform where each
    service has its own ephemeral disk.
    """
    if file.content_type not in ("application/pdf", "application/octet-stream"):
        raise HTTPException(
            status_code=400,
            detail=f"Only PDF files are accepted, got: {file.content_type}",
        )

    pdf_bytes = await file.read()
    if not pdf_bytes:
        raise HTTPException(status_code=400, detail="Uploaded file is empty")

    logger.info(
        "[%s] Received PDF upload: %s (%d bytes) for collection %s",
        document_id,
        file.filename,
        len(pdf_bytes),
        collection_id,
    )

    _set_status(document_id, "UPLOADED", 0)
    background_tasks.add_task(
        _run_pipeline,
        document_id,
        pdf_bytes,
        collection_id,
        callback_url,
    )
    return IngestResponse(
        document_id=document_id,
        status="queued",
        message="Pipeline started in background",
    )


@router.get("/status/{document_id}", response_model=StatusResponse)
async def get_status(document_id: str):
    """Poll processing status for a document."""
    state = _status.get(document_id)
    if not state:
        raise HTTPException(status_code=404, detail=f"No pipeline record for {document_id}")
    return StatusResponse(document_id=document_id, **state)
