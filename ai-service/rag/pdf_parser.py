# ai-service/rag/pdf_parser.py
# ─────────────────────────────────────────────────────────────────────────────
# Layout-aware research-paper parser built on PyMuPDF.
#
# A page-by-page text dump loses the structure that makes papers useful for
# research questions. This parser rebuilds that structure:
#
#   1. Span-level extraction with font size / bold flags, in reading order
#      (PyMuPDF sort=True handles most two-column layouts).
#   2. Running headers/footers and bare page numbers are removed by detecting
#      lines that repeat in the top/bottom margin across many pages.
#   3. Headings are detected from typography (larger or bold short lines,
#      numbered "3.2 Method" style) plus a vocabulary of known section names.
#   4. Every heading is mapped to a canonical section type (abstract, method,
#      results, limitations, ...) so retrieval can route questions to the
#      right part of a paper.
#   5. Title, abstract, references, figure and table captions are pulled out
#      as first-class objects.
#
# The output is a ParsedPaper, which rag/chunking.py turns into chunks.
# ─────────────────────────────────────────────────────────────────────────────
from __future__ import annotations

import logging
import re
import unicodedata
from collections import Counter
from dataclasses import dataclass, field
from typing import List, Optional

logger = logging.getLogger(__name__)

# Canonical section types. Order matters only for readability.
SECTION_TYPES = (
    "front_matter",
    "abstract",
    "introduction",
    "related_work",
    "background",
    "method",
    "experiments",
    "results",
    "discussion",
    "limitations",
    "conclusion",
    "future_work",
    "acknowledgements",
    "back_matter",
    "references",
    "appendix",
    "other",
)

# (regex on the normalised heading text, section type). First match wins, so
# more specific patterns come first ("future work" before "conclusion").
_SECTION_PATTERNS: list[tuple[str, str]] = [
    (r"\babstract\b", "abstract"),
    (r"\b(references|bibliography|works cited|literature cited)\b", "references"),
    (r"\backnowledg", "acknowledgements"),
    (
        r"\b((data|code|materials) availability|author contributions?|competing interests?|"
        r"conflicts? of interest|additional information|ethics( statement| approval)?|funding|"
        r"reporting summary|declarations?)\b",
        "back_matter",
    ),
    (r"\b(appendix|appendices|supplementary)\b", "appendix"),
    (r"\b(limitations?|threats to validity|weakness(es)?|failure (cases|modes))\b", "limitations"),
    (r"\b(future (work|directions?|research)|open (problems|questions|challenges)|outlook)\b", "future_work"),
    (r"\b(conclusions?|concluding remarks|summary and conclusion)\b", "conclusion"),
    (r"\b(related work|prior work|literature review|previous work|state of the art)\b", "related_work"),
    (r"\b(introduction|motivation)\b", "introduction"),
    (r"\b(background|preliminar(y|ies)|problem (formulation|statement|definition)|notation)\b", "background"),
    (r"\b(discussion|analysis|ablation|implications|case stud(y|ies))\b", "discussion"),
    (r"\b(results?|findings|evaluation|performance|comparison with)\b", "results"),
    (r"\b(experiment(s|al)?( setup| settings| design)?|datasets?|implementation details|benchmarks?|setup)\b", "experiments"),
    (
        r"\b(method(s|ology)?|approach|proposed|model|architecture|framework|algorithm|system design|"
        r"materials and methods|our method|technique)\b",
        "method",
    ),
]

_KNOWN_HEADING_WORDS = re.compile(
    r"^(abstract|introduction|related work|background|methods?|methodology|approach|"
    r"experiments?|experimental setup|results?|discussion|limitations?|conclusions?|"
    r"future work|acknowledge?ments?|references|bibliography|appendix)$",
    re.IGNORECASE,
)

_NUMBERED_HEADING = re.compile(r"^(?:(\d{1,2}(?:\.\d{1,2}){0,3})\.?|([IVX]{1,5})\.|([A-Z])\.)\s+(\S.*)$")
_INLINE_ABSTRACT = re.compile(r"^\s*abstract\s*[—–:.\-]\s*(.+)$", re.IGNORECASE | re.DOTALL)
_CAPTION = re.compile(r"^\s*((?:fig(?:ure)?|table)\.?\s*[A-Z]?\d+[a-z]?)\s*[:.|]?\s*(.*)$", re.IGNORECASE | re.DOTALL)
_PAGE_NUMBER = re.compile(r"^\s*(?:page\s*)?\d{1,4}\s*(?:of\s*\d{1,4})?\s*$", re.IGNORECASE)
_REFERENCE_START = re.compile(r"^\s*(\[\d{1,3}\]|\d{1,3}\.\s+[A-Z])")


