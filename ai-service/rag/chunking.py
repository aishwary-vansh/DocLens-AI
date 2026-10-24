# ai-service/rag/chunking.py
# ─────────────────────────────────────────────────────────────────────────────
# Section-aware chunking for parsed research papers.
#
# Design choices:
#   * Chunks never cross a section boundary, so every chunk carries one
#     section type (method, results, limitations, ...) that retrieval can
#     filter and boost on.
#   * Chunks are paragraph-packed up to CHUNK_MAX_CHARS and overlap by whole
#     trailing sentences, not by a raw character window.
#   * Each chunk gets a short contextual header (paper title + section path).
#     The header is embedded with the text ("contextual retrieval"), which
#     lets a chunk that says "our model" still match "<paper> method".
#   * The abstract, every table and every figure/table caption become their
#     own chunks. References are grouped into separate "reference" chunks that
#     retrieval excludes unless the question is about citations.
# ─────────────────────────────────────────────────────────────────────────────
from __future__ import annotations

import hashlib
import os
import re
import uuid
from typing import List

from .pdf_parser import ParsedPaper, Paragraph, Section

CHUNK_MAX_CHARS = int(os.getenv("CHUNK_MAX_CHARS", "2000"))
CHUNK_OVERLAP_CHARS = int(os.getenv("CHUNK_OVERLAP_CHARS", "300"))
MIN_CHUNK_CHARS = int(os.getenv("MIN_CHUNK_CHARS", "120"))
REFERENCES_PER_CHUNK = 8

_SENTENCE_SPLIT = re.compile(r"(?<=[.!?])\s+(?=[A-Z0-9(\[])")


def split_sentences(text: str) -> List[str]:
    return [s.strip() for s in _SENTENCE_SPLIT.split(text) if s.strip()]


def _overlap_tail(text: str, budget: int) -> str:
    """Trailing whole sentences whose total length fits in the overlap budget."""
    if budget <= 0:
        return ""
    tail: List[str] = []
    total = 0
    for sentence in reversed(split_sentences(text)):
        if total + len(sentence) > budget:
            break
        tail.insert(0, sentence)
        total += len(sentence) + 1
    return " ".join(tail)


def _units(paragraphs: List[Paragraph], max_chars: int) -> List[Paragraph]:
    """Break oversized paragraphs into sentence groups that fit the chunk size."""
    units: List[Paragraph] = []
    for paragraph in paragraphs:
        if len(paragraph.text) <= max_chars:
            units.append(paragraph)
            continue
        current = ""
        for sentence in split_sentences(paragraph.text):
            while len(sentence) > max_chars:  # pathological sentence (tables pasted as text)
                units.append(Paragraph(sentence[:max_chars], paragraph.page))
                sentence = sentence[max_chars:]
            if current and len(current) + len(sentence) + 1 > max_chars:
                units.append(Paragraph(current, paragraph.page))
                current = sentence
            else:
                current = f"{current} {sentence}".strip()
        if current:
            units.append(Paragraph(current, paragraph.page))
    return units


def pack_section(section: Section, max_chars: int = CHUNK_MAX_CHARS, overlap: int = CHUNK_OVERLAP_CHARS) -> List[dict]:
    """Pack one section's paragraphs into overlapping chunks with page spans."""
    pieces: List[dict] = []
    text = ""
    pages: List[int] = []
    for unit in _units(section.paragraphs, max_chars):
        if text and len(text) + len(unit.text) + 2 > max_chars:
            pieces.append({"text": text, "page_start": pages[0], "page_end": pages[-1]})
            tail = _overlap_tail(text, overlap)
            text = f"{tail}\n\n{unit.text}" if tail else unit.text
            pages = [pages[-1], unit.page] if tail else [unit.page]
        else:
            text = f"{text}\n\n{unit.text}" if text else unit.text
            pages.append(unit.page)
    if text:
        pieces.append({"text": text, "page_start": pages[0], "page_end": pages[-1]})

    # Merge a too-small trailing piece into its predecessor.
    if len(pieces) >= 2 and len(pieces[-1]["text"]) < MIN_CHUNK_CHARS:
        last = pieces.pop()
        pieces[-1]["text"] += "\n\n" + last["text"]
        pieces[-1]["page_end"] = last["page_end"]
    return pieces


def _header(title: str, section_path: str, content_type: str) -> str:
    label = {"table": "Table", "figure": "Figure", "reference": "References", "abstract": "Abstract"}.get(content_type)
    lines = [f"Paper: {title}"]
    if section_path:
        lines.append(f"Section: {section_path}")
    elif label:
        lines.append(f"Section: {label}")
    return "\n".join(lines)


def _chunk(content: str, page: int | None, metadata: dict) -> dict:
    return {
        "id": str(uuid.uuid4()),
        "content": content.strip(),
        "pageNumber": page,
        "metadata": metadata,
    }


