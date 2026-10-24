# ai-service/rag/llm.py
# ─────────────────────────────────────────────────────────────────────────────
# Shared Gemini access + robust structured output.
#
# `invoke_structured` first asks Gemini for native structured output
# (with_structured_output). If that fails (older model, schema the tool-calling
# API rejects), it falls back to format instructions + PydanticOutputParser,
# and finally to extracting the first JSON object from the raw text.
# ─────────────────────────────────────────────────────────────────────────────
from __future__ import annotations

import json
import logging
import os
import re
from typing import Optional, Type, TypeVar

from pydantic import BaseModel

logger = logging.getLogger(__name__)

DEFAULT_MODEL = "gemini-3.5-flash-lite"  # Gemini's 404 message: use this for new users
# langchain-google-genai defaults to no timeout and 6 retries, which can keep
# a request open for minutes. Bounded here; the backend times out above this.
# Two sequential LLM calls happen (rewrite + generate): keep each well under
# half the backend's AI_REQUEST_TIMEOUT_MS (180 s) so both fit with margin.
LLM_TIMEOUT_S = float(os.getenv("LLM_TIMEOUT_S", "45"))
# 0 retries: on 429/503/404/503 a second identical call just adds latency.
# Callers that want retries implement their own strategy.
LLM_MAX_RETRIES = int(os.getenv("LLM_MAX_RETRIES", "0"))
# Synthesis endpoints (compare / literature review / gap analysis) send larger
# prompts and need more time. Backend AI_SYNTHESIS_TIMEOUT_MS is 280 s.
SYNTHESIS_LLM_TIMEOUT_S = float(os.getenv("SYNTHESIS_LLM_TIMEOUT_S", "90"))

T = TypeVar("T", bound=BaseModel)


def llm_available() -> bool:
    key = os.getenv("GEMINI_API_KEY", "")
    return bool(key) and not key.startswith("REPLACE_WITH")


def model_name() -> str:
    return os.getenv("LLM_MODEL", DEFAULT_MODEL).replace("google/", "").replace(":free", "")


def get_llm(temperature: float = 0.1, timeout: Optional[float] = None):
    """Lazily create the Gemini chat model. Fails loudly if the API key is missing.
    `timeout` overrides LLM_TIMEOUT_S (synthesis uses SYNTHESIS_LLM_TIMEOUT_S).

    Note: langchain-google-genai has a hardcoded internal tenacity retry decorator
    (max_retries=2, catches all GoogleAPIError including 404/NotFound). We cannot
    disable it via constructor args. Instead we detect non-retryable errors from
    the *first* attempt via the WARNING log pattern and re-raise early — but the
    cleanest approach is simply to use the correct model name so 404s never occur.
    """
    if not llm_available():
        raise RuntimeError("GEMINI_API_KEY is not set. Set it in your .env file or environment.")
    from langchain_google_genai import ChatGoogleGenerativeAI

    return ChatGoogleGenerativeAI(
        model=model_name(),
        google_api_key=os.getenv("GEMINI_API_KEY"),
        temperature=temperature,
        timeout=timeout or LLM_TIMEOUT_S,
        max_retries=LLM_MAX_RETRIES,
    )


def message_text(message) -> str:
    """Gemini 2.x may return content as a list of parts; flatten to text."""
    content = getattr(message, "content", message)
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        return "".join(p if isinstance(p, str) else str(p.get("text", "")) for p in content)
    return str(content)


def _extract_json(text: str) -> dict:
    fenced = re.search(r"```(?:json)?\s*(\{.*\})\s*```", text, re.DOTALL)
    if fenced:
        return json.loads(fenced.group(1))
    start, end = text.find("{"), text.rfind("}")
    if start == -1 or end <= start:
        raise ValueError("No JSON object in model output")
    return json.loads(text[start : end + 1])


def _is_timeout(exc: BaseException) -> bool:
    text = f"{type(exc).__name__} {exc}".lower()
    return isinstance(exc, TimeoutError) or "timeout" in text or "timed out" in text or "deadline" in text


# Errors where a second call to the *same* model will never succeed — fail fast.
# 503 / "overloaded" / "service unavailable": Gemini returns these when a model
# is over capacity; retrying just adds latency for the same outcome.
_UNAVAILABLE = (
    "resourceexhausted", "quota", "429", "rate limit",
    "permissiondenied", "unauthenticated",
    "api key not valid", "api_key_invalid", "401", "403",
    "404", "not found",           # model doesn't exist
    "503", "service unavailable", "overloaded",  # capacity errors
    "unavailable",
)


def llm_error_kind(exc: BaseException) -> Optional[str]:
    """'timeout' or 'unavailable' (quota, rate limit, bad key) for errors that a
    second prompt cannot fix; None for anything else (e.g. a malformed reply)."""
    if _is_timeout(exc):
        return "timeout"
    text = f"{type(exc).__name__} {exc}".lower()
    return "unavailable" if any(marker in text for marker in _UNAVAILABLE) else None


def invoke_structured(schema: Type[T], system: str, human: str, llm=None, timeout: Optional[float] = None) -> T:
    """Run one prompt and return a validated `schema` instance.
    `timeout` (seconds) applies when no `llm` is passed."""
    from langchain_core.messages import HumanMessage, SystemMessage

    llm = llm or get_llm(timeout=timeout)
    messages = [SystemMessage(content=system), HumanMessage(content=human)]

    try:
        result = llm.with_structured_output(schema).invoke(messages)
        if isinstance(result, schema):
            return result
        if isinstance(result, dict):
            return schema.model_validate(result)
    except Exception as exc:
        if llm_error_kind(exc):
            # A second call would double the wait for the same slow model, or
            # hit the same exhausted quota / rejected key.
            raise
        logger.info("Native structured output failed for %s, using JSON fallback: %s", schema.__name__, exc)

    from langchain_core.output_parsers import PydanticOutputParser

    parser = PydanticOutputParser(pydantic_object=schema)
    fallback = [
        SystemMessage(content=f"{system}\n\nRespond ONLY with JSON matching this schema:\n{parser.get_format_instructions()}"),
        HumanMessage(content=human),
    ]
    raw = llm.invoke(fallback)
    content = message_text(raw)
    try:
        return parser.parse(content)
    except Exception:
        return schema.model_validate(_extract_json(content))