def classify_section(heading: str) -> str:
    """Map a free-text heading to a canonical section type."""
    text = _strip_heading_number(heading).lower()
    text = re.sub(r"[^a-z\s]", " ", text)
    text = re.sub(r"\s+", " ", text).strip()
    if not text:
        return "other"
    for pattern, section_type in _SECTION_PATTERNS:
        if re.search(pattern, text):
            return section_type
    return "other"


def _strip_heading_number(heading: str) -> str:
    match = _NUMBERED_HEADING.match(heading.strip())
    return match.group(4) if match else heading.strip()


def _heading_level(heading: str) -> int:
    match = _NUMBERED_HEADING.match(heading.strip())
    if match and match.group(1):
        return match.group(1).count(".") + 1
    if match and match.group(3):
        return 2  # "A. Subsection" (IEEE style)
    return 1


def normalise_whitespace(text: str) -> str:
    text = text.replace("\x00", " ").replace("­", "")
    text = re.sub(r"(\w)-\s*\n\s*(\w)", r"\1\2", text)  # de-hyphenate line breaks
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r"\s*\n\s*", " ", text)
    return text.strip()


# ── Data model ───────────────────────────────────────────────────────────────


@dataclass
class Paragraph:
    text: str
    page: int


@dataclass
class Section:
    heading: str
    section_type: str
    level: int = 1
    paragraphs: List[Paragraph] = field(default_factory=list)

    @property
    def text(self) -> str:
        return "\n\n".join(p.text for p in self.paragraphs)

    @property
    def page_start(self) -> Optional[int]:
        return self.paragraphs[0].page if self.paragraphs else None


@dataclass
class Caption:
    kind: str  # "figure" | "table"
    label: str
    text: str
    page: int


@dataclass
class TableBlock:
    page: int
    markdown: str
    caption: str = ""
    section: str = ""


@dataclass
class ParsedPaper:
    title: str
    authors: List[str]
    abstract: str
    sections: List[Section]
    references: List[str]
    captions: List[Caption]
    tables: List[TableBlock]
    page_count: int
    parser: str = "pymupdf-layout"

    def section_types(self) -> List[str]:
        return sorted({s.section_type for s in self.sections})


@dataclass
class _Line:
    text: str
    size: float
    bold: bool
    page: int
    y0: float
    y1: float
    page_height: float
    block_id: int


# ── Extraction ───────────────────────────────────────────────────────────────


def _page_lines(page, page_number: int) -> List[_Line]:
    try:
        data = page.get_text("dict", sort=True)
    except TypeError:  # very old PyMuPDF without sort
        data = page.get_text("dict")
    height = float(page.rect.height or 1.0)
    lines: List[_Line] = []
    for block_index, block in enumerate(data.get("blocks", [])):
        if block.get("type", 0) != 0:
            continue
        for line in block.get("lines", []):
            spans = [s for s in line.get("spans", []) if (s.get("text") or "").strip()]
            if not spans:
                continue
            text = unicodedata.normalize("NFKC", "".join(s.get("text", "") for s in spans)).strip()
            chars = sum(len(s.get("text", "").strip()) for s in spans) or 1
            bold_chars = sum(
                len(s.get("text", "").strip())
                for s in spans
                if (int(s.get("flags", 0)) & 16) or "bold" in (s.get("font") or "").lower()
            )
            size = max(float(s.get("size", 0.0)) for s in spans)
            bbox = line.get("bbox") or block.get("bbox") or (0, 0, 0, 0)
            lines.append(
                _Line(
                    text=text,
                    size=round(size, 1),
                    bold=bold_chars / chars >= 0.8,
                    page=page_number,
                    y0=float(bbox[1]),
                    y1=float(bbox[3]),
                    page_height=height,
                    block_id=page_number * 10_000 + block_index,
                )
            )
    return lines


def _body_font_size(lines: List[_Line]) -> float:
    weighted: Counter = Counter()
    for line in lines:
        weighted[line.size] += len(line.text)
    return weighted.most_common(1)[0][0] if weighted else 10.0


def _margin_key(text: str) -> str:
    return re.sub(r"\d+", "#", text.lower()).strip()


def _remove_running_headers(lines: List[_Line], page_count: int) -> List[_Line]:
    """Drop lines that repeat in the top/bottom margin on many pages, and page numbers."""
    margin_counts: Counter = Counter()
    for line in lines:
        rel_top = line.y0 / line.page_height
        rel_bottom = line.y1 / line.page_height
        if rel_top < 0.08 or rel_bottom > 0.92:
            margin_counts[_margin_key(line.text)] += 1

    threshold = max(3, int(page_count * 0.4)) if page_count >= 3 else 10**9
    repeated = {key for key, count in margin_counts.items() if count >= threshold}

    kept = []
    for line in lines:
        in_margin = line.y0 / line.page_height < 0.08 or line.y1 / line.page_height > 0.92
        if in_margin and (_PAGE_NUMBER.match(line.text) or _margin_key(line.text) in repeated):
            continue
        kept.append(line)
    return kept


