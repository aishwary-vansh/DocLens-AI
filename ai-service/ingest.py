import logging
import hashlib
import os
import re
from pathlib import Path
from typing import Iterable

from dotenv import load_dotenv

from vector_store.pg_store import BGE_M3_DIMENSIONS, pg_store

load_dotenv()

logger = logging.getLogger(__name__)

CHUNK_MAX_CHARS = int(os.getenv("CHUNK_MAX_CHARS", "3600"))
CHUNK_OVERLAP_CHARS = int(os.getenv("CHUNK_OVERLAP_CHARS", "450"))
MIN_CHUNK_CHARS = int(os.getenv("MIN_CHUNK_CHARS", "120"))
EMBEDDING_MODEL = os.getenv("EMBEDDING_MODEL", "BAAI/bge-m3")
RERANKER_MODEL = os.getenv("RERANKER_MODEL", "BAAI/bge-reranker-v2-m3")
EMBED_BATCH_SIZE = int(os.getenv("EMBED_BATCH_SIZE", "16"))

_model = None
_reranker = None


def get_model():
    """Compatibility hook for the later embedding phase."""
    global _model
    if _model is None:
        from sentence_transformers import SentenceTransformer

        _model = SentenceTransformer(EMBEDDING_MODEL)
        dimensions = int(_model.get_sentence_embedding_dimension() or 0)
        if dimensions != BGE_M3_DIMENSIONS:
            raise RuntimeError(
                f"{EMBEDDING_MODEL} produced {dimensions} dimensions; "
                f"DocLens expects {BGE_M3_DIMENSIONS}"
            )
    return _model


def get_reranker():
    """Compatibility hook for the later reranking phase."""
    global _reranker
    if _reranker is None:
        from sentence_transformers import CrossEncoder

        _reranker = CrossEncoder(RERANKER_MODEL)
    return _reranker


def clean_text(value: str) -> str:
    value = value.replace("\x00", " ")
    value = re.sub(r"-\s*\n\s*", "", value)
    value = re.sub(r"[ \t]+", " ", value)
    value = re.sub(r"\n{3,}", "\n\n", value)
    return value.strip()


def _tail_overlap(text: str) -> str:
    if len(text) <= CHUNK_OVERLAP_CHARS:
        return text
    tail = text[-CHUNK_OVERLAP_CHARS:]
    first_space = tail.find(" ")
    return tail[first_space + 1 :] if first_space > 0 else tail


def split_text(text: str, max_chars: int = CHUNK_MAX_CHARS) -> list[str]:
    """Split text into retrieval-sized chunks without cutting every sentence."""
    text = clean_text(text)
    if len(text) <= max_chars:
        return [text] if len(text) >= MIN_CHUNK_CHARS else []

    paragraphs = [p.strip() for p in re.split(r"\n\s*\n", text) if p.strip()]
    pieces: list[str] = []

    for paragraph in paragraphs:
        if len(paragraph) <= max_chars:
            pieces.append(paragraph)
            continue

        sentences = re.split(r"(?<=[.!?])\s+", paragraph)
        pieces.extend(sentence.strip() for sentence in sentences if sentence.strip())

    chunks: list[str] = []
    current = ""
    for piece in pieces:
        if not current:
            current = piece
            continue

        if len(current) + len(piece) + 2 <= max_chars:
            current = f"{current}\n\n{piece}"
            continue

        if len(current) >= MIN_CHUNK_CHARS:
            chunks.append(current.strip())
        overlap = _tail_overlap(current)
        current = f"{overlap}\n\n{piece}" if overlap else piece

    if len(current.strip()) >= MIN_CHUNK_CHARS:
        chunks.append(current.strip())

    return chunks


def _pdf_metadata(file_path: str) -> dict:
    import fitz

    with fitz.open(file_path) as pdf:
        raw = pdf.metadata or {}
        title = clean_text(raw.get("title") or "")
        author = clean_text(raw.get("author") or "")
        authors = [a.strip() for a in re.split(r";|,|\band\b", author) if a.strip()]
        return {
            "title": title,
            "authors": authors,
            "page_count": pdf.page_count,
        }


def _table_chunks(page, page_number: int, title: str, section: str = "") -> list[dict]:
    """Extract native PDF tables when PyMuPDF exposes its table detector."""
    find_tables = getattr(page, "find_tables", None)
    if not find_tables:
        return []
    try:
        tables = find_tables().tables
    except Exception as exc:
        logger.debug("Table extraction skipped on page %d: %s", page_number, exc)
        return []

    chunks = []
    for table_index, table in enumerate(tables):
        try:
            markdown = table.to_markdown()
        except Exception:
            continue
        if not markdown or len(markdown.strip()) < MIN_CHUNK_CHARS:
            continue
        chunks.append(
            {
                "content": clean_text(
                    f"Paper: {title}\nPage: {page_number}\n"
                    f"Table {table_index + 1}:\n{markdown}"
                ),
                "pageNumber": page_number,
                "metadata": {
                    "extractor": "pymupdf-table",
                    "source_page": page_number,
                    "content_type": "table",
                    "table_index": table_index,
                    "section": section,
                },
            }
        )
    return chunks


def _figure_chunks(page, page_number: int, title: str, page_text: str, section: str = "") -> list[dict]:
    """Represent figure captions and page image presence without interpreting pixels."""
    image_count = len(page.get_images(full=True))
    if image_count == 0:
        return []

    captions = re.findall(
        r"(?im)^\s*((?:figure|fig\.)\s*[\w.-]+[^\n]*)",
        page_text,
    )
    if not captions:
        captions = [f"Figure on page {page_number}"]

    return [
        {
            "content": clean_text(
                f"Paper: {title}\nPage: {page_number}\n{caption}\n"
                "Visual evidence is present on this page; pixel interpretation is deferred."
            ),
            "pageNumber": page_number,
            "metadata": {
                "extractor": "pymupdf",
                "source_page": page_number,
                "content_type": "figure",
                "caption": caption,
                "image_count": image_count,
                "section": section,
            },
        }
        for caption in captions
    ]


