# ai-service/internal_auth.py
# ─────────────────────────────────────────────────────────────────────────────
# Service-to-service protection for the AI service.
#
# The AI service reads every user's chunks straight from PostgreSQL and trusts
# the collection/document ids it is given. Only the NestJS backend (which does
# the per-user ownership checks) may call it. The backend sends
# `X-Internal-Secret: $INTERNAL_API_SECRET`; requests without the matching
# value are rejected with 401.
#
# If INTERNAL_API_SECRET is unset (local dev), requests are allowed and a
# warning is logged once at startup.
# ─────────────────────────────────────────────────────────────────────────────
from __future__ import annotations

import hmac
import logging
import os
from pathlib import Path
from typing import Optional

logger = logging.getLogger(__name__)

HEADER = "x-internal-secret"
PUBLIC_PATHS = {"/health"}
_PLACEHOLDER_PREFIX = "REPLACE_WITH"


def configured_secret() -> Optional[str]:
    value = (os.getenv("INTERNAL_API_SECRET") or "").strip()
    if not value or value.startswith(_PLACEHOLDER_PREFIX):
        return None
    return value


def is_authorised(path: str, provided: Optional[str]) -> bool:
    if path in PUBLIC_PATHS:
        return True
    secret = configured_secret()
    if secret is None:
        return True
    return bool(provided) and hmac.compare_digest(provided.encode(), secret.encode())


def ingest_path_allowed(file_path: str) -> bool:
    """With INGEST_ALLOWED_DIR set, only files inside that directory may be ingested."""
    allowed = (os.getenv("INGEST_ALLOWED_DIR") or "").strip()
    if not allowed:
        return True
    try:
        Path(file_path).resolve().relative_to(Path(allowed).resolve())
        return True
    except ValueError:
        return False


def log_startup_mode() -> None:
    if configured_secret() is None:
        logger.warning(
            "INTERNAL_API_SECRET is not set: the AI service accepts unauthenticated requests. "
            "Set it for any shared or deployed environment."
        )
    else:
        logger.info("Internal API secret required for all routes except %s", sorted(PUBLIC_PATHS))
