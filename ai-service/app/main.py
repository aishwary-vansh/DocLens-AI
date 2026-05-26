"""
DocLens AI Service — FastAPI application factory.

Memory-optimised for Render free instances (512 MB RAM).
All heavy resources (SentenceTransformer, FAISS) are loaded lazily
on first use, not at startup.
"""
import os
# Must be set BEFORE any transformers/sentence-transformers import to avoid Keras 3 error
os.environ.setdefault("TRANSFORMERS_NO_TF", "1")
os.environ.setdefault("USE_TF", "0")
# Disable tokenizers parallelism to avoid fork-safety issues and reduce memory
os.environ.setdefault("TOKENIZERS_PARALLELISM", "false")

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware

from app.config import get_settings
from app.api import health, ingest, search, query

settings = get_settings()
logging.basicConfig(level=settings.log_level)
logger = logging.getLogger("doclens.ai")


@asynccontextmanager
async def lifespan(app: FastAPI):
    """
    Lightweight startup — NO model or index loading.
    SentenceTransformer and FAISS are loaded lazily on first request.
    This keeps startup RAM well under 200 MB on Render free instances.
    """
    logger.info("✅ DocLens AI Service starting (lazy-load mode — models will load on first request)")
    yield
    logger.info("🛑 Shutting down AI Service")


def create_app() -> FastAPI:
    app = FastAPI(
        title="DocLens AI Service",
        description="NLP · Embeddings · FAISS · RAG",
        version="1.0.0",
        lifespan=lifespan,
    )

    origins = [origin.strip() for origin in settings.cors_origins.split(",") if origin.strip()]
    app.add_middleware(
        CORSMiddleware,
        allow_origins=origins,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @app.middleware("http")
    async def internal_auth(request: Request, call_next):
        public_paths = {"/health", "/docs", "/openapi.json", "/redoc"}
        if settings.enforce_internal_auth and request.url.path not in public_paths:
            secret = request.headers.get("x-internal-secret")
            if secret != settings.internal_api_secret:
                return JSONResponse({"detail": "Invalid internal service secret"}, status_code=401)
        return await call_next(request)

    app.include_router(health.router, tags=["Health"])
    app.include_router(ingest.router, prefix="/ingest", tags=["Ingest"])
    app.include_router(search.router, prefix="/search", tags=["Search"])
    app.include_router(query.router,  prefix="/query",  tags=["Query"])

    return app


app = create_app()

