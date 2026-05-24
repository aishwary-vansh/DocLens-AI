"""Retrieval and citation-aware answer generation for DocLens."""
from __future__ import annotations

import logging
import re
import time
from typing import Any, Literal

from app.config import get_settings
from app.core.embedder import embed_query
from app.core.index import ChunkMeta, get_faiss_index

MODEL_PATTERNS = [r"\b(?:gpt-4|llama(?:-3)?|bert|roberta|t5|flan-t5|deepseek(?:-v3)?|gemini)\b"]
METHOD_PATTERNS = [r"\b(?:rag|fine-tuning|zero-shot|few-shot|chain-of-thought|cot)\b"]
DATASET_PATTERNS = [r"\b(?:squad|mmlu|gsm8k|human-eval|glue|superglue)\b"]
METRIC_PATTERNS = [r"\b(?:accuracy|f1(?: score)?|bleu|rouge(?:-[12l])?|exact match|em)\b"]

logger = logging.getLogger("doclens.ai.rag")
settings = get_settings()

RetrievalMode = Literal["vector"]

RAG_PROMPT = """You are a rigorous academic research assistant.
Read the provided excerpts, synthesize the information, and explain concepts clearly.
Avoid simply reproducing chunks word-for-word.
For every factual claim, cite the relevant source exactly as [Source N].
If the answer cannot be confidently deduced from the excerpts, state clearly: "The provided papers do not contain enough information to answer this question."

SOURCES:
{context}

QUESTION: {question}

ANSWER:"""

def _get_openrouter_client():
    """Initialize the OpenRouter API client."""
    import os
    api_key = settings.openrouter_api_key or os.environ.get("OPENROUTER_API_KEY")
    if not api_key:
        logger.warning("OPENROUTER_API_KEY is not set. Falling back to extractive mode.")
        return None
    try:
        from openai import OpenAI
        return OpenAI(
            base_url="https://openrouter.ai/api/v1",
            api_key=api_key,
        )
    except Exception as exc:
        logger.error("Failed to initialize OpenRouter client: %s", exc)
        return None


def _score01(score: float) -> float:
    """Clamp cosine-like scores into a display-friendly 0..1 range."""
    if score < 0:
        score = (score + 1.0) / 2.0
    return max(0.0, min(1.0, float(score)))


def _make_hit(
    meta: ChunkMeta,
    score: float,
    retrieval_path: list[str] | None = None,
    matched_entities: list[str] | None = None,
) -> dict[str, Any]:
    return {
        "meta": meta,
        "score": round(_score01(score), 4),
        "retrieval_path": retrieval_path or ["vector"],
        "matched_entities": matched_entities or [],
    }


def _mentions(text: str, names: list[str]) -> list[str]:
    lowered = text.lower()
    return [name for name in names if name.lower() in lowered]


def semantic_search(
    query: str,
    collection_id: str,
    top_k: int | None = None,
    document_ids: list[str] | None = None,
) -> list[tuple[ChunkMeta, float]]:
    """Embed query and search FAISS index filtered to a collection."""
    k = top_k or settings.top_k_default
    q_vec = embed_query(query)
    index = get_faiss_index()
    return index.search(q_vec, top_k=k, collection_id=collection_id, document_ids=document_ids)


def semantic_hits(
    query: str,
    collection_id: str,
    top_k: int | None = None,
    document_ids: list[str] | None = None,
) -> list[dict[str, Any]]:
    return [
        _make_hit(meta, score, ["vector"])
        for meta, score in semantic_search(query, collection_id, top_k, document_ids)
    ]


def retrieve(
    query: str,
    collection_id: str,
    top_k: int | None = None,
    retrieval_mode: RetrievalMode = "vector",
    document_ids: list[str] | None = None,
) -> list[dict[str, Any]]:
    """Retrieve chunks with simple vector search."""
    return semantic_hits(query, collection_id, top_k, document_ids)


def _extractive_answer(question: str, hits: list[dict[str, Any]]) -> str:
    if not hits:
        return "No relevant information found in the uploaded papers."

    parts = []
    for idx, hit in enumerate(hits[:3]):
        chunk = hit["meta"]
        excerpt = chunk.text[:550].strip()
        parts.append(f"[Source {idx + 1}] {excerpt}")
    return "\n\n".join(parts)


