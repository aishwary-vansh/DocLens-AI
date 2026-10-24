# ai-service/rag/synthesis.py
# ─────────────────────────────────────────────────────────────────────────────
# Multi-paper research synthesis: comparison, literature review, gap analysis.
#
# All three follow the same map-reduce shape:
#
#   map    : per-paper profile (built at ingest, rebuilt on demand for old
#            documents) — problem, methods, datasets, results, limitations...
#   gather : balanced retrieval — k chunks PER PAPER for each facet query, so
#            no single paper crowds out the others — plus the chunks that
#            ground each profile item.
#   reduce : one structured Gemini call over numbered [Evidence N] blocks.
#   verify : evidence numbers resolve to real chunks; unresolvable items are
#            marked ungrounded instead of being shown as fact.
#
# Without GEMINI_API_KEY every task degrades to a deterministic, extractive
# result built from the profiles, still fully cited.
# ─────────────────────────────────────────────────────────────────────────────
from __future__ import annotations

import logging
import re
from collections import Counter
from typing import Dict, Iterable, List, Optional

from .evidence import EvidencePack, renumber_markers, snippet
from .paper_profile import PROFILE_FIELDS, build_profile, profile_from_metadata
from .llm import SYNTHESIS_LLM_TIMEOUT_S
from .query_router import route_query
from .verification import check_claim, is_content_sentence
from .schemas import (
    CitationRef,
    ComparisonDraft,
    LiteratureReviewDraft,
    PaperMatrixRow,
    PaperProfile,
    ResearchGap,
    ResearchGapResult,
)

logger = logging.getLogger(__name__)

MAX_EVIDENCE_BLOCKS = 48
PROFILE_EVIDENCE_PER_PAPER = 6

REVIEW_SECTIONS: List[tuple[str, str, str]] = [
    ("introduction", "Introduction", "research problem motivation and contributions"),
    ("existingApproaches", "Existing Approaches", "prior work baselines related approaches"),
    ("commonMethodologies", "Common Methodologies", "methods models architectures algorithms training"),
    ("keyFindings", "Key Findings", "results findings performance evaluation"),
    ("limitations", "Limitations", "limitations weaknesses threats to validity"),
    ("researchGaps", "Research Gaps", "open problems unexplored gaps missing evaluation"),
    ("futureDirections", "Future Directions", "future work directions extensions"),
]


# ── Shared helpers ───────────────────────────────────────────────────────────


def _stores():
    from vector_store.pg_store import pg_store

    return pg_store


def load_papers(document_ids: Optional[List[str]], collection_id: Optional[str]) -> List[dict]:
    """Documents with a usable profile; old documents get one built on demand."""
    store = _stores()
    papers = store.get_documents(document_ids=document_ids, collection_id=collection_id)
    for paper in papers:
        profile = profile_from_metadata(paper["metadata"])
        if profile is None:
            chunks = store.get_document_chunks(paper["id"])
            profile, method = build_profile(paper["title"], chunks, paper["metadata"].get("abstract", ""))
            try:
                store.update_document_ingest_metadata(
                    paper["id"], {"profile": profile.model_dump(), "profileMethod": method}
                )
            except Exception as exc:  # caching the profile is an optimisation only
                logger.warning("Could not persist profile for %s: %s", paper["id"], exc)
        paper["profile"] = profile
    return papers


def _profile_evidence_chunks(papers: List[dict], fields: Iterable[str]) -> List[dict]:
    ids: List[str] = []
    for paper in papers:
        picked = 0
        for field_name in fields:
            for point in getattr(paper["profile"], field_name):
                if point.grounded and point.chunk_id and point.chunk_id not in ids:
                    ids.append(point.chunk_id)
                    picked += 1
                if picked >= PROFILE_EVIDENCE_PER_PAPER:
                    break
            if picked >= PROFILE_EVIDENCE_PER_PAPER:
                break
    return _stores().get_chunks_by_ids(ids)


def _grounded(points) -> list:
    """Profile items whose quote/text was found in the cited chunk at ingest.

    Ungrounded items are the LLM's paraphrase with no matching source text;
    they must not reach a synthesis prompt or the comparison matrix as fact."""
    return [p for p in points if p.grounded]


