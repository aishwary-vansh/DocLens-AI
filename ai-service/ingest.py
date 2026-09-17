import logging
import os
import re
from pathlib import Path
from typing import Any, Iterable, Optional

from dotenv import load_dotenv

from vector_store.pg_store import BGE_M3_DIMENSIONS, pg_store

load_dotenv()

logger = logging.getLogger(__name__)

EMBEDDING_MODEL = os.getenv("EMBEDDING_MODEL", "BAAI/bge-m3")
RERANKER_MODEL = os.getenv("RERANKER_MODEL", "BAAI/bge-reranker-v2-m3")
CHUNK_MAX_CHARS = int(os.getenv("CHUNK_MAX_CHARS", "3600"))
CHUNK_OVERLAP_CHARS = int(os.getenv("CHUNK_OVERLAP_CHARS", "450"))
MIN_CHUNK_CHARS = int(os.getenv("MIN_CHUNK_CHARS", "120"))
EMBED_BATCH_SIZE = int(os.getenv("EMBED_BATCH_SIZE", "16"))

_model = None
_reranker = None


def get_model():
    global _model
    if _model is None:
        from sentence_transformers import SentenceTransformer

        logger.info("Loading embedding model: %s", EMBEDDING_MODEL)
        _model = SentenceTransformer(EMBEDDING_MODEL)
        dimensions = int(_model.get_sentence_embedding_dimension() or 0)
        if dimensions != BGE_M3_DIMENSIONS:
            raise RuntimeError(
                f"{EMBEDDING_MODEL} produced {dimensions} dimensions; "
                f"DocLens expects {BGE_M3_DIMENSIONS}"
            )
    return _model


def get_reranker():
    global _reranker
    if _reranker is None:
        from sentence_transformers import CrossEncoder

        logger.info("Loading reranker model: %s", RERANKER_MODEL)
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


def _safe_docling_label(item: Any) -> str:
    label = getattr(item, "label", None)
    return str(label) if label is not None else "text"


def _docling_chunks(file_path: str, title: str) -> list[dict]:
    """Try structure-aware Docling extraction. Raises when Docling cannot parse."""
    from docling.chunking import HierarchicalChunker
    from docling.document_converter import DocumentConverter

    converter = DocumentConverter()
    conv_res = converter.convert(file_path)
    doc = conv_res.document
    chunker = HierarchicalChunker()
    chunks = []

    for source_index, chunk in enumerate(chunker.chunk(doc)):
        text = clean_text(getattr(chunk, "text", "") or "")
        if len(text) < MIN_CHUNK_CHARS:
            continue

        meta = getattr(chunk, "meta", None)
        headings = list(getattr(meta, "headings", []) or []) if meta else []
        doc_items = list(getattr(meta, "doc_items", []) or []) if meta else []

        page_nos = []
        for item in doc_items:
            for prov in getattr(item, "prov", []) or []:
                page_no = getattr(prov, "page_no", None)
                if page_no:
                    page_nos.append(int(page_no))

        section_prefix = f"Section: {' > '.join(headings)}\n\n" if headings else ""
        rich_text = clean_text(f"Paper: {title}\n{section_prefix}{text}")
        for part_index, part in enumerate(split_text(rich_text)):
            chunks.append(
                {
                    "content": part,
                    "pageNumber": min(page_nos) if page_nos else None,
                    "metadata": {
                        "extractor": "docling",
                        "source_chunk_index": source_index,
                        "source_part_index": part_index,
                        "section": headings[0] if headings else "",
                        "subsection": headings[-1] if len(headings) > 1 else "",
                        "page_start": min(page_nos) if page_nos else None,
                        "page_end": max(page_nos) if page_nos else None,
                        "content_type": _safe_docling_label(doc_items[0]) if doc_items else "text",
                    },
                }
            )

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


def _pymupdf_chunks(file_path: str, title: str) -> list[dict]:
    """Reliable fallback extraction for PDFs that Docling cannot structure."""
    import fitz

    chunks = []
    with fitz.open(file_path) as pdf:
        for page_index, page in enumerate(pdf, start=1):
            text = clean_text(page.get_text("text") or "")
            if len(text) < MIN_CHUNK_CHARS:
                continue
            rich_text = clean_text(f"Paper: {title}\nPage: {page_index}\n\n{text}")
            for part_index, part in enumerate(split_text(rich_text)):
                chunks.append(
                    {
                        "content": part,
                        "pageNumber": page_index,
                        "metadata": {
                            "extractor": "pymupdf",
                            "source_page": page_index,
                            "source_part_index": part_index,
                            "section": "",
                            "subsection": "",
                            "page_start": page_index,
                            "page_end": page_index,
                            "content_type": "page_text",
                        },
                    }
                )
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
    Parse a PDF, build retrieval-friendly chunks, embed with BGE-M3, and store
    chunks in PostgreSQL/pgvector.
    """
    if not os.path.exists(file_path):
        return {"status": "failed", "message": f"File not found: {file_path}"}

    existing_title = pg_store.get_document_title(document_id)
    pdf_meta = _pdf_metadata(file_path)
    title = _best_title(existing_title, pdf_meta, file_path)

    try:
        chunks = _docling_chunks(file_path, title)
        extractor = "docling"
    except Exception as exc:
        logger.warning("Docling extraction failed for %s; falling back to PyMuPDF: %s", document_id, exc)
        chunks = _pymupdf_chunks(file_path, title)
        extractor = "pymupdf"

    if not chunks:
        chunks = _pymupdf_chunks(file_path, title)
        extractor = "pymupdf"

    if not chunks:
        return {"status": "failed", "message": "No extractable text found in PDF"}

    for index, chunk in enumerate(chunks):
        chunk["chunkIndex"] = index
        chunk["metadata"] = {
            **chunk.get("metadata", {}),
            "paper_id": document_id,
            "collection_id": collection_id,
            "chunk_index": index,
        }

    texts_to_embed = [chunk["content"] for chunk in chunks]
    model = get_model()
    embeddings = model.encode(
        texts_to_embed,
        batch_size=EMBED_BATCH_SIZE,
        normalize_embeddings=True,
        show_progress_bar=False,
    )

    for index, chunk in enumerate(chunks):
        chunk["embedding"] = embeddings[index].tolist()

    pg_store.insert_chunks(chunks, document_id)

    words = _word_count(chunks)
    ingest_metadata = {
        "title": title,
        "authors": pdf_meta.get("authors", []),
        "page_count": pdf_meta.get("page_count"),
        "wordCount": words,
        "readingTimeMinutes": _reading_time_minutes(words),
        "extractor": extractor,
        "embeddingModel": EMBEDDING_MODEL,
        "embeddingDimensions": BGE_M3_DIMENSIONS,
        "chunkCount": len(chunks),
        "vectorStore": "pgvector",
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
        "embedding_model": EMBEDDING_MODEL,
        "embedding_dimensions": BGE_M3_DIMENSIONS,
        "vector_store": "pgvector",
    }