def _citations_from_hits(hits: list[dict[str, Any]], limit: int | None = None) -> list[dict[str, Any]]:
    limit = limit or 5
    sorted_hits = sorted(hits, key=lambda x: x["score"], reverse=True)
    selected = sorted_hits[:limit]
    citations = []
    for hit in selected:
        chunk = hit["meta"]
        citations.append(
            {
                "document_id": chunk.document_id,
                "document_title": chunk.document_title,
                "page_number": chunk.page_number,
                "chunk_index": chunk.chunk_index,
                "chunk_text": chunk.text[:700],
                "score": round(float(hit["score"]), 4),
                "retrieval_path": hit.get("retrieval_path", ["vector"]),
            }
        )
    return citations


def answer_question(
    question: str,
    collection_id: str,
    top_k: int | None = None,
    retrieval_mode: RetrievalMode = "vector",
    document_ids: list[str] | None = None,
) -> dict[str, Any]:
    """Run retrieval, context aggregation, generation, and citation construction."""
    t_start = time.time()
    k = top_k or settings.top_k_default
    hits = retrieve(question, collection_id, k, retrieval_mode, document_ids)

    if not hits:
        return {
            "answer": "No relevant papers found in this collection. Upload and index papers first.",
            "citations": [],
            "latency_ms": int((time.time() - t_start) * 1000),
            "model_used": "none",
            "retrieval_mode": retrieval_mode,
        }

    context_parts = []
    for idx, hit in enumerate(hits):
        chunk = hit["meta"]
        context_parts.append(
            f"[Source {idx + 1}: {chunk.document_title}, page {chunk.page_number}, "
            f"chunk {chunk.chunk_index}]\n{chunk.text}"
        )
    prompt = RAG_PROMPT.format(context="\n\n---\n\n".join(context_parts), question=question)

    client = _get_openrouter_client()
    model_used = "extractive-fallback"
    if client is None:
        answer = _extractive_answer(question, hits)
    else:
        try:
            model_used = "deepseek/deepseek-chat"
            completion = client.chat.completions.create(
                model=model_used,
                messages=[
                    {"role": "system", "content": "You are a rigorous academic research assistant."},
                    {"role": "user", "content": prompt[:16000]}
                ],
                temperature=0.2,
                max_tokens=1024,
            )
            answer = completion.choices[0].message.content or ""
            answer = answer.strip() or _extractive_answer(question, hits)
        except Exception as exc:
            logger.warning("DeepSeek V3 failed (%s), falling back to Gemini 2.5 Flash", exc)
            try:
                model_used = "google/gemini-2.5-flash"
                completion = client.chat.completions.create(
                    model=model_used,
                    messages=[
                        {"role": "system", "content": "You are a rigorous academic research assistant."},
                        {"role": "user", "content": prompt[:16000]}
                    ],
                    temperature=0.2,
                    max_tokens=1024,
                )
                answer = completion.choices[0].message.content or ""
                answer = answer.strip() or _extractive_answer(question, hits)
            except Exception as inner_exc:
                logger.warning("Gemini fallback failed (%s); using extractive fallback", inner_exc)
                answer = _extractive_answer(question, hits)

    latency = int((time.time() - t_start) * 1000)
    logger.info("RAG answer for '%s...' in %dms", question[:40], latency)

    return {
        "answer": answer,
        "citations": _citations_from_hits(hits),
        "latency_ms": latency,
        "model_used": model_used,
        "retrieval_mode": retrieval_mode,
    }


def summarise_document(document_id: str) -> str:
    """Summarise a single document from indexed chunks."""
    index = get_faiss_index()
    doc_chunks = index.get_document_chunks(document_id)
    if not doc_chunks:
        return "No content available for this document."

    combined = " ".join(c.text for c in doc_chunks[:6])[:6000]
    client = _get_openrouter_client()
    if client is None:
        return combined[:900]

    try:
        completion = client.chat.completions.create(
            model="deepseek/deepseek-chat",
            messages=[
                {"role": "system", "content": "You are an expert academic summarizer."},
                {"role": "user", "content": f"Summarize this research paper concisely in a few paragraphs:\n\n{combined}"}
            ],
            temperature=0.3,
            max_tokens=512,
        )
        return (completion.choices[0].message.content or "").strip() or combined[:900]
    except Exception:
        try:
            completion = client.chat.completions.create(
                model="google/gemini-2.5-flash",
                messages=[
                    {"role": "system", "content": "You are an expert academic summarizer."},
                    {"role": "user", "content": f"Summarize this research paper concisely in a few paragraphs:\n\n{combined}"}
                ],
                temperature=0.3,
                max_tokens=512,
            )
            return (completion.choices[0].message.content or "").strip() or combined[:900]
        except Exception:
            return combined[:900]


