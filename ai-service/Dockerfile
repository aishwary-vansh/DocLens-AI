# ──────────────────────────────────────────────────────────────────────────────
# DocLens AI Service — Dockerfile
# Multi-stage build for the FastAPI Python service.
# ──────────────────────────────────────────────────────────────────────────────

# ── Stage 1: Python dependencies ───────────────────────────────────────────────
FROM python:3.11-slim AS deps

# System libraries required by psycopg2, PyMuPDF, and torch
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        libpq5 \
        libgl1 \
        libglib2.0-0 \
        curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy requirements first for layer caching
COPY requirements.txt ./
RUN pip install --no-cache-dir --upgrade pip \
 && pip install --no-cache-dir -r requirements.txt

# ── Stage 2: Runtime ───────────────────────────────────────────────────────────
FROM deps AS runtime

WORKDIR /app

# Copy application source
COPY . .

# HuggingFace / sentence-transformers model cache is mounted as a volume at runtime
# to avoid re-downloading multi-GB models on every container restart.
ENV HF_HOME=/root/.cache/huggingface
ENV TRANSFORMERS_CACHE=/root/.cache/huggingface

EXPOSE 8000

# Healthcheck: call the /health endpoint
HEALTHCHECK --interval=30s --timeout=15s --start-period=120s --retries=5 \
  CMD curl -f http://localhost:8000/health || exit 1

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1"]