def _retriever(collection_id: Optional[str], document_ids: Optional[List[str]]):
    from .retriever import DocLensRetriever

    return DocLensRetriever.create(collection_id=collection_id, document_ids=document_ids, top_k=10)


def gather_evidence(
    papers: List[dict],
    collection_id: Optional[str],
    queries: List[str],
    per_document: int,
    profile_fields: Iterable[str],
    route_hint: str = "",
    rerank_query: Optional[str] = None,
) -> EvidencePack:
    doc_ids = [p["id"] for p in papers]
    retriever = _retriever(collection_id, doc_ids)
    route = route_query(route_hint) if route_hint else None
    retrieved = retriever.balanced_retrieve(
        queries, doc_ids, per_document=per_document, route=route, rerank_query=rerank_query
    )
    retrieved.sort(key=lambda c: c.get("score", 0.0), reverse=True)

    grounding = _profile_evidence_chunks(papers, profile_fields)
    # Interleave so every paper is represented before the cap applies.
    by_doc: Dict[str, List[dict]] = {}
    for chunk in grounding + retrieved:
        by_doc.setdefault(chunk.get("documentId", ""), []).append(chunk)
    ordered: List[dict] = []
    seen = set()
    while len(ordered) < MAX_EVIDENCE_BLOCKS and any(by_doc.values()):
        for doc_id in list(by_doc):
            if not by_doc[doc_id]:
                continue
            chunk = by_doc[doc_id].pop(0)
            if chunk["id"] in seen:
                continue
            seen.add(chunk["id"])
            ordered.append(chunk)
            if len(ordered) >= MAX_EVIDENCE_BLOCKS:
                break
    return EvidencePack(ordered)


def _profile_card(paper: dict) -> str:
    profile: PaperProfile = paper["profile"]
    lines = [f"### {paper['title']} (document_id={paper['id']})"]
    if profile.research_problem:
        lines.append(f"Problem: {profile.research_problem}")
    for field_name in PROFILE_FIELDS:
        items = [p.text for p in _grounded(getattr(profile, field_name))][:5]
        if items:
            lines.append(f"{field_name.replace('_', ' ').title()}: " + "; ".join(items))
    return "\n".join(lines)


def profile_cards(papers: List[dict]) -> str:
    return "\n\n".join(_profile_card(p) for p in papers)


def _first(points, limit: int = 2) -> str:
    return "; ".join(p.text for p in _grounded(points)[:limit])


def paper_matrix(papers: List[dict]) -> List[PaperMatrixRow]:
    rows = []
    for paper in papers:
        profile: PaperProfile = paper["profile"]
        rows.append(
            PaperMatrixRow(
                document_id=paper["id"],
                title=paper["title"],
                problem=profile.research_problem[:300],
                method=_first(profile.methods),
                datasets=_first(profile.datasets, 3),
                metrics=_first(profile.metrics, 3),
                key_result=_first(profile.key_results),
                limitation=_first(profile.limitations),
            )
        )
    return rows


def _norm_entity(text: str) -> str:
    text = re.split(r"[:(—–-]", text, maxsplit=1)[0]
    return re.sub(r"\s+", " ", text).strip().lower()[:60]


def coverage_report(papers: List[dict]) -> str:
    """Deterministic cross-paper coverage: which datasets/metrics/methods each paper touches.

    Gaps often show up as absence ("every paper evaluates on English data only"),
    which retrieval cannot find. This table makes absence visible to the model.
    """
    lines = []
    total = len(papers)
    for field_name in ("datasets", "metrics", "methods"):
        counts: Counter = Counter()
        for paper in papers:
            names = {_norm_entity(p.text) for p in _grounded(getattr(paper["profile"], field_name))}
            counts.update(n for n in names if n)
        if counts:
            summary = ", ".join(f"{name} ({count}/{total} papers)" for name, count in counts.most_common(12))
            lines.append(f"{field_name.title()}: {summary}")
    no_limits = [p["title"] for p in papers if not _grounded(p["profile"].limitations)]
    if no_limits:
        lines.append("Papers that state no limitations: " + "; ".join(no_limits))
    return "\n".join(lines) or "(no structured coverage available)"


