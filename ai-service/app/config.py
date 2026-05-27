"""
DocLens AI Service — Configuration
Reads from environment / .env file.

Required environment variables on Render / production:
  NESTJS_CALLBACK_URL  = https://doclens-hu8f.onrender.com/api/v1/internal/ai-callback
  INTERNAL_API_SECRET  = <same value as NestJS backend>
  DATABASE_URL         = postgresql+asyncpg://...
"""
from functools import lru_cache
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    # Database
    database_url: str = "postgresql+asyncpg://doclens:doclens@localhost:5432/doclens"

    # NestJS callback — MUST be set to the public Render URL in production.
    # Docker Compose sets this to http://backend:3001/... for local dev.
    nestjs_callback_url: str = "http://localhost:3001/api/v1/internal/ai-callback"
    internal_api_secret: str = "doclens-internal-secret"
    enforce_internal_auth: bool = True
    cors_origins: str = "http://localhost:3001"

    # Model
    model_name: str = "all-MiniLM-L6-v2"
    faiss_index_path: str = "./data/faiss.index"
    openrouter_api_key: str = ""

    # Chunking
    max_chunk_tokens: int = 400
    chunk_overlap: int = 50
    top_k_default: int = 5

    log_level: str = "INFO"


@lru_cache
def get_settings() -> Settings:
    return Settings()
