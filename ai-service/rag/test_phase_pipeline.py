from .evaluation import (
    citation_coverage,
    citation_precision,
    recall_at_k,
    reranking_improvement,
)
from .retriever import reciprocal_rank_fusion
from .schemas import Claim, CitationRef, StructuredAnswer


def test_reciprocal_rank_fusion_merges_sources():
    results = reciprocal_rank_fusion(
        [
            {"id": "a", "retrievalSource": "semantic", "retrievalRank": 1},
            {"id": "b", "retrievalSource": "keyword", "retrievalRank": 1},
            {"id": "a", "retrievalSource": "keyword", "retrievalRank": 2},
        ],
        top_k=2,
    )
    assert [item["id"] for item in results] == ["a", "b"]
    assert results[0]["retrieval_sources"] == ["semantic", "keyword"]


def test_citation_metrics_and_reranking_improvement():
    citation = CitationRef(
        chunk_id="a",
        document_id="doc",
        document_title="Paper",
        source_text="supported evidence",
    )
    answer = StructuredAnswer(
        answer="Supported answer.",
        claims=[Claim(claim_text="Supported claim", supported_by=[citation])],
    )
    chunks = [{"id": "a", "content": "supported evidence"}]
    assert citation_precision([citation], chunks) == 1.0
    assert citation_coverage(answer) == 1.0
    assert recall_at_k(["b", "a"], ["a"], 2) == 1.0
    assert reranking_improvement(["b", "a"], ["a", "b"], ["a"]) == 0.0