def build_chunks(paper: ParsedPaper, title: str) -> List[dict]:
    """Turn a ParsedPaper into persisted chunk dicts (ids assigned here)."""
    chunks: List[dict] = []
    parent = ""

    # Text of sections too short for a chunk of their own (e.g. a lead-in line
    # before subsections). It is prefixed to the next section, never dropped.
    carry: List[Paragraph] = []

    for section in paper.sections:
        if section.level == 1:
            parent = section.heading
        path = section.heading if section.level == 1 or not parent or parent == section.heading else f"{parent} > {section.heading}"
        content_type = "abstract" if section.section_type == "abstract" else "section_text"
        if section.section_type == "front_matter":
            content_type = "front_matter"
        if content_type == "section_text":
            if carry:
                section = Section(section.heading, section.section_type, section.level, carry + section.paragraphs)
                carry = []
            if len(section.text) < MIN_CHUNK_CHARS:
                if section.text.strip():
                    page = section.page_start or 1
                    carry.append(Paragraph(f"{section.heading}: {section.text}", page))
                continue
        for part_index, piece in enumerate(pack_section(section)):
            if len(piece["text"]) < MIN_CHUNK_CHARS and content_type != "abstract":
                continue
            header = _header(title, path, content_type)
            chunks.append(
                _chunk(
                    f"{header}\n\n{piece['text']}",
                    piece["page_start"],
                    {
                        "extractor": paper.parser,
                        "content_type": content_type,
                        "section": section.heading,
                        "section_path": path,
                        "section_type": section.section_type,
                        "section_level": section.level,
                        "source_page": piece["page_start"],
                        "page_start": piece["page_start"],
                        "page_end": piece["page_end"],
                        "source_part_index": part_index,
                    },
                )
            )

    if carry:  # trailing short section: attach to the last body chunk
        body = [c for c in chunks if c["metadata"].get("content_type") == "section_text"]
        if body:
            body[-1]["content"] += "\n\n" + "\n\n".join(p.text for p in carry)

    for table in paper.tables:
        caption = f"{table.caption}\n" if table.caption else ""
        chunks.append(
            _chunk(
                f"{_header(title, table.section, 'table')}\nPage: {table.page}\n\n{caption}{table.markdown}",
                table.page,
                {
                    "extractor": "pymupdf-table",
                    "content_type": "table",
                    "section": table.section,
                    "section_type": "results",
                    "caption": table.caption,
                    "source_page": table.page,
                },
            )
        )

    for caption in paper.captions:
        if caption.kind == "table" and any(t.caption == caption.text for t in paper.tables):
            continue
        chunks.append(
            _chunk(
                f"{_header(title, '', 'figure')}\nPage: {caption.page}\n\n{caption.text}",
                caption.page,
                {
                    "extractor": paper.parser,
                    "content_type": "figure" if caption.kind == "figure" else "table_caption",
                    "caption": caption.text,
                    "label": caption.label,
                    "section_type": "results",
                    "source_page": caption.page,
                },
            )
        )

    for start in range(0, len(paper.references), REFERENCES_PER_CHUNK):
        group = paper.references[start : start + REFERENCES_PER_CHUNK]
        chunks.append(
            _chunk(
                f"{_header(title, '', 'reference')}\n\n" + "\n".join(group),
                None,
                {
                    "extractor": paper.parser,
                    "content_type": "reference",
                    "section_type": "references",
                    "reference_range": [start + 1, start + len(group)],
                },
            )
        )

    return chunks


def finalise_chunks(chunks: List[dict], document_id: str, collection_id: str) -> List[dict]:
    """Assign stable indexes, hashes and provenance metadata."""
    for index, chunk in enumerate(chunks):
        chunk["chunkIndex"] = index
        chunk["contentHash"] = hashlib.sha256(chunk["content"].encode("utf-8")).hexdigest()
        chunk["metadata"] = {
            **chunk.get("metadata", {}),
            "paper_id": document_id,
            "collection_id": collection_id,
            "chunk_index": index,
        }
    return chunks


def reconcile_chunk_ids(chunks: List[dict], existing: List[dict], embedding_model: str) -> dict:
    """Reuse stored chunk ids for unchanged text before re-ingesting a document.

    `existing` rows: {"id", "contentHash", "embeddingModel"}. A new chunk whose
    content hash matches a stored chunk takes over that chunk's id, so
    Citation rows (which cascade-delete with their chunk) and the stored vector
    survive a re-index. Vectors from a different embedding model are marked for
    re-embedding. Must run before anything else references chunk ids.
    """
    pool: dict = {}
    for row in existing:
        pool.setdefault(row.get("contentHash"), []).append(row)
    reused, stale_vectors = 0, 0
    for chunk in chunks:
        candidates = pool.get(chunk.get("contentHash"))
        if not candidates:
            continue
        row = candidates.pop(0)
        chunk["id"] = row["id"]
        chunk["reuseExisting"] = True
        model = row.get("embeddingModel")
        chunk["keepEmbedding"] = bool(model) and model == embedding_model
        reused += 1
        stale_vectors += 0 if chunk["keepEmbedding"] else 1
    return {"reused": reused, "reembed": stale_vectors, "new": len(chunks) - reused}