def _cit_dict(c: CitationRef) -> dict:
    return {
        "chunkId": c.chunk_id,
        "documentId": c.document_id,
        "documentTitle": c.document_title,
        "pageNumber": c.page_number,
        "sourceText": c.source_text,
        "relevance": c.relevance,
    }


_SENTENCES = re.compile(r"(?<=[.!?])\s+|\n+")
_NOT_REPORTED = re.compile(r"\b(not reported|no evidence|not (stated|provided|reported|available)|does not (report|state|provide))\b", re.I)


def _sentences(text: str) -> List[str]:
    return [s.strip(" -*•\t") for s in _SENTENCES.split(text or "") if s.strip(" -*•\t")]


class _CitationIndex:
    """Global, first-use ordered citation list so [n] markers match Sources."""

    def __init__(self, pack: EvidencePack):
        self.pack = pack
        self.order: Dict[int, int] = {}
        self.citations: List[CitationRef] = []

    def use(self, numbers: Iterable[int], hints: Optional[Dict[int, str]] = None) -> List[CitationRef]:
        out = []
        for number in numbers:
            if number not in self.order:
                # The hint (the sentences citing this block) picks the passage
                # window shown as the source, instead of the chunk's first lines.
                cit = self.pack.citation(number, hint=(hints or {}).get(number, ""))
                if not cit:
                    continue
                self.citations.append(cit)
                self.order[number] = len(self.citations)
            out.append(self.citations[self.order[number] - 1])
        return out

    def render(self, text: str) -> str:
        hints: Dict[int, List[str]] = {}
        for sentence in _sentences(text):
            for number in self.pack.numbers_in(sentence):
                hints.setdefault(number, []).append(sentence)
        self.use(self.pack.numbers_in(text), {n: " ".join(s) for n, s in hints.items()})
        return renumber_markers(text, self.order)


def _norm_title(title: str) -> str:
    return re.sub(r"\s+", " ", re.sub(r"[^a-z0-9 ]", " ", (title or "").lower())).strip()


class SynthesisVerifier:
    """Checks generated synthesis text against the evidence it cites.

    Runs on the raw draft (still "[Evidence N]") and, per sentence:
      * supported   - the cited blocks contain the sentence's content words and
                      every number it states (rag/verification.check_claim);
      * misattributed - the sentence names a paper by title but cites no block
                      from that paper (and no cited block mentions it);
      * uncited     - a content sentence with no evidence marker at all.
    Lexical, like claim verification in /ask: it catches wrong numbers, wrong
    papers and invented sentences, not subtle paraphrase errors.
    """

    MAX_ISSUES = 25

    def __init__(self, pack: EvidencePack, papers: List[dict]):
        self.pack = pack
        self.titles = {p["id"]: p.get("title") or "" for p in papers}
        self.totals: Counter = Counter()
        self.issues: List[dict] = []

    def _mentioned(self, sentence: str) -> List[str]:
        low = _norm_title(sentence)
        found = []
        for doc_id, title in self.titles.items():
            full = _norm_title(title)
            short = _norm_title(title.split(":")[0])
            if (full and full in low) or (len(short.split()) >= 3 and short in low):
                found.append(doc_id)
        return found

    def _issue(self, where: str, sentence: str, problem: str) -> None:
        if len(self.issues) < self.MAX_ISSUES:
            self.issues.append({"where": where, "text": sentence[:300], "problem": problem})

    def check(self, text: str, where: str) -> dict:
        local: Counter = Counter()
        for sentence in _sentences(text):
            numbers = self.pack.numbers_in(sentence)
            if not numbers:
                if is_content_sentence(sentence) and not _NOT_REPORTED.search(sentence):
                    local["uncited"] += 1
                continue
            local["checked"] += 1
            blocks = [self.pack.block(n) for n in numbers]
            evidence = "\n".join(b.get("content", "") for b in blocks)
            ok, reason = check_claim(re.sub(r"\[Evidence[^\]]*\]", "", sentence), evidence)
            if ok:
                local["supported"] += 1
            else:
                local["unsupported"] += 1
                self._issue(where, sentence, "states numbers not in the cited passages" if reason == "numbers"
                            else "not matched by the cited passages")
            cited_docs = {b.get("documentId") for b in blocks}
            missing = [
                d for d in self._mentioned(sentence)
                if d not in cited_docs and not any(_norm_title(self.titles[d]) in _norm_title(b.get("content", "")) for b in blocks)
            ]
            if missing:
                local["misattributed"] += 1
                self._issue(where, sentence, "names " + "; ".join(f'"{self.titles[d]}"' for d in missing)
                            + " but cites no passage from it")
        self.totals.update(local)
        return {k: local.get(k, 0) for k in ("checked", "supported", "unsupported", "misattributed", "uncited")}

    def summary(self) -> dict:
        out = {k: self.totals.get(k, 0) for k in ("checked", "supported", "unsupported", "misattributed", "uncited")}
        out["issues"] = self.issues
        return out

    def note(self) -> str:
        s = self.summary()
        if not s["checked"]:
            return "Verification: no cited sentences to check."
        return (
            f"Verification (lexical): {s['supported']} of {s['checked']} cited sentences matched their sources; "
            f"{s['unsupported']} did not, {s['misattributed']} may cite the wrong paper, "
            f"{s['uncited']} content sentences carry no citation."
        )