def _pymupdf_chunks(file_path: str, title: str) -> list[dict]:
    """Extract text, native tables, and captioned visual evidence."""
    import fitz

    chunks = []
    current_section = ""
    with fitz.open(file_path) as pdf:
        for page_index, page in enumerate(pdf, start=1):
            raw_text = page.get_text("text") or ""
            text = clean_text(raw_text)
            for line in (line.strip() for line in raw_text.splitlines()):
                if (
                    3 <= len(line) <= 120
                    and len(line.split()) <= 14
                    and not line.endswith((".", ",", ";", ":"))
                    and (
                        re.match(r"^\d+(?:\.\d+)*\s+", line)
                        or line.isupper()
                        or line.istitle()
                    )
                ):
                    current_section = line
                    break
            if len(text) >= MIN_CHUNK_CHARS:
                section_prefix = f"Section: {current_section}\n" if current_section else ""
                rich_text = clean_text(
                    f"Paper: {title}\nPage: {page_index}\n{section_prefix}\n{text}"
                )
                for part_index, part in enumerate(split_text(rich_text)):
                    chunks.append(
                        {
                            "content": part,
                            "pageNumber": page_index,
                            "metadata": {
                                "extractor": "pymupdf",
                                "source_page": page_index,
                                "source_part_index": part_index,
                                "section": current_section,
                                "content_type": "page_text",
                            },
                        }
                    )
            chunks.extend(_table_chunks(page, page_index, title, current_section))
            chunks.extend(_figure_chunks(page, page_index, title, raw_text, current_section))
    return chunks


def _best_title(existing_title: str, metadata: dict, file_path: str) -> str:
    pdf_title = clean_text(metadata.get("title") or "")
    if pdf_title and pdf_title.lower() not in {"untitled", "unknown"}:
        return pdf_title[:500]
    if existing_title and existing_title != "Unknown Document":
        return existing_title
    return Path(file_path).stem


def _word_count(chunks: Iterable[dict]) -> int:
    return sum(len((chunk.get("content") or "").split()) for chunk in chunks)


def _reading_time_minutes(word_count: int) -> int:
    return max(1, round(word_count / 220))


def ingest_document(document_id: str, file_path: str, collection_id: str):
    """
    Parse a PDF into persistent Phase 1 evidence chunks.
    """
    if not os.path.exists(file_path):
        return {"status": "failed", "message": f"File not found: {file_path}"}

    existing_title = pg_store.get_document_title(document_id)
    pdf_meta = _pdf_metadata(file_path)
    title = _best_title(existing_title, pdf_meta, file_path)

    chunks = _pymupdf_chunks(file_path, title)
    extractor = "pymupdf"

    if not chunks:
        return {"status": "failed", "message": "No extractable text found in PDF"}

    for index, chunk in enumerate(chunks):
        chunk["chunkIndex"] = index
        chunk["contentHash"] = hashlib.sha256(chunk["content"].encode("utf-8")).hexdigest()
        chunk["metadata"] = {
            **chunk.get("metadata", {}),
            "paper_id": document_id,
            "collection_id": collection_id,
            "chunk_index": index,
        }

    pg_store.insert_ingestion_chunks(chunks, document_id)

    words = _word_count(chunks)
    ingest_metadata = {
        "title": title,
        "authors": pdf_meta.get("authors", []),
        "page_count": pdf_meta.get("page_count"),
        "wordCount": words,
        "readingTimeMinutes": _reading_time_minutes(words),
        "extractor": extractor,
        "chunkCount": len(chunks),
        "evidenceTypes": sorted({chunk["metadata"]["content_type"] for chunk in chunks}),
        "vectorStore": "pending-embedding",
    }
    pg_store.update_document_ingest_metadata(document_id, ingest_metadata)

    return {
        "status": "completed",
        "chunks_processed": len(chunks),
        "title": title,
        "authors": pdf_meta.get("authors", []),
        "page_count": pdf_meta.get("page_count"),
        "word_count": words,
        "reading_time_minutes": _reading_time_minutes(words),
        "extractor": extractor,
        "evidence_types": sorted({chunk["metadata"]["content_type"] for chunk in chunks}),
        "vector_store": "postgresql",
        "embedding_status": "pending",
    }


def embed_document(document_id: str) -> dict:
    """Generate BGE-M3 embeddings for Phase 1 chunks and persist them."""
    chunks = pg_store.get_unembedded_chunks(document_id)
    if not chunks:
        return {
            "status": "completed",
            "document_id": document_id,
            "chunks_embedded": 0,
            "embedding_model": EMBEDDING_MODEL,
            "embedding_dimensions": BGE_M3_DIMENSIONS,
        }

    model = get_model()
    embeddings = model.encode(
        [chunk["content"] for chunk in chunks],
        batch_size=EMBED_BATCH_SIZE,
        normalize_embeddings=True,
        show_progress_bar=False,
    )
    for index, chunk in enumerate(chunks):
        vector = embeddings[index]
        chunk["embedding"] = vector.tolist() if hasattr(vector, "tolist") else list(vector)

    pg_store.update_chunk_embeddings(document_id, chunks, EMBEDDING_MODEL)
    return {
        "status": "completed",
        "document_id": document_id,
        "chunks_embedded": len(chunks),
        "embedding_model": EMBEDDING_MODEL,
        "embedding_dimensions": BGE_M3_DIMENSIONS,
    }