def _extract_items(patterns: list[str], text: str, limit: int = 10) -> list[str]:
    found: dict[str, str] = {}
    for pattern in patterns:
        for match in re.finditer(pattern, text, re.IGNORECASE):
            value = match.group(0).strip()
            found.setdefault(value.lower(), value)
    return list(found.values())[:limit]


def _sentences_for(text: str, keywords: list[str], limit: int = 5) -> list[str]:
    sentences = re.split(r"(?<=[.?!])\s+", text)
    selected = []
    for sentence in sentences:
        lower = sentence.lower()
        if any(keyword in lower for keyword in keywords):
            clean = sentence.strip()
            if 35 <= len(clean) <= 350 and clean not in selected:
                selected.append(clean)
        if len(selected) >= limit:
            break
    return selected


def compare_documents(
    document_ids: list[str] | None = None,
    collection_id: str | None = None,
    question: str | None = None,
    top_k: int = 12,
) -> dict[str, Any]:
    """Create a structured cross-document comparison from indexed evidence."""
    index = get_faiss_index()
    hits: list[dict[str, Any]] = []

    if document_ids:
        for doc_id in document_ids:
            for chunk in index.get_document_chunks(doc_id)[:8]:
                hits.append(_make_hit(chunk, 0.7, ["document-scope"]))
    elif collection_id and question:
        hits = retrieve(question, collection_id, top_k, "vector")
    elif collection_id:
        chunks = index.get_collection_chunks(collection_id)[:top_k]
        hits = [_make_hit(chunk, 0.6, ["collection-scope"]) for chunk in chunks]

    if not hits:
        return {
            "methods": [],
            "strengths": [],
            "weaknesses": [],
            "datasets": [],
            "metrics": [],
            "narrative": "No indexed documents found for comparison.",
            "citations": [],
        }

    all_text = " ".join(hit["meta"].text for hit in hits)
    methods = _extract_items(MODEL_PATTERNS + METHOD_PATTERNS, all_text)
    datasets = _extract_items(DATASET_PATTERNS, all_text)
    metrics = _extract_items(METRIC_PATTERNS, all_text)
    strengths = _sentences_for(
        all_text,
        ["outperform", "improve", "better", "effective", "robust", "state-of-the-art", "advantage"],
    )
    weaknesses = _sentences_for(
        all_text,
        ["limitation", "weakness", "however", "future work", "fails", "challenge", "cost", "trade-off"],
    )

    titles = []
    for hit in hits:
        title = hit["meta"].document_title
        if title and title not in titles:
            titles.append(title)

    client = _get_openrouter_client()
    narrative = ""

    if client is not None:
        all_text = "\n\n".join(f"[Paper: {hit['meta'].document_title}]\n{hit['meta'].text}" for hit in hits)
        prompt = f"""Compare the following papers based on the provided excerpts.
Required output format:
# Paper Comparison

## Objectives
Paper A: ...
Paper B: ...

## Methodology
Paper A: ...
Paper B: ...

## Datasets
Paper A: ...
Paper B: ...

## Key Findings
...

## Strengths
...

## Limitations
...

## Conclusion
...

EXCERPTS:
{all_text[:24000]}
"""
        try:
            completion = client.chat.completions.create(
                model="deepseek/deepseek-chat",
                messages=[
                    {"role": "system", "content": "You are an expert AI research assistant."},
                    {"role": "user", "content": prompt}
                ],
                temperature=0.2,
                max_tokens=2048,
            )
            narrative = completion.choices[0].message.content or ""
        except Exception as exc:
            logger.warning("DeepSeek compare failed: %s", exc)
            try:
                completion = client.chat.completions.create(
                    model="google/gemini-2.5-flash",
                    messages=[
                        {"role": "system", "content": "You are an expert AI research assistant."},
                        {"role": "user", "content": prompt}
                    ],
                    temperature=0.2,
                    max_tokens=2048,
                )
                narrative = completion.choices[0].message.content or ""
            except Exception as e:
                logger.warning("Gemini compare failed: %s", e)

    if not narrative.strip():
        narrative = (
            f"Compared evidence from {len(titles)} paper(s): {', '.join(titles[:5])}. "
            f"The retrieved context mentions {len(methods)} methods or models, "
            f"{len(datasets)} datasets, and {len(metrics)} metrics."
        )

    return {
        "methods": methods,
        "strengths": strengths,
        "weaknesses": weaknesses,
        "datasets": datasets,
        "metrics": metrics,
        "narrative": narrative,
        "citations": _citations_from_hits(hits, limit=5),
    }