def _llm_ready() -> bool:
    from .llm import llm_available

    return llm_available()


# ── Research gap analysis ────────────────────────────────────────────────────

_GAP_SYSTEM = """You are a senior researcher performing a systematic research-gap analysis across a set of papers.
You receive (1) a structured card per paper, (2) a cross-paper coverage report, (3) numbered evidence blocks.

Identify gaps that are SUPPORTED by the evidence, of these kinds:
- stated: limitations / future work the authors themselves report
- recurring: the same weakness or open question across several papers
- coverage: datasets, populations, languages, settings, metrics or baselines nobody (or only one paper) evaluates
- methodological: untested assumptions, missing ablations, weak evaluation designs
- contradiction: papers reporting conflicting results or claims (also list them in `contradictions`)
Rules:
- Every gap MUST list evidence_numbers of the blocks that motivate it. No evidence → do not include the gap.
- Distinguish what authors state from what you infer; say "inferred" in the rationale when inferring from absence.
- Make suggested_research_questions specific and testable. Rank gaps by importance (most important first).
- confidence: 0.8+ only when several papers or explicit author statements support the gap."""


def research_gaps(
    collection_id: Optional[str],
    document_ids: Optional[List[str]],
    topic: Optional[str] = None,
    max_gaps: int = 8,
) -> dict:
    papers = load_papers(document_ids, collection_id)
    if not papers:
        return {"summary": "No indexed papers were found for gap analysis.", "gaps": [], "insufficientEvidence": True}

    topic_prefix = f"{topic} " if topic else ""
    queries = [
        f"{topic_prefix}limitations and weaknesses of the approach",
        f"{topic_prefix}future work open problems remaining challenges",
        f"{topic_prefix}assumptions evaluation setting datasets not covered",
    ]
    pack = gather_evidence(
        papers,
        collection_id,
        queries,
        per_document=2,
        profile_fields=("limitations", "future_work", "assumptions", "datasets", "key_results"),
        route_hint="limitations gaps future work",
        rerank_query=f"{topic_prefix}limitations, open problems and future work",
    )
    coverage = coverage_report(papers)

    result: Optional[ResearchGapResult] = None
    method = "extractive"
    if _llm_ready() and pack:
        from .llm import invoke_structured

        human = (
            f"Focus topic: {topic or 'the shared research area of these papers'}\n\n"
            f"Paper cards:\n{profile_cards(papers)}\n\n"
            f"Coverage report:\n{coverage}\n\n"
            f"Evidence:\n{pack.format()}\n\n"
            f"Return at most {max_gaps} gaps."
        )
        try:
            result = invoke_structured(ResearchGapResult, _GAP_SYSTEM, human, timeout=SYNTHESIS_LLM_TIMEOUT_S)
            method = "llm"
        except Exception as exc:
            logger.warning("LLM gap analysis failed, using extractive gaps: %s", exc)
    if result is None:
        result = _heuristic_gaps(papers, pack)

    index = _CitationIndex(pack)
    verifier = SynthesisVerifier(pack, papers)
    verifier.check(result.summary, "summary")
    for i, item in enumerate(result.consensus):
        verifier.check(item, f"consensus[{i}]")
    gaps_out = []
    support: Dict[int, str] = {}
    for gap in result.gaps[:max_gaps]:
        numbers = gap.evidence_numbers or pack.numbers_in(gap.rationale)
        hint = f"{gap.description} {gap.rationale}"
        evidence = index.use(numbers, {n: hint for n in numbers})
        gap.evidence = evidence
        gap.related_document_ids = sorted({c.document_id for c in evidence})
        gap.grounded = bool(evidence)
        if not gap.grounded:
            gap.confidence = min(gap.confidence, 0.3)
        # "stated": a cited sentence of the gap is found in its sources (authors say it);
        # "inferred": cited but argued from the evidence (e.g. from absence) - a hypothesis.
        checked = verifier.check(f"{gap.description}\n{gap.rationale}", f"gap: {gap.title}")
        cited_text = "\n".join(pack.block(n).get("content", "") for n in numbers if pack.block(n))
        stated = checked["supported"] > 0 or (
            bool(cited_text) and check_claim(re.sub(r"\[Evidence[^\]]*\]", "", gap.description), cited_text)[0]
        )
        support[id(gap)] = "ungrounded" if not gap.grounded else ("stated" if stated else "inferred")
        if support[id(gap)] == "inferred":
            gap.confidence = min(gap.confidence, 0.7)
        gaps_out.append(gap)
    gaps_out.sort(key=lambda g: (not g.grounded, -g.confidence))

    titles = {p["id"]: p["title"] for p in papers}
    contradictions = []
    for item in result.contradictions:
        positions = []
        for pos in item.positions:
            block = pack.block(pos.evidence_number) if pos.evidence_number else None
            cit = index.use([pos.evidence_number], {pos.evidence_number: pos.stance})[0] if block else None
            claimed = _norm_title(pos.paper_title)
            positions.append(
                {
                    "paperTitle": cit.document_title if cit else pos.paper_title,
                    "documentId": cit.document_id if cit else None,
                    "stance": index.render(pos.stance),
                    "citation": _cit_dict(cit) if cit else None,
                    # The stance must be in its passage, and the passage must come from the paper it is attributed to.
                    "verified": bool(block) and check_claim(re.sub(r"\[Evidence[^\]]*\]", "", pos.stance), block.get("content", ""))[0],
                    "attributionMismatch": bool(cit and claimed and claimed not in _norm_title(cit.document_title)
                                                and _norm_title(cit.document_title) not in claimed),
                }
            )
        contradictions.append({"topic": item.topic, "positions": positions, "possibleExplanation": item.possible_explanation})

    return {
        "topic": topic,
        "summary": index.render(result.summary),
        "consensus": [index.render(c) for c in result.consensus],
        "contradictions": contradictions,
        "gaps": [
            {
                "title": g.title,
                "gapType": g.gap_type,
                "description": index.render(g.description),
                "rationale": index.render(g.rationale),
                "suggestedResearchQuestions": g.suggested_research_questions,
                "suggestedApproach": g.suggested_approach,
                "confidence": round(g.confidence, 2),
                "grounded": g.grounded,
                "support": support[id(g)],
                "relatedDocuments": [{"documentId": d, "title": titles.get(d, "")} for d in g.related_document_ids],
                "citations": [_cit_dict(c) for c in g.evidence],
            }
            for g in gaps_out
        ],
        "coverage": coverage,
        "paperMatrix": [row.model_dump() for row in paper_matrix(papers)],
        "citations": [_cit_dict(c) for c in index.citations],
        "documentIds": [p["id"] for p in papers],
        "method": method,
        "verification": verifier.summary(),
        "insufficientEvidence": result.insufficient_evidence or not gaps_out,
    }


