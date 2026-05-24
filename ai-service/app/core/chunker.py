"""
Semantic chunking — splits document pages into overlapping text chunks
bounded by sentence boundaries and token count.
"""
from __future__ import annotations
import logging
import re
from dataclasses import dataclass

from app.core.pdf import PageContent
from app.config import get_settings

logger = logging.getLogger("doclens.ai.chunker")
settings = get_settings()


@dataclass
class Chunk:
    chunk_index: int
    text: str
    page_number: int
    token_count: int
    document_id: str = ""


def _sentence_split(text: str) -> list[str]:
    """Simple sentence splitter that handles common academic text patterns."""
    # Split on '. ', '.\n', '? ', '! ' but not on abbreviations like 'et al.'
    sentences = re.split(r'(?<=[.?!])\s+(?=[A-Z])', text)
    return [s.strip() for s in sentences if s.strip()]


def _token_count(text: str) -> int:
    """Approximate token count (GPT-style: ~4 chars per token)."""
    return max(1, len(text) // 4)


def chunk_pages(
    pages: list[PageContent],
    document_id: str = "",
    max_tokens: int | None = None,
    overlap: int | None = None,
) -> list[Chunk]:
    """
    Converts a list of PageContent objects into overlapping Chunks.

    Strategy:
    1. Split each page into sentences
    2. Greedily pack sentences into chunks up to max_tokens
    3. Carry 'overlap' tokens from the previous chunk into the next
    """
    max_tok = max_tokens or settings.max_chunk_tokens
    overlap_tok = overlap or settings.chunk_overlap

    chunks: list[Chunk] = []
    chunk_idx = 0

    for page in pages:
        sentences = _sentence_split(page.text)
        if not sentences:
            continue

        current_sentences: list[str] = []
        current_tokens = 0

        for sentence in sentences:
            sent_tokens = _token_count(sentence)

            if current_tokens + sent_tokens > max_tok and current_sentences:
                # Flush current chunk
                chunk_text = " ".join(current_sentences)
                chunks.append(Chunk(
                    chunk_index=chunk_idx,
                    text=chunk_text,
                    page_number=page.page_number,
                    token_count=current_tokens,
                    document_id=document_id,
                ))
                chunk_idx += 1

                # Overlap: keep last N tokens worth of sentences
                overlap_sentences: list[str] = []
                overlap_count = 0
                for s in reversed(current_sentences):
                    t = _token_count(s)
                    if overlap_count + t <= overlap_tok:
                        overlap_sentences.insert(0, s)
                        overlap_count += t
                    else:
                        break

                current_sentences = overlap_sentences
                current_tokens = overlap_count

            current_sentences.append(sentence)
            current_tokens += sent_tokens

        # Flush remaining
        if current_sentences:
            chunk_text = " ".join(current_sentences)
            chunks.append(Chunk(
                chunk_index=chunk_idx,
                text=chunk_text,
                page_number=page.page_number,
                token_count=current_tokens,
                document_id=document_id,
            ))
            chunk_idx += 1

    logger.info("Chunked document '%s' into %d chunks", document_id, len(chunks))
    return chunks
