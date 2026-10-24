# ai-service/rag/evidence.py
# ─────────────────────────────────────────────────────────────────────────────
# EvidencePack: numbered evidence blocks shared by every synthesis task.
#
# The LLM cites evidence by number ("[Evidence 3]") instead of copying UUIDs
# or long quotes. The server resolves numbers back to the real chunk, so a
# citation can never point to a chunk that was not in the prompt, and the
# source text shown to the user is the stored chunk text, not a paraphrase.
# ─────────────────────────────────────────────────────────────────────────────
from __future__ import annotations

import re
from typing import Dict, Iterable, List, Optional

from .schemas import CitationRef
from .verification import containment

_EVIDENCE_REF = re.compile(r"\[Evidence\s+(\d+(?:\s*,\s*\d+)*)\]", re.IGNORECASE)


def _body(content: str) -> str:
    """Strip the contextual 'Paper:/Section:' header added at ingest."""
    parts = content.split("\n\n", 1)
    if len(parts) == 2 and parts[0].startswith("Paper:"):
        return parts[1]
    return content


def snippet(text: str, limit: int = 600) -> str:
    text = re.sub(r"\s+", " ", _body(text)).strip()
    return text if len(text) <= limit else text[: limit - 1].rsplit(" ", 1)[0] + "…"


def best_window(content: str, hint: str, limit: int = 600) -> str:
    """The run of consecutive sentences (<= limit chars) that best covers `hint`.

    Used so a citation displays the part of a chunk that supports the claim,
    rather than the chunk's opening lines.
    """
    from .chunking import split_sentences
    from .verification import _content_tokens

    body = re.sub(r"\s+", " ", _body(content)).strip()
    sentences = split_sentences(body)
    target = _content_tokens(re.sub(r"\[Evidence[^\]]*\]", "", hint))
    if not sentences or not target:
        return snippet(content, limit)
    best, best_score = "", -1.0
    for start in range(len(sentences)):
        window = ""
        for sentence in sentences[start:]:
            candidate = f"{window} {sentence}".strip()
            if len(candidate) > limit and window:
                break
            window = candidate
        score = len(target & _content_tokens(window)) / len(target)
        if score > best_score:
            best, best_score = window, score
    return best if len(best) <= limit else best[: limit - 1].rsplit(" ", 1)[0] + "…"


def _default_block_chars() -> int:
    # A chunk body is up to CHUNK_MAX_CHARS plus the sentence overlap (and a
    # carried short section). Verification checks the FULL chunk, so the model
    # must see the full chunk too; the old 1800 cut hid up to ~20 % of it.
    from .chunking import CHUNK_MAX_CHARS, CHUNK_OVERLAP_CHARS

    return CHUNK_MAX_CHARS + CHUNK_OVERLAP_CHARS + 500


class EvidencePack:
    def __init__(self, chunks: Iterable[dict], max_chars_per_block: Optional[int] = None):
        self.blocks: List[dict] = []
        seen = set()
        for chunk in chunks:
            chunk_id = chunk.get("id") or chunk.get("chunk_id")
            if not chunk_id or chunk_id in seen:
                continue
            seen.add(chunk_id)
            self.blocks.append(chunk)
        self.max_chars = max_chars_per_block or _default_block_chars()

    def __len__(self) -> int:
        return len(self.blocks)

    def __bool__(self) -> bool:
        return bool(self.blocks)

    def block(self, number: Optional[int]) -> Optional[dict]:
        if number is None or number < 1 or number > len(self.blocks):
            return None
        return self.blocks[number - 1]

    def format(self) -> str:
        parts = []
        for number, chunk in enumerate(self.blocks, 1):
            meta = chunk.get("metadata") or {}
            section = meta.get("section_path") or meta.get("section") or chunk.get("section") or ""
            section_type = meta.get("section_type") or chunk.get("sectionType") or ""
            body = _body(chunk.get("content", ""))
            if len(body) > self.max_chars:
                body = body[: self.max_chars].rsplit(" ", 1)[0] + " …"
            parts.append(
                f"[Evidence {number}] paper=\"{chunk.get('documentTitle') or 'Unknown'}\" "
                f"page={chunk.get('pageNumber') or 'n/a'} section=\"{section}\" type={section_type or meta.get('content_type', 'text')}\n"
                f"{body}"
            )
        return "\n\n".join(parts) if parts else "(No evidence retrieved)"

    def citation(self, number: Optional[int], quote: Optional[str] = None, hint: str = "") -> Optional[CitationRef]:
        chunk = self.block(number)
        if not chunk:
            return None
        content = chunk.get("content", "")
        if quote and containment(quote, content) >= 0.6:
            source = quote
        elif hint:
            source = best_window(content, hint)
        else:
            source = snippet(content)
        return CitationRef(
            chunk_id=chunk.get("id") or chunk.get("chunk_id"),
            document_id=chunk.get("documentId", ""),
            document_title=chunk.get("documentTitle", ""),
            page_number=chunk.get("pageNumber"),
            source_text=source,
            relevance=float(chunk.get("score") or chunk.get("rerank_score") or 0.0),
        )

    def citations(self, numbers: Iterable[int]) -> List[CitationRef]:
        out: Dict[str, CitationRef] = {}
        for number in numbers:
            cit = self.citation(number)
            if cit and cit.chunk_id not in out:
                out[cit.chunk_id] = cit
        return list(out.values())

    def numbers_in(self, text: str) -> List[int]:
        found: List[int] = []
        for match in _EVIDENCE_REF.finditer(text or ""):
            for value in match.group(1).split(","):
                number = int(value.strip())
                if self.block(number) and number not in found:
                    found.append(number)
        return found


def renumber_markers(text: str, mapping: Dict[int, int]) -> str:
    """Rewrite '[Evidence 4, 9]' as '[1][2]' using the final citation order."""
    def repl(match: re.Match) -> str:
        nums = [int(v.strip()) for v in match.group(1).split(",")]
        return "".join(f"[{mapping[n]}]" for n in nums if n in mapping)

    return _EVIDENCE_REF.sub(repl, text or "")