def _heuristic_gaps(papers: List[dict], pack: EvidencePack) -> ResearchGapResult:
    """Author-stated limitations and future work become cited gap candidates."""
    number_by_chunk = {block["id"]: n for n, block in enumerate(pack.blocks, 1)}
    gaps: List[ResearchGap] = []
    for field_name, gap_type in (("future_work", "stated"), ("limitations", "methodological")):
        for paper in papers:
            for point in _grounded(getattr(paper["profile"], field_name))[:2]:
                number = number_by_chunk.get(point.chunk_id or "")
                gaps.append(
                    ResearchGap(
                        title=snippet(point.text, 90),
                        gap_type=gap_type,
                        description=point.text,
                        rationale=f"Stated by the authors of \"{paper['title']}\" ({field_name.replace('_', ' ')}).",
                        evidence_numbers=[number] if number else [],
                        confidence=0.5,
                    )
                )
    covered = Counter()
    for paper in papers:
        covered.update({_norm_entity(p.text) for p in _grounded(paper["profile"].datasets)})
    single = [name for name, count in covered.items() if count == 1 and name]
    summary = (
        f"Extractive gap analysis over {len(papers)} papers based on author-stated limitations and future work."
        + (f" Datasets used by only one paper: {', '.join(single[:6])}." if single and len(papers) > 1 else "")
    )
    return ResearchGapResult(summary=summary, gaps=gaps, insufficient_evidence=not gaps)


