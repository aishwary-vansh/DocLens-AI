# ai-service/rag/paper_profile.py
# ─────────────────────────────────────────────────────────────────────────────
# Paper profile = the "map" step of DocLens' map-reduce synthesis.
#
# At ingest, each paper is read once (section-prioritised evidence, not the
# whole PDF) and turned into a structured, evidence-linked research card:
# problem, contributions, methods, datasets, metrics, results, baselines,
# limitations, assumptions, future work.
#
# The card is stored in Document.metadata.profile and also persisted as a
# retrievable "paper_profile" chunk. Comparison, literature review and gap
# analysis start from these cards instead of re-reading every paper.
#
# Without GEMINI_API_KEY a deterministic extractive profile is built from
# cue sentences ("we propose", "limitation", "future work", ...), so the
# pipeline still produces useful structure offline.
# ─────────────────────────────────────────────────────────────────────────────
from __future__ import annotations

import logging
import os
import re
import uuid
from typing import Dict, List, Optional

from .chunking import split_sentences
from .evidence import EvidencePack, snippet
from .schemas import EvidencedPoint, PaperProfile
from .verification import containment

logger = logging.getLogger(__name__)

PROFILE_CONTEXT_CHARS = int(os.getenv("PROFILE_CONTEXT_CHARS", "28000"))
PAPER_PROFILE_ENABLED = os.getenv("PAPER_PROFILE_ENABLED", "true").lower() != "false"

PROFILE_FIELDS = (
    "contributions",
    "methods",
    "datasets",
    "metrics",
    "key_results",
    "baselines",
    "limitations",
    "assumptions",
    "future_work",
)

# How many chunks of each section type to show the model, in priority order.
_SECTION_BUDGET: List[tuple[str, int]] = [
    ("abstract", 2),
    ("introduction", 3),
    ("method", 4),
    ("experiments", 3),
    ("results", 4),
    ("limitations", 3),
    ("discussion", 2),
    ("conclusion", 2),
    ("future_work", 2),
    ("related_work", 1),
    ("background", 1),
]


def select_profile_evidence(chunks: List[dict], budget_chars: int = PROFILE_CONTEXT_CHARS) -> List[dict]:
    """Pick the most informative chunks per section type within a char budget."""
    by_type: Dict[str, List[dict]] = {}
    for chunk in chunks:
        meta = chunk.get("metadata") or {}
        if meta.get("content_type") in {"reference", "paper_profile", "front_matter"}:
            continue
        section_type = meta.get("section_type") or "other"
        if meta.get("content_type") == "table":
            section_type = "results"
        by_type.setdefault(section_type, []).append(chunk)

    picked: List[dict] = []
    used = 0
    for section_type, limit in _SECTION_BUDGET:
        for chunk in by_type.get(section_type, [])[:limit]:
            size = len(chunk.get("content", ""))
            if used + size > budget_chars:
                continue
            picked.append(chunk)
            used += size
    if len(picked) < 4:  # unstructured PDF: fall back to document order
        for chunk in chunks:
            if chunk in picked or (chunk.get("metadata") or {}).get("content_type") == "reference":
                continue
            if used + len(chunk.get("content", "")) > budget_chars:
                break
            picked.append(chunk)
            used += len(chunk.get("content", ""))
    order = {id(c): i for i, c in enumerate(chunks)}
    return sorted(picked, key=lambda c: order.get(id(c), 0))


_PROFILE_SYSTEM = """You are a meticulous research analyst building a structured card for ONE research paper.
Use ONLY the evidence blocks. Every list item must set evidence_number to the block that states it
and quote a short verbatim excerpt (<= 30 words) from that block.
- limitations / future_work: only what the AUTHORS state (or what is explicitly evident, e.g. single dataset).
- assumptions: explicit assumptions or ones the method clearly requires.
- key_results: keep numbers, metrics and units exactly as written.
- datasets / metrics / baselines: one item per named entity.
Prefer 2-6 precise items per field over long vague ones. Leave a field empty if the evidence is silent."""


def _ground(profile: PaperProfile, pack: EvidencePack) -> PaperProfile:
    """Resolve evidence numbers to chunk ids and mark items whose quote is really in the chunk."""
    for field_name in PROFILE_FIELDS:
        grounded: List[EvidencedPoint] = []
        for point in getattr(profile, field_name):
            block = pack.block(point.evidence_number)
            if block is not None:
                point.chunk_id = block["id"]
                point.page_number = block.get("pageNumber")
                probe = point.quote or point.text
                point.grounded = containment(probe, block.get("content", "")) >= (0.6 if point.quote else 0.4)
                if point.quote and not point.grounded and containment(point.text, block.get("content", "")) >= 0.4:
                    point.grounded, point.quote = True, None
            else:
                point.chunk_id, point.grounded = None, False
            grounded.append(point)
        setattr(profile, field_name, grounded)
    return profile


def extract_profile_llm(title: str, chunks: List[dict]) -> PaperProfile:
    from .llm import invoke_structured

    evidence = select_profile_evidence(chunks)
    pack = EvidencePack([{**c, "documentTitle": title} for c in evidence])
    human = f"Paper title: {title}\n\nEvidence:\n{pack.format()}\n\nBuild the paper card."
    profile = invoke_structured(PaperProfile, _PROFILE_SYSTEM, human)
    return _ground(profile, pack)


# ── Extractive fallback (no LLM) ─────────────────────────────────────────────