def _is_heading(line: _Line, body_size: float) -> bool:
    text = line.text.strip()
    words = text.split()
    if not (2 <= len(text) <= 100) or len(words) > 12:
        return False
    if _CAPTION.match(text) and re.match(r"^\s*(fig|table)", text, re.IGNORECASE):
        return False
    if re.search(r"[@=]|https?://|\bet al\b", text):
        return False
    bare = _strip_heading_number(text)
    if _KNOWN_HEADING_WORDS.match(bare.rstrip(":. ")):
        return line.bold or line.size > body_size + 0.4 or text.isupper() or bool(_NUMBERED_HEADING.match(text))
    if text.endswith((".", ",", ";")) and not _NUMBERED_HEADING.match(text):
        return False
    if not re.search(r"[A-Za-z]{3,}", bare):
        return False
    larger = line.size >= body_size + 1.0
    numbered = bool(_NUMBERED_HEADING.match(text)) and bare[:1].isupper()
    if numbered and (line.bold or larger or len(words) <= 8):
        # Reject numbered list items / equations that look like headings.
        return not bare.endswith(".") and len(bare) <= 80
    if larger and (line.bold or bare[:1].isupper()):
        return True
    if line.bold and bare[:1].isupper() and len(words) <= 8 and line.size >= body_size - 0.2:
        return True
    return False


_NO_INHERIT = {"acknowledgements", "back_matter", "abstract"}


def _inherit_type(sections: List[Section]) -> str:
    """Type for a generic heading ("Question Answering", "Task #1").

    Before the abstract/introduction it is front matter (affiliations etc.);
    afterwards it is most likely a subsection of the last typed section,
    e.g. a dataset-specific subsection inside Results.
    """
    seen_body = any(s.section_type not in {"front_matter", "other"} for s in sections)
    if not seen_body:
        return "front_matter"
    for section in reversed(sections):
        if section.section_type in _NO_INHERIT:
            return "other" if section.section_type != "abstract" else "introduction"
        if section.section_type not in {"other", "front_matter"}:
            return section.section_type
    return "other"


def _detect_title(lines: List[_Line], metadata_title: str) -> str:
    first_page = [l for l in lines if l.page == 1 and l.y0 / l.page_height < 0.5]
    if first_page:
        biggest = max(l.size for l in first_page)
        title_lines = []
        for line in first_page:
            if line.size >= biggest - 0.3 and len(line.text) > 3:
                title_lines.append(line.text)
            elif title_lines:
                break
        candidate = normalise_whitespace(" ".join(title_lines))
        if 10 <= len(candidate) <= 300 and not _PAGE_NUMBER.match(candidate):
            if not metadata_title or len(metadata_title) < 8 or metadata_title.lower().endswith((".pdf", ".docx", ".tex")):
                return candidate
    return metadata_title


def _group_paragraphs(lines: List[_Line]) -> List[Paragraph]:
    """Lines belonging to the same PyMuPDF block form one paragraph."""
    paragraphs: List[Paragraph] = []
    current: List[_Line] = []
    for line in lines:
        if current and line.block_id != current[-1].block_id:
            paragraphs.append(Paragraph(normalise_whitespace("\n".join(l.text for l in current)), current[0].page))
            current = []
        current.append(line)
    if current:
        paragraphs.append(Paragraph(normalise_whitespace("\n".join(l.text for l in current)), current[0].page))
    return [p for p in paragraphs if p.text]


def _split_references(section: Section) -> List[str]:
    text = "\n".join(p.text for p in section.paragraphs)
    entries = re.split(r"\s(?=\[\d{1,3}\]\s)", text)
    if len(entries) <= 2:
        # Nature / Vancouver style: "12. Smith, J. ..."
        numbered = re.split(r"(?:^|\s)(?=\d{1,3}\.\s+[A-Z][\w'’-]+,?\s)", text)
        entries = numbered if len(numbered) > 2 else [p.text for p in section.paragraphs]
    cleaned = [normalise_whitespace(e) for e in entries]
    return [e for e in cleaned if len(e) >= 20]


def _tables(pdf, sections: List[Section]) -> List[TableBlock]:
    tables: List[TableBlock] = []
    for page_index, page in enumerate(pdf, start=1):
        finder = getattr(page, "find_tables", None)
        if not finder:
            break
        try:
            found = finder().tables
        except Exception as exc:  # table detection is best-effort
            logger.debug("Table extraction skipped on page %d: %s", page_index, exc)
            continue
        for table in found:
            try:
                markdown = table.to_markdown()
            except Exception:
                continue
            if markdown and len(markdown.strip()) >= 80:
                tables.append(TableBlock(page=page_index, markdown=markdown.strip(), section=_section_for_page(sections, page_index)))
    return tables


