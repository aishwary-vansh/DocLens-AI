# ai-service/rag/verification.py
# ─────────────────────────────────────────────────────────────────────────────
# Claim-level verification: for each claim, check that at least one of its
# citations actually contains text that supports the claim.
#
# POLICY: NO EVIDENCE = NO CLAIM
#   Any claim where verified=False should be removed from the final answer
#   or flagged with a clear disclaimer.
# ─────────────────────────────────────────────────────────────────────────────
from __future__ import annotations

import logging
import re
from typing import List, Tuple

from .schemas import Claim, CitationRef

logger = logging.getLogger(__name__)


# ── Token overlap helper ──────────────────────────────────────────────────────

def _tokenize(text: str) -> set[str]:
    """Simple word-level tokenisation for overlap scoring."""
    return set(re.findall(r'\b\w+\b', text.lower()))


def _token_overlap(a: str, b: str) -> float:
    """Jaccard overlap between two strings' token sets."""
    ta, tb = _tokenize(a), _tokenize(b)
    if not ta or not tb:
        return 0.0
    return len(ta & tb) / len(ta | tb)


_STOPWORDS = {
    "the", "a", "an", "of", "and", "or", "to", "in", "on", "for", "with", "by", "is", "are",
    "was", "were", "be", "been", "this", "that", "these", "those", "it", "its", "as", "at",
    "from", "we", "our", "their", "they", "which", "than", "also", "can", "has", "have",
}


def _content_tokens(text: str) -> set[str]:
    return {t for t in _tokenize(text) if t not in _STOPWORDS}


def containment(part: str, whole: str) -> float:
    """Fraction of `part`'s content tokens that appear in `whole`.

    Jaccard punishes a short quote for being short: a 20-token excerpt of a
    400-token chunk scores 0.05 even when it is verbatim. Containment asks the
    right question for citations: is this text actually in the source?
    """
    tp, tw = _content_tokens(part), _content_tokens(whole)
    if not tp or not tw:
        return 0.0
    return len(tp & tw) / len(tp)


# ── Core verification ─────────────────────────────────────────────────────────

EVIDENCE_OVERLAP_THRESHOLD = 0.15   # min Jaccard to consider a citation supportive
CLAIM_CONTAINMENT_THRESHOLD = 0.45  # min share of claim content tokens found in evidence
MIN_CLAIM_COVERAGE = 3              # min tokens a claim must have to be verifiable
CITATION_SOURCE_CONTAINMENT_THRESHOLD = 0.6


# Numbers are where a fluent answer is most often wrong ("BLEU 28.4" vs the
# paper's 41.0) while still sharing most words with the evidence, so a claim
# must not contain a number its evidence does not.
# Digits glued to a name ("GPT-3", "BERT-2") are part of the name, not a value.
_NUMBER = re.compile(r"(?<![\w.\-])[-+−]?\d[\d,]*(?:\.\d+)?%?")
_NUMBER_WORDS = {
    "zero": "0", "one": "1", "two": "2", "three": "3", "four": "4", "five": "5", "six": "6",
    "seven": "7", "eight": "8", "nine": "9", "ten": "10", "eleven": "11", "twelve": "12",
    "fifteen": "15", "twenty": "20", "hundred": "100", "thousand": "1000",
}


def numbers_in(text: str, words: bool = False) -> set[str]:
    """Normalised numbers in `text` ("1,024" -> "1024", "93.2%" -> "93.2").
    With words=True spelled-out small numbers count too ("eight" -> "8")."""
    found = set()
    for raw in _NUMBER.findall(text or ""):
        value = raw.strip("+-−%,")
        if re.fullmatch(r"\d{1,3}(,\d{3})+(\.\d+)?", value):
            value = value.replace(",", "")
        value = value.split(",")[0]
        if value:
            found.add(value)
    if words:
        found.update(_NUMBER_WORDS[w] for w in re.findall(r"[a-z]+", (text or "").lower()) if w in _NUMBER_WORDS)
    return found


def missing_numbers(claim_text: str, evidence_text: str) -> List[str]:
    """Numbers stated in the claim that the evidence never states."""
    claim_numbers = numbers_in(re.sub(r"\[Evidence[^\]]*\]", "", claim_text or ""))
    if not claim_numbers:
        return []
    return sorted(claim_numbers - numbers_in(evidence_text, words=True))


