import logging
import hashlib
import os
import re
import threading
import uuid
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
# The reranker's config allows 8192 tokens; chunk pairs are ~350 tokens on
# average (max ~670), and 512 was 1.5x faster than the default on CPU.
RERANKER_MAX_LENGTH = int(os.getenv("RERANKER_MAX_LENGTH", "512"))
RERANKER_ENABLED = os.getenv("RERANKER_ENABLED", "true").strip().lower() not in ("0", "false", "no")

_model = None
_reranker = None
# Concurrent first requests must not each load a 2 GB model.
_model_lock = threading.Lock()


def get_model():
    """Process-wide BGE-M3 embedder, loaded once."""
    global _model
    if _model is None:
        with _model_lock:
            if _model is None:
                from sentence_transformers import SentenceTransformer

                model = SentenceTransformer(EMBEDDING_MODEL)
                dimensions = int(model.get_sentence_embedding_dimension() or 0)
                if dimensions != BGE_M3_DIMENSIONS:
                    raise RuntimeError(
                        f"{EMBEDDING_MODEL} produced {dimensions} dimensions; "
                        f"DocLens expects {BGE_M3_DIMENSIONS}"
                    )
                _model = model
    return _model


def get_reranker():
    """Process-wide cross-encoder, loaded once; None when RERANKER_ENABLED=false."""
    global _reranker
    if not RERANKER_ENABLED:
        return None
    if _reranker is None:
        with _model_lock:
            if _reranker is None:
                from sentence_transformers import CrossEncoder

                _reranker = CrossEncoder(RERANKER_MODEL, max_length=RERANKER_MAX_LENGTH)
    return _reranker


def models_loaded() -> dict:
    return {"embedding": _model is not None, "reranker": _reranker is not None or not RERANKER_ENABLED}


def warm_up_models() -> None:
    """Load both models and run one tiny inference so the first user request
    does not pay the ~20 s load. Called from a background thread at startup."""
    try:
        get_model().encode("warm up", normalize_embeddings=True)
        reranker = get_reranker()
        if reranker is not None:
            reranker.predict([["warm up", "warm up"]])
        logger.info("Models warmed up: %s", models_loaded())
    except Exception as exc:  # the service still starts; requests load lazily
        logger.warning("Model warm-up failed: %s", exc)


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


def _legacy_page_chunks(file_path: str, title: str) -> list[dict]:
    """Page-level fallback for PDFs the layout parser cannot structure."""
    chunks = _pymupdf_chunks(file_path, title)
    for chunk in chunks:
        chunk["id"] = str(uuid.uuid4())
        chunk["metadata"].setdefault("section_type", "other")
    return chunks


def ingest_document(document_id: str, file_path: str, collection_id: str):
    """
    Parse a research PDF into structured, section-typed evidence chunks.

    Pipeline: layout parse (sections, abstract, references, captions, tables)
    → section-aware chunks with contextual headers → paper profile (map step)
    → persist chunks + profile chunk. Embedding happens in /embed.
    """
    from rag.chunking import build_chunks, finalise_chunks, reconcile_chunk_ids
    from rag.paper_profile import build_profile, profile_chunk
    from rag.pdf_parser import parse_paper

    if not os.path.exists(file_path):
        return {"status": "failed", "message": f"File not found: {file_path}"}

    existing_title = pg_store.get_document_title(document_id)
    pdf_meta = _pdf_metadata(file_path)

    paper = None
    try:
        paper = parse_paper(file_path)
    except Exception as exc:
        logger.warning("Layout parser failed for %s, using page fallback: %s", document_id, exc)

    detected_title = paper.title if paper else ""
    title = _best_title(existing_title, {"title": detected_title or pdf_meta.get("title")}, file_path)

    chunks: list[dict] = build_chunks(paper, title) if paper else []
    extractor = paper.parser if paper else "pymupdf"
    body_chunks = [c for c in chunks if c["metadata"].get("content_type") not in {"reference", "front_matter"}]
    if len(body_chunks) < 2:
        # Scanned or unusual layouts: keep whatever structure we found, add page text.
        chunks = _legacy_page_chunks(file_path, title) + [c for c in chunks if c["metadata"].get("content_type") == "reference"]
        extractor = "pymupdf"

    if not chunks:
        return {"status": "failed", "message": "No extractable text found in PDF"}

    # Hash first, then adopt stored ids for unchanged text (keeps citations and
    # vectors across re-index) before the profile records any chunk ids.
    finalise_chunks(chunks, document_id, collection_id)
    reuse = reconcile_chunk_ids(chunks, pg_store.get_chunk_fingerprints(document_id), EMBEDDING_MODEL)

    profile, profile_method = build_profile(title, chunks, paper.abstract if paper else "")
    card = profile_chunk(title, profile)
    if card:
        chunks.append(card)

    finalise_chunks(chunks, document_id, collection_id)
    persisted = pg_store.insert_ingestion_chunks(chunks, document_id)
    logger.info("Ingest %s: reuse=%s persisted=%s", document_id, reuse, persisted)

    words = _word_count(c for c in chunks if c["metadata"].get("content_type") != "paper_profile")
    evidence_types = sorted({chunk["metadata"]["content_type"] for chunk in chunks})
    authors = (paper.authors if paper else []) or pdf_meta.get("authors", [])
    ingest_metadata = {
        "title": title,
        "authors": authors,
        "page_count": pdf_meta.get("page_count"),
        "wordCount": words,
        "readingTimeMinutes": _reading_time_minutes(words),
        "extractor": extractor,
        "chunkCount": len(chunks),
        "evidenceTypes": evidence_types,
        "abstract": (paper.abstract[:3000] if paper else ""),
        "outline": [
            {"heading": s.heading, "type": s.section_type, "level": s.level, "page": s.page_start}
            for s in (paper.sections if paper else [])
            if s.section_type != "front_matter"
        ],
        "referenceCount": len(paper.references) if paper else 0,
        "profile": profile.model_dump(),
        "profileMethod": profile_method,
        "vectorStore": "pending-embedding",
    }
    pg_store.update_document_ingest_metadata(document_id, ingest_metadata)

    return {
        "status": "completed",
        "chunks_processed": len(chunks),
        "title": title,
        "authors": authors,
        "page_count": pdf_meta.get("page_count"),
        "word_count": words,
        "reading_time_minutes": _reading_time_minutes(words),
        "extractor": extractor,
        "evidence_types": evidence_types,
        "sections": [s.section_type for s in paper.sections] if paper else [],
        "reference_count": ingest_metadata["referenceCount"],
        "profile_method": profile_method,
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
