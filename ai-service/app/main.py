"""
DocLens AI Service — FastAPI application factory.
"""
import os
# Must be set BEFORE any transformers/sentence-transformers import to avoid Keras 3 error
os.environ.setdefault("TRANSFORMERS_NO_TF", "1")
os.environ.setdefault("USE_TF", "0")

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware

from app.config import get_settings
from app.core.embedder import get_embedder
from app.core.index import get_faiss_index
from app.api import health, ingest, search, query

settings = get_settings()
logging.basicConfig(level=settings.log_level)
logger = logging.getLogger("doclens.ai")


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Startup: warm up models and load FAISS index."""
    logger.info("🔥 Warming up sentence-transformer model: %s", settings.model_name)
    get_embedder()           # initialises singleton
    logger.info("📦 Loading FAISS index from: %s", settings.faiss_index_path)
    get_faiss_index()        # loads or creates index
    logger.info("✅ DocLens AI Service ready")
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
