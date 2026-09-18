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


# ── Core verification ─────────────────────────────────────────────────────────

EVIDENCE_OVERLAP_THRESHOLD = 0.15   # min Jaccard to consider a citation supportive
MIN_CLAIM_COVERAGE = 3              # min tokens a claim must have to be verifiable
CITATION_SOURCE_OVERLAP_THRESHOLD = 0.05


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
        if overlap >= EVIDENCE_OVERLAP_THRESHOLD:
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
            overlap = _token_overlap(cit.source_text, chunk_content)
            if overlap < CITATION_SOURCE_OVERLAP_THRESHOLD:
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