def _section_for_page(sections: List[Section], page: int) -> str:
    heading = ""
    for section in sections:
        start = section.page_start
        if start is not None and start <= page:
            heading = section.heading
    return heading


def parse_paper(file_path: str) -> ParsedPaper:
    """Parse a research-paper PDF into structured sections."""
    import fitz

    with fitz.open(file_path) as pdf:
        meta = pdf.metadata or {}
        page_count = pdf.page_count
        all_lines: List[_Line] = []
        for page_index, page in enumerate(pdf, start=1):
            all_lines.extend(_page_lines(page, page_index))

        lines = _remove_running_headers(all_lines, page_count)
        body_size = _body_font_size(lines)
        title = _detect_title(lines, normalise_whitespace(meta.get("title") or ""))
        authors = [
            a.strip()
            for a in re.split(r";|,|\band\b", meta.get("author") or "")
            if a.strip()
        ]

        sections: List[Section] = [Section(heading="Front matter", section_type="front_matter")]
        pending: List[_Line] = []
        abstract_inline = ""
        title_norm = title.lower()

        def flush():
            if pending:
                sections[-1].paragraphs.extend(_group_paragraphs(pending))
                pending.clear()

        for line in lines:
            if line.page == 1 and title_norm and line.text.lower() in title_norm and line.size > body_size + 1:
                continue  # title lines
            inline = _INLINE_ABSTRACT.match(line.text) if line.page <= 2 else None
            if inline and not abstract_inline and len(inline.group(1)) > 20:
                flush()
                sections.append(Section(heading="Abstract", section_type="abstract"))
                abstract_inline = inline.group(1)
                pending.append(_Line(**{**line.__dict__, "text": inline.group(1)}))
                continue
            if _is_heading(line, body_size):
                flush()
                heading = line.text.strip().rstrip(":")
                section_type = classify_section(heading)
                level = _heading_level(heading)
                if section_type == "other":
                    section_type = _inherit_type(sections)
                sections.append(Section(heading=heading, section_type=section_type, level=level))
                continue
            pending.append(line)
        flush()

        sections = [s for s in sections if s.paragraphs]
        sections = _infer_abstract(sections)

        references: List[str] = []
        content_sections: List[Section] = []
        for section in sections:
            if section.section_type == "references":
                references.extend(_split_references(section))
            else:
                content_sections.append(section)

        captions = _extract_captions(content_sections)
        tables = _tables(pdf, content_sections)
        _attach_table_captions(tables, captions)

    abstract = next((s.text for s in content_sections if s.section_type == "abstract"), "")
    return ParsedPaper(
        title=title,
        authors=authors,
        abstract=abstract,
        sections=content_sections,
        references=references,
        captions=captions,
        tables=tables,
        page_count=page_count,
    )


def _infer_abstract(sections: List[Section]) -> List[Section]:
    """If no heading said 'Abstract', treat the first long front-matter paragraph as one."""
    if any(s.section_type == "abstract" for s in sections):
        return sections
    if not sections or sections[0].section_type != "front_matter":
        return sections
    front = sections[0]
    for index, paragraph in enumerate(front.paragraphs):
        if len(paragraph.text) >= 400 and paragraph.page <= 2:
            abstract = Section("Abstract", "abstract", 1, [paragraph])
            rest = front.paragraphs[index + 1 :]
            front.paragraphs = front.paragraphs[:index]
            out = [s for s in [front, abstract] if s.paragraphs]
            if rest:
                out.append(Section("Introduction", "introduction", 1, rest))
            return out + sections[1:]
    return sections


def _extract_captions(sections: List[Section]) -> List[Caption]:
    captions: List[Caption] = []
    for section in sections:
        for paragraph in section.paragraphs:
            match = _CAPTION.match(paragraph.text)
            if not match or not re.match(r"^\s*(fig|table)", paragraph.text, re.IGNORECASE):
                continue
            label = re.sub(r"\s+", " ", match.group(1)).strip()
            kind = "table" if label.lower().startswith("table") else "figure"
            if len(paragraph.text) >= 15:
                captions.append(Caption(kind=kind, label=label, text=paragraph.text, page=paragraph.page))
    return captions


def _attach_table_captions(tables: List[TableBlock], captions: List[Caption]) -> None:
    for table in tables:
        same_page = [c for c in captions if c.kind == "table" and c.page == table.page]
        if same_page:
            table.caption = same_page[0].text