def check_claim(claim_text: str, evidence_text: str) -> Tuple[bool, str]:
    """(supported, reason). reason is "" when supported, else "numbers" or "content"."""
    if missing_numbers(claim_text, evidence_text):
        return False, "numbers"
    if len(_content_tokens(claim_text)) < MIN_CLAIM_COVERAGE:
        return True, ""
    if containment(claim_text, evidence_text) >= CLAIM_CONTAINMENT_THRESHOLD:
        return True, ""
    return False, "content"


def claim_supported(claim_text: str, evidence_text: str) -> bool:
    """True if the evidence substantively contains the claim's content words and every number it states."""
    return check_claim(claim_text, evidence_text)[0]


def is_content_sentence(sentence: str, min_tokens: int = 6) -> bool:
    """A sentence long enough to carry a factual claim (headings and fragments are not)."""
    return len(_content_tokens(re.sub(r"\[Evidence[^\]]*\]", "", sentence or ""))) >= min_tokens


def verify_single_claim(claim_text: str, citations: List[CitationRef]) -> Tuple[bool, List[CitationRef]]:
    """
    Verify whether at least one citation's source_text substantively supports
    the claim. Returns (verified, verified_citations).

    A citation is considered supportive if:
      - token overlap between claim and source_text ≥ EVIDENCE_OVERLAP_THRESHOLD, OR
      - the source_text contains a key noun phrase from the claim
    """
    claim_tokens = _tokenize(claim_text)
    if len(claim_tokens) < MIN_CLAIM_COVERAGE:
        # Too short to verify meaningfully — treat as verified to avoid false negatives
        return True, citations

    verified_citations = []
    for cit in citations:
        if not cit.source_text:
            continue
        overlap = _token_overlap(claim_text, cit.source_text)
        if overlap >= EVIDENCE_OVERLAP_THRESHOLD or containment(claim_text, cit.source_text) >= CLAIM_CONTAINMENT_THRESHOLD:
            verified_citations.append(cit)

    return len(verified_citations) > 0, verified_citations


def verify_claims(claims: List[Claim]) -> List[Claim]:
    """
    Verify all claims and update their verified flag.
    Claims with no supporting evidence are marked verified=False.
    Citations that don't support the claim are removed from that claim.

    This enforces the NO EVIDENCE = NO CLAIM policy.
    """
    verified_claims = []
    for claim in claims:
        is_verified, supporting_cits = verify_single_claim(
            claim.claim_text, claim.supported_by
        )
        verified_claims.append(
            Claim(
                claim_text=claim.claim_text,
                supported_by=supporting_cits,
                verified=is_verified,
            )
        )
        if not is_verified:
            logger.warning(
                "Claim FAILED verification (no supporting evidence): %s...",
                claim.claim_text[:80],
            )
        else:
            logger.debug("Claim verified: %s...", claim.claim_text[:60])

    return verified_claims


def validate_citations(citations: List[CitationRef], retrieved_chunks: list) -> List[CitationRef]:
    """
    Validate that each citation actually points to a chunk that was retrieved
    and that the source_text is a plausible substring of the chunk content.

    Removes hallucinated citations (chunk_ids that were never retrieved).
    """
    retrieved_ids = {c.get("id") or c.get("chunk_id") for c in retrieved_chunks}
    valid_citations = []

    for cit in citations:
        if cit.chunk_id not in retrieved_ids:
            logger.warning(
                "Citation REMOVED — chunk_id not in retrieved set: %s (doc=%s)",
                cit.chunk_id,
                cit.document_id,
            )
            continue

        # Find the matching chunk
        chunk_content = next(
            (c.get("content", "") for c in retrieved_chunks
             if (c.get("id") or c.get("chunk_id")) == cit.chunk_id),
            "",
        )

        # Verify source_text overlap with chunk content
        if not cit.source_text:
            logger.warning("Citation removed — source_text is empty: chunk_id=%s", cit.chunk_id)
            continue
        if cit.source_text and chunk_content:
            overlap = containment(cit.source_text, chunk_content)
            if overlap < CITATION_SOURCE_CONTAINMENT_THRESHOLD:
                logger.warning(
                    "Citation source_text has very low overlap with chunk content "
                    "(overlap=%.2f) — possible hallucination: chunk_id=%s",
                    overlap,
                    cit.chunk_id,
                )
                continue
        valid_citations.append(cit)

    return valid_citations


def unsupported_claim_rate(claims: List[Claim]) -> float:
    """Return the fraction of claims that are NOT verified."""
    if not claims:
        return 0.0
    unsupported = sum(1 for c in claims if not c.verified)
    return unsupported / len(claims)