# ── Literature review ────────────────────────────────────────────────────────

_REVIEW_SYSTEM = """You are an expert academic writer producing a thematic literature review of the given papers.
Write a SYNTHESIS, not a paper-by-paper summary: group papers by theme, contrast approaches, note agreement
and disagreement, and point out what remains unresolved.
Rules:
- Use ONLY the paper cards and evidence blocks. Cite every factual sentence inline as [Evidence N]
  (several: [Evidence 2, 7]).
- Produce exactly these section keys, in order: introduction, existingApproaches, commonMethodologies,
  keyFindings, limitations, researchGaps, futureDirections. 1-3 dense paragraphs each.
- Keep numbers and metric names exactly as in the evidence. Name papers by title when contrasting them.
- If evidence for a section is missing, say so briefly instead of inventing content."""


def literature_review(
    collection_id: Optional[str],
    document_ids: Optional[List[str]],
    topic: Optional[str],
) -> dict:
    user_topic = (topic or "").strip()
    topic = user_topic or "Comprehensive literature review"
    papers = load_papers(document_ids, collection_id)
    title = f"Literature Review: {topic}"
    if not papers:
        return {"title": title, "topic": topic, "sections": {}, "markdown": "No indexed papers were found.", "citations": [], "insufficient_evidence": True}

    # The placeholder topic is not a search term; prefixing it to every query
    # made all seven queries match the words "literature review".
    queries = [f"{user_topic} {focus}".strip() for _, _, focus in REVIEW_SECTIONS]
    per_document = 1 if len(papers) > 4 else 2
    pack = gather_evidence(papers, collection_id, queries, per_document=per_document, profile_fields=PROFILE_FIELDS,
                           rerank_query=user_topic or None)
    matrix = paper_matrix(papers)

    draft: Optional[LiteratureReviewDraft] = None
    method = "extractive"
    if _llm_ready() and pack:
        from .llm import invoke_structured

        human = (
            f"Topic: {topic}\n\nPaper cards:\n{profile_cards(papers)}\n\n"
            f"Cross-paper coverage:\n{coverage_report(papers)}\n\nEvidence:\n{pack.format()}"
        )
        try:
            draft = invoke_structured(LiteratureReviewDraft, _REVIEW_SYSTEM, human, timeout=SYNTHESIS_LLM_TIMEOUT_S)
            method = "llm"
        except Exception as exc:
            logger.warning("LLM literature review failed, using extractive review: %s", exc)
    if draft is None:
        draft = _heuristic_review(papers, pack, topic)

    index = _CitationIndex(pack)
    verifier = SynthesisVerifier(pack, papers)
    by_key = {s.key: s for s in draft.sections}
    sections: Dict[str, dict] = {}
    for key, heading, _ in REVIEW_SECTIONS:
        section = by_key.get(key)
        if not section:
            sections[key] = {"heading": heading, "content": "The selected papers do not provide evidence for this section.", "citations": []}
            continue
        numbers = pack.numbers_in(section.content) + [n for n in section.evidence_numbers if pack.block(n)]
        checked = verifier.check(section.content, key)
        content = index.render(section.content)
        cits = index.use(dict.fromkeys(numbers))
        sections[key] = {"heading": section.heading or heading, "content": content, "citations": [_cit_dict(c) for c in cits],
                         "verification": checked}

    markdown = _review_markdown(draft.title or title, topic, sections, matrix, index.citations, verifier.note())
    return {
        "title": draft.title or title,
        "topic": topic,
        "sections": sections,
        "themes": draft.themes,
        "paperMatrix": [row.model_dump() for row in matrix],
        "markdown": markdown,
        "citations": [_cit_dict(c) for c in index.citations],
        "method": method,
        "verification": verifier.summary(),
        "insufficient_evidence": draft.insufficient_evidence,
    }


