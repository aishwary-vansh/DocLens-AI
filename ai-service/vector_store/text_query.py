# ai-service/vector_store/text_query.py
# Dependency-free helpers for building PostgreSQL retrieval queries.
import re
from typing import Any, Optional

_KEYWORD_STOPWORDS = {
    "what", "which", "who", "whom", "whose", "when", "where", "why", "how", "does", "did", "do",
    "the", "and", "for", "are", "was", "were", "with", "that", "this", "these", "those", "from",
    "into", "about", "between", "paper", "papers", "study", "studies", "work", "authors", "author",
    "they", "their", "there", "have", "has", "can", "could", "would", "should", "use", "used",
    "using", "any", "all", "each", "other", "than", "then", "its", "our", "you", "your", "tell",
    "explain", "describe", "give", "show", "list", "main", "some",
}


def keyword_or_query(text: str, max_terms: int = 16) -> str:
    """Build a websearch_to_tsquery string that ORs the informative terms.

    websearch_to_tsquery never raises on user input, and "a or b" gives
    OR semantics so ts_rank_cd can rank partial matches.
    """
    terms: list[str] = []
    for token in re.findall(r"[A-Za-z][A-Za-z0-9\-]{2,}|\d+(?:\.\d+)?", text or ""):
        lowered = token.lower()
        if lowered in _KEYWORD_STOPWORDS or lowered in terms or lowered == "or":
            continue
        terms.append(lowered)
        if len(terms) >= max_terms:
            break
    return " or ".join(terms) if terms else (text or "").strip()


def scope_filter(collection_id: Optional[str], document_ids: Optional[list[str]]) -> tuple[str, tuple]:
    """SQL WHERE clause restricting chunks to the caller's scope.

    Document ids are always intersected with the collection when both are
    given, so a request cannot reach another collection's papers by id.
    """
    clauses: list[str] = []
    params: list[Any] = []
    if collection_id:
        clauses.append('d."collectionId" = %s')
        params.append(collection_id)
    if document_ids:
        clauses.append("d.id = ANY(%s)")
        params.append(list(document_ids))
    if not clauses:
        raise ValueError("A collection_id or document_ids scope is required for retrieval")
    return "WHERE " + " AND ".join(clauses), tuple(params)
