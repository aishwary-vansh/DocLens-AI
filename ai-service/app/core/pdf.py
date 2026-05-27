"""PDF text, OCR fallback, and research metadata extraction."""
from __future__ import annotations

import logging
import re
from dataclasses import dataclass, field
from pathlib import Path

logger = logging.getLogger("doclens.ai.pdf")


@dataclass
class PageContent:
    page_number: int
    text: str
    char_count: int = 0
    extraction_method: str = "text"


@dataclass
class DocumentContent:
    title: str
    authors: list[str]
    abstract: str
    pages: list[PageContent]
    total_pages: int
    file_path: str
    doi: str | None = None
    keywords: list[str] = field(default_factory=list)
    metadata: dict = field(default_factory=dict)

    @property
    def full_text(self) -> str:
        return "\n\n".join(p.text for p in self.pages)


def extract(file_path: str) -> DocumentContent:
    """Extract text and metadata from a PDF on the local filesystem."""
    try:
        import fitz
    except ImportError as exc:
        raise RuntimeError("PyMuPDF not installed. Run: pip install pymupdf") from exc

    path = Path(file_path)
    if not path.exists():
        raise FileNotFoundError(f"PDF not found: {file_path}")

    logger.info("Extracting PDF: %s", path.name)
    doc = fitz.open(str(path))
    return _extract_from_doc(doc, source_name=path.stem)


def extract_bytes(data: bytes, source_name: str = "uploaded") -> DocumentContent:
    """
    Extract text and metadata from raw PDF bytes held in memory.

    This is the preferred entry point when the PDF was received over HTTP
    (e.g. forwarded from the NestJS backend as multipart/form-data) and
    no local file path is available — which is always the case on hosted
    platforms like Render where each service has its own ephemeral disk.
    """
    try:
        import fitz
    except ImportError as exc:
        raise RuntimeError("PyMuPDF not installed. Run: pip install pymupdf") from exc

    logger.info("Extracting PDF from memory (%d bytes, source=%s)", len(data), source_name)
    doc = fitz.open(stream=data, filetype="pdf")
    return _extract_from_doc(doc, source_name=source_name)


def _extract_from_doc(doc, source_name: str) -> DocumentContent:
    """Shared extraction logic for both file-path and in-memory paths."""
    meta = doc.metadata or {}

    pages: list[PageContent] = []
    for index, page in enumerate(doc):
        text = page.get_text("text").strip()
        method = "text"

        if len(text) < 40:
            ocr_text = _ocr_page(page)
            if len(ocr_text) > len(text):
                text = ocr_text
                method = "ocr"

        if text:
            pages.append(
                PageContent(
                    page_number=index + 1,
                    text=text,
                    char_count=len(text),
                    extraction_method=method,
                )
            )

    total_pdf_pages = doc.page_count
    doc.close()

    title = _parse_title(meta, pages, source_name)
    authors = _parse_authors(meta, pages)
    abstract = _parse_abstract(pages)
    full_text = "\n\n".join(page.text for page in pages)
    doi = _parse_doi(meta, full_text)
    keywords = _parse_keywords(meta, pages)

    logger.info(
        "Extracted %d/%d pages, %d chars total from '%s'",
        len(pages),
        total_pdf_pages,
        sum(p.char_count for p in pages),
        title,
    )

    return DocumentContent(
        title=title,
        authors=authors,
        abstract=abstract,
        pages=pages,
        total_pages=total_pdf_pages,
        file_path=source_name,
        doi=doi,
        keywords=keywords,
        metadata={
            "producer": meta.get("producer"),
            "creationDate": meta.get("creationDate"),
            "modDate": meta.get("modDate"),
            "ocrPages": [p.page_number for p in pages if p.extraction_method == "ocr"],
        },
    )


def _ocr_page(page) -> str:
    """OCR a scanned page when pytesseract and Pillow are available."""
    try:
        import io

        import pytesseract
        from PIL import Image
    except Exception:
        return ""

    try:
        pix = page.get_pixmap(matrix=None, dpi=200, alpha=False)
        image = Image.open(io.BytesIO(pix.tobytes("png")))
        return pytesseract.image_to_string(image).strip()
    except Exception as exc:
        logger.debug("OCR failed on page %s: %s", page.number + 1, exc)
        return ""


def _parse_title(meta: dict, pages: list[PageContent], fallback: str) -> str:
    if meta.get("title"):
        return meta["title"].strip()
    if pages:
        candidates = [line.strip() for line in pages[0].text.splitlines() if len(line.strip()) >= 10]
        for candidate in candidates[:8]:
            if not re.search(r"^(abstract|keywords|introduction)\b", candidate, re.IGNORECASE):
                return candidate[:220]
    return fallback


def _parse_authors(meta: dict, pages: list[PageContent]) -> list[str]:
    if meta.get("author"):
        parts = [a.strip() for a in re.split(r"[,;]|\band\b", meta["author"]) if a.strip()]
        return parts[:20]

    if not pages:
        return []

    lines = [line.strip() for line in pages[0].text.splitlines() if line.strip()]
    for line in lines[1:8]:
        if re.search(r"(@|university|institute|department|abstract)", line, re.IGNORECASE):
            continue
        if 2 <= len(line.split()) <= 18 and re.search(r"[A-Z][a-z]+", line):
            authors = [part.strip() for part in re.split(r",|;|\band\b", line) if part.strip()]
            if authors:
                return authors[:20]
    return []


def _parse_abstract(pages: list[PageContent]) -> str:
    if not pages:
        return ""
    text = pages[0].text
    match = re.search(r"\babstract\b(.+?)(\b1\.?\s+introduction\b|\bintroduction\b|\bkeywords\b)", text, re.I | re.S)
    if match:
        return match.group(1).strip()[:1800]
    return text[:700]


def _parse_doi(meta: dict, text: str) -> str | None:
    raw = " ".join(str(value) for value in meta.values() if value)
    match = re.search(r"\b10\.\d{4,9}/[-._;()/:A-Z0-9]+\b", f"{raw}\n{text}", re.IGNORECASE)
    return match.group(0) if match else None


def _parse_keywords(meta: dict, pages: list[PageContent]) -> list[str]:
    raw_keywords = meta.get("keywords") or meta.get("subject") or ""
    if raw_keywords:
        return [item.strip() for item in re.split(r"[,;]", raw_keywords) if item.strip()][:20]

    if not pages:
        return []
    match = re.search(r"\bkeywords?\b[:\s]+(.+?)(\n\n|\b1\.?\s+introduction\b|\bintroduction\b)", pages[0].text, re.I | re.S)
    if not match:
        return []
    return [item.strip(" .") for item in re.split(r"[,;]", match.group(1)) if item.strip()][:20]