def _heuristic_review(papers: List[dict], pack: EvidencePack, topic: str) -> LiteratureReviewDraft:
    from .schemas import ReviewSectionDraft

    number_by_chunk = {block["id"]: n for n, block in enumerate(pack.blocks, 1)}
    field_for = {
        "introduction": "contributions",
        "existingApproaches": "baselines",
        "commonMethodologies": "methods",
        "keyFindings": "key_results",
        "limitations": "limitations",
        "researchGaps": "assumptions",
        "futureDirections": "future_work",
    }
    sections = []
    for key, heading, _ in REVIEW_SECTIONS:
        sentences = []
        for paper in papers:
            for point in _grounded(getattr(paper["profile"], field_for[key]))[:2]:
                number = number_by_chunk.get(point.chunk_id or "")
                marker = f" [Evidence {number}]" if number else ""
                sentences.append(f"{paper['title']}: {point.text}{marker}")
        if sentences:
            sections.append(ReviewSectionDraft(key=key, heading=heading, content="\n".join(f"- {s}" for s in sentences)))
    return LiteratureReviewDraft(title=f"Literature Review: {topic}", sections=sections, insufficient_evidence=not sections)


def _md_cell(value: str) -> str:
    return (value or "—").replace("|", "/").replace("\n", " ")[:180]


def _review_markdown(title: str, topic: str, sections: Dict[str, dict], matrix: List[PaperMatrixRow],
                     citations: List[CitationRef], verification_note: str = "") -> str:
    lines = [f"# {title}", "", f"Topic: {topic}", ""]
    if verification_note:
        lines += [f"> {verification_note}", ""]
    for key, _, _ in REVIEW_SECTIONS:
        section = sections.get(key)
        if section:
            lines += [f"## {section['heading']}", "", section["content"], ""]
    if matrix:
        lines += ["## Paper Comparison Matrix", "", "| Paper | Method | Datasets | Key result | Limitation |", "| --- | --- | --- | --- | --- |"]
        for row in matrix:
            lines.append(f"| {_md_cell(row.title)} | {_md_cell(row.method)} | {_md_cell(row.datasets)} | {_md_cell(row.key_result)} | {_md_cell(row.limitation)} |")
        lines.append("")
    if citations:
        lines += ["## Sources", ""]
        for i, c in enumerate(citations, 1):
            lines.append(f"{i}. {c.document_title}, page {c.page_number or 'n/a'}: \"{snippet(c.source_text, 200)}\"")
    return "\n".join(lines)


# ── Paper comparison ─────────────────────────────────────────────────────────

_COMPARE_SYSTEM = """You are a rigorous researcher comparing scientific papers side by side.
Use ONLY the paper cards and evidence. Cite facts inline as [Evidence N].
For methods/datasets/strengths/weaknesses/findings/future_work, write one entry per paper,
prefixed with the paper title ("<title>: ..."). List genuine agreements and disagreements.
If a paper has no evidence for an aspect, write "<title>: not reported"."""