_CUES: Dict[str, re.Pattern] = {
    "contributions": re.compile(r"\b(we (propose|present|introduce|develop|contribute)|our (main )?contributions?|this (paper|work) (proposes|presents|introduces))\b", re.I),
    "methods": re.compile(r"\b(we (use|employ|adopt|train|fine-tune|apply)|our (method|model|approach|framework)|is based on|architecture)\b", re.I),
    "datasets": re.compile(r"\b(dataset|corpus|benchmark|cohort|participants|samples were)\b", re.I),
    "metrics": re.compile(r"\b(accuracy|f1|precision|recall|bleu|rouge|auc|mrr|ndcg|rmse|mae|perplexity|p-value)\b", re.I),
    "key_results": re.compile(r"\b(outperform|achiev|improv|reach|significant|state[- ]of[- ]the[- ]art|\d+(\.\d+)?\s?%)", re.I),
    "baselines": re.compile(r"\b(baselines?|compared (to|with|against))\b", re.I),
    "limitations": re.compile(r"\b(limitation|limited to|does not|do not|cannot|fails? to|only|restricted|drawback|weakness)\b", re.I),
    "assumptions": re.compile(r"\b(assum|we suppose|is assumed|under the hypothesis)\w*", re.I),
    "future_work": re.compile(r"\b(future work|in the future|future research|we plan|we leave|open question|remains? (an )?open|further (work|research|investigation))\b", re.I),
}

_FIELD_SECTIONS: Dict[str, set] = {
    "contributions": {"abstract", "introduction", "conclusion"},
    "methods": {"method", "abstract", "experiments"},
    "datasets": {"experiments", "method", "results", "abstract"},
    "metrics": {"experiments", "results"},
    "key_results": {"results", "abstract", "conclusion", "discussion"},
    "baselines": {"experiments", "results"},
    "limitations": {"limitations", "discussion", "conclusion", "future_work"},
    "assumptions": {"method", "background", "limitations"},
    "future_work": {"future_work", "conclusion", "discussion", "limitations"},
}


_HOME_SECTION = {"limitations": "limitations", "future_work": "future_work", "methods": "method", "key_results": "results"}


def extract_profile_heuristic(title: str, chunks: List[dict], abstract: str = "") -> PaperProfile:
    profile = PaperProfile()
    if abstract:
        first = split_sentences(abstract)[:2]
        profile.research_problem = " ".join(first)[:500]
    for field_name in PROFILE_FIELDS:
        items: List[EvidencedPoint] = []
        allowed = _FIELD_SECTIONS[field_name]
        for chunk in chunks:
            meta = chunk.get("metadata") or {}
            if meta.get("content_type") in {"reference", "paper_profile", "front_matter"}:
                continue
            section_type = meta.get("section_type") or "other"
            if section_type not in allowed and meta.get("content_type") != "table":
                continue
            # Inside the field's own section (e.g. "Limitations") take several
            # sentences; elsewhere one cue sentence per chunk keeps the card diverse.
            home = section_type == _HOME_SECTION.get(field_name)
            taken = 0
            for sentence in split_sentences(snippet(chunk.get("content", ""), 100_000)):
                if 25 <= len(sentence) <= 400 and _CUES[field_name].search(sentence):
                    items.append(
                        EvidencedPoint(
                            text=sentence,
                            quote=sentence,
                            chunk_id=chunk["id"],
                            page_number=chunk.get("pageNumber"),
                            grounded=True,
                        )
                    )
                    taken += 1
                    if taken >= (3 if home else 1):
                        break
            if len(items) >= 4:
                break
        setattr(profile, field_name, items)
    return profile


def build_profile(title: str, chunks: List[dict], abstract: str = "") -> tuple[PaperProfile, str]:
    """Return (profile, method). Never raises: ingestion must not fail on profiling."""
    from .llm import llm_available

    if PAPER_PROFILE_ENABLED and llm_available():
        try:
            return extract_profile_llm(title, chunks), "llm"
        except Exception as exc:
            logger.warning("LLM paper profile failed, using extractive profile: %s", exc)
    return extract_profile_heuristic(title, chunks, abstract), "extractive"


# ── Persistence helpers ──────────────────────────────────────────────────────


def profile_to_text(title: str, profile: PaperProfile) -> str:
    lines = [f"Paper: {title}", "Section: Paper profile (structured summary)", ""]
    if profile.research_problem:
        lines.append(f"Research problem: {profile.research_problem}")
    if profile.paper_type:
        lines.append(f"Paper type: {profile.paper_type}")
    if profile.domain:
        lines.append(f"Domain: {profile.domain}")
    labels = {
        "contributions": "Contributions",
        "methods": "Methods",
        "datasets": "Datasets",
        "metrics": "Metrics",
        "key_results": "Key results",
        "baselines": "Baselines",
        "limitations": "Limitations",
        "assumptions": "Assumptions",
        "future_work": "Future work",
    }
    for field_name, label in labels.items():
        items = [p.text for p in getattr(profile, field_name)]
        if items:
            lines.append(f"{label}: " + "; ".join(items))
    if profile.keywords:
        lines.append("Keywords: " + ", ".join(profile.keywords))
    return "\n".join(lines)


def profile_chunk(title: str, profile: PaperProfile) -> Optional[dict]:
    text = profile_to_text(title, profile)
    if len(text.splitlines()) <= 3:
        return None
    return {
        "id": str(uuid.uuid4()),
        "content": text,
        "pageNumber": None,
        "metadata": {
            "extractor": "paper-profile",
            "content_type": "paper_profile",
            "section": "Paper profile",
            "section_type": "profile",
        },
    }


def profile_from_metadata(metadata: dict) -> Optional[PaperProfile]:
    raw = (metadata or {}).get("profile")
    if not raw:
        return None
    try:
        return PaperProfile.model_validate(raw)
    except Exception:
        return None
