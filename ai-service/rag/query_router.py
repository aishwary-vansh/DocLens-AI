# ai-service/rag/query_router.py
# ─────────────────────────────────────────────────────────────────────────────
# Rule-based query intent routing (no LLM call, ~0 ms).
#
# Research questions usually target one part of a paper: "limitations" live in
# the limitations/discussion sections, "which dataset" lives in experiments.
# The router maps a question to:
#   * section-type boosts added to the reranker score, and
#   * content types to exclude (references are noise unless the user asks
#     about citations / prior work).
# ─────────────────────────────────────────────────────────────────────────────
from __future__ import annotations

import os
import re
from dataclasses import dataclass, field
from typing import Dict, List, Optional

# Added to a sigmoid reranker score in [0, 1]. Off by default: with the real
# BGE reranker a 0.08 boost lowered Recall@5 from 0.812 to 0.750 on the gold
# set (docs/RAG_PIPELINE.md §11). Set ROUTER_SECTION_BOOST to re-enable.
SECTION_BOOST = float(os.getenv("ROUTER_SECTION_BOOST", "0") or 0)


@dataclass
class QueryRoute:
    intents: List[str] = field(default_factory=list)
    section_boosts: Dict[str, float] = field(default_factory=dict)
    exclude_content_types: List[str] = field(default_factory=lambda: ["reference", "front_matter"])
    prefer_profiles: bool = False


_INTENTS: List[tuple[str, re.Pattern, Dict[str, float]]] = [
    (
        "limitations",
        re.compile(r"\b(limitation|weakness|drawback|shortcoming|fail|threats? to validity|caveat|critique|criticism)", re.I),
        {"limitations": 1.0, "discussion": 0.6, "conclusion": 0.4, "future_work": 0.4},
    ),
    (
        "gaps",
        re.compile(r"\b(gap|open (problem|question|challenge)|unexplored|under-?explored|future (work|direction|research)|unsolved|next steps?)", re.I),
        {"future_work": 1.0, "limitations": 0.8, "conclusion": 0.6, "discussion": 0.5},
    ),
    (
        "method",
        re.compile(r"\b(method|approach|architecture|algorithm|model|framework|how (does|do|did)|technique|pipeline|loss|objective|training)", re.I),
        {"method": 1.0, "background": 0.3, "experiments": 0.2},
    ),
    (
        "data",
        re.compile(r"\b(dataset|data set|corpus|benchmark|cohort|participants|sample size|data collection)", re.I),
        {"experiments": 1.0, "method": 0.5, "results": 0.3},
    ),
    (
        "results",
        re.compile(r"\b(result|finding|performance|accuracy|score|outperform|improv|metric|evaluat|effect size|significan)", re.I),
        {"results": 1.0, "experiments": 0.6, "discussion": 0.4, "abstract": 0.3},
    ),
    (
        "contribution",
        re.compile(r"\b(contribution|novel|main idea|propos|what is (this|the) paper about|summar|overview|key idea)", re.I),
        {"abstract": 1.0, "introduction": 0.7, "conclusion": 0.6, "profile": 0.8},
    ),
    (
        "related",
        re.compile(r"\b(related work|prior work|previous work|literature|cite[sd]?|citation|reference|builds? on)", re.I),
        {"related_work": 1.0, "introduction": 0.4, "references": 0.5},
    ),
    (
        "conclusion",
        re.compile(r"\b(conclu|takeaway|implication)", re.I),
        {"conclusion": 1.0, "discussion": 0.6, "abstract": 0.3},
    ),
]

_CROSS_PAPER = re.compile(r"\b(compare|comparison|versus|vs\.?|differ|across (the )?papers|each paper|all papers|common|trend)", re.I)


def route_query(question: str) -> QueryRoute:
    route = QueryRoute()
    for name, pattern, boosts in _INTENTS:
        if pattern.search(question or ""):
            # _INTENTS is ordered specific → generic; secondary intents count half
            # so "limitations of these approaches" stays a limitations question.
            scale = 1.0 if not route.intents else 0.5
            route.intents.append(name)
            for section_type, weight in boosts.items():
                route.section_boosts[section_type] = max(route.section_boosts.get(section_type, 0.0), weight * scale)
    if "related" in route.intents:
        route.exclude_content_types = ["front_matter"]
    if _CROSS_PAPER.search(question or "") or "contribution" in route.intents:
        route.prefer_profiles = True
        route.section_boosts["profile"] = max(route.section_boosts.get("profile", 0.0), 0.6)
    return route


def section_boost(route: QueryRoute, metadata: dict, weight: Optional[float] = None) -> float:
    section_type = (metadata or {}).get("section_type") or "other"
    weight = SECTION_BOOST if weight is None else weight
    return weight * route.section_boosts.get(section_type, 0.0)