def compare_papers(document_ids: List[str], collection_id: Optional[str], question: Optional[str]) -> dict:
    question = question or "Compare the main findings, methodologies, and conclusions."
    papers = load_papers(document_ids, collection_id)
    if len(papers) < 2:
        return {"answer": "At least two indexed papers are needed for comparison.", "narrative": "", "citations": [], "insufficient_evidence": True}

    queries = [question, "proposed method and experimental setup", "main results and limitations"]
    pack = gather_evidence(papers, collection_id, queries, per_document=2, profile_fields=PROFILE_FIELDS, route_hint=question,
                           rerank_query=question)
    matrix = paper_matrix(papers)

    draft: Optional[ComparisonDraft] = None
    method = "extractive"
    if _llm_ready() and pack:
        from .llm import invoke_structured

        human = f"Comparison focus: {question}\n\nPaper cards:\n{profile_cards(papers)}\n\nEvidence:\n{pack.format()}"
        try:
            draft = invoke_structured(ComparisonDraft, _COMPARE_SYSTEM, human, timeout=SYNTHESIS_LLM_TIMEOUT_S)
            method = "llm"
        except Exception as exc:
            logger.warning("LLM comparison failed, using matrix comparison: %s", exc)
    if draft is None:
        draft = ComparisonDraft(
            narrative=f"Structured comparison of {len(papers)} papers built from their extracted paper profiles.",
            methods=[f"{r.title}: {r.method or 'not reported'}" for r in matrix],
            datasets=[f"{r.title}: {r.datasets or 'not reported'}" for r in matrix],
            findings=[f"{r.title}: {r.key_result or 'not reported'}" for r in matrix],
            weaknesses=[f"{r.title}: {r.limitation or 'not reported'}" for r in matrix],
            future_work=[f"{p['title']}: {_first(p['profile'].future_work) or 'not reported'}" for p in papers],
        )

    index = _CitationIndex(pack)
    verifier = SynthesisVerifier(pack, papers)
    verifier.check(draft.narrative, "narrative")
    for field_name in ("methods", "datasets", "strengths", "weaknesses", "findings", "future_work", "agreements", "disagreements"):
        for item in getattr(draft, field_name):
            verifier.check(item, field_name)
    render_list = lambda items: [index.render(i) for i in items]  # noqa: E731
    narrative = index.render(draft.narrative)
    out = {
        "answer": narrative,
        "narrative": narrative,
        "methods": render_list(draft.methods),
        "datasets": render_list(draft.datasets),
        "strengths": render_list(draft.strengths),
        "weaknesses": render_list(draft.weaknesses),
        "findings": render_list(draft.findings),
        "futureWork": render_list(draft.future_work),
        "agreements": render_list(draft.agreements),
        "disagreements": render_list(draft.disagreements),
        "paperMatrix": [row.model_dump() for row in matrix],
        "method": method,
        "verification": verifier.summary(),
        "insufficient_evidence": draft.insufficient_evidence,
    }
    index.use(n for n in draft.evidence_numbers if pack.block(n))
    out["citations"] = [_cit_dict(c) for c in index.citations]
    return out


# ── Single-paper summary ─────────────────────────────────────────────────────


def paper_summary(document_id: str) -> dict:
    papers = load_papers([document_id], None)
    if not papers:
        return {"summary": "Document not found.", "profile": None, "citations": []}
    paper = papers[0]
    profile: PaperProfile = paper["profile"]
    chunk_ids = [p.chunk_id for f in PROFILE_FIELDS for p in getattr(profile, f) if p.grounded and p.chunk_id]
    pack = EvidencePack(_stores().get_chunks_by_ids(list(dict.fromkeys(chunk_ids))))
    number_by_chunk = {block["id"]: n for n, block in enumerate(pack.blocks, 1)}
    index = _CitationIndex(pack)

    def cited(points, limit=3):
        out = []
        for p in points[:limit]:
            n = number_by_chunk.get(p.chunk_id or "")
            out.append(index.render(f"{p.text} [Evidence {n}]" if n else p.text))
        return out

    parts = [f"**{paper['title']}**"]
    if profile.research_problem:
        parts.append(f"Problem: {profile.research_problem}")
    for label, field_name in (
        ("Contributions", "contributions"),
        ("Methods", "methods"),
        ("Datasets", "datasets"),
        ("Key results", "key_results"),
        ("Limitations", "limitations"),
        ("Future work", "future_work"),
    ):
        items = cited(_grounded(getattr(profile, field_name)))
        if items:
            parts.append(f"{label}:\n" + "\n".join(f"- {i}" for i in items))
    return {
        "document_id": document_id,
        "summary": "\n\n".join(parts),
        "profile": profile.model_dump(),
        "outline": paper["metadata"].get("outline", []),
        "abstract": paper["metadata"].get("abstract", ""),
        "citations": [_cit_dict(c) for c in index.citations],
    }
