from fastapi import FastAPI, HTTPException, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import List, Optional
import logging
import os
import math

import ingest
import query

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger(__name__)

app = FastAPI(title="DocLens AI Service", version="2.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# --- Request Models ---

def _sigmoid_score(value: float) -> float:
    try:
        return 1.0 / (1.0 + math.exp(-float(value)))
    except OverflowError:
        return 0.0 if value < 0 else 1.0

class IngestRequest(BaseModel):
    documentId: str
    filePath: str
    collectionId: str

class SearchRequest(BaseModel):
    query: str
    collectionId: str
    topK: int = 5
    documentIds: Optional[List[str]] = None

class AskRequest(BaseModel):
    question: str
    collectionId: str
    sessionId: Optional[str] = None
    topK: int = 10
    documentIds: Optional[List[str]] = None
    history: Optional[List[dict]] = None

class DocumentRequest(BaseModel):
    documentId: str

class LiteratureReviewRequest(BaseModel):
    collectionId: Optional[str] = None
    documentIds: Optional[List[str]] = None
    topic: Optional[str] = None

class CompareRequest(BaseModel):
    documentIds: List[str]
    collectionId: Optional[str] = None
    question: Optional[str] = None
    topK: int = 12

class KGQueryRequest(BaseModel):
    collectionId: str
    entityType: Optional[str] = None
    limit: int = 60

class EvaluateRequest(BaseModel):
    question: str
    collectionId: str
    documentIds: Optional[List[str]] = None
    topK: int = 10
    relevantChunkIds: Optional[List[str]] = None  # ground truth, if available
    isNegativeTest: bool = False  # True = question has no answer in docs


# --- Background task: async KG extraction ---

def _run_kg_extraction(document_id: str, chunks: list):
    """
    Runs asynchronously after ingestion. Does NOT block the /ingest response.
    Extracts KG entities/relationships and persists them to PostgreSQL.
    """
    try:
        from rag.kg_extractor import extract_kg_from_document, persist_kg_result
        logger.info("KG extraction starting for document %s (%d chunks)", document_id, len(chunks))
        result = extract_kg_from_document(document_id, chunks)
        persist_kg_result(document_id, result)
        logger.info(
            "KG extraction complete for document %s — entities=%d relationships=%d",
            document_id, len(result.entities), len(result.relationships),
        )
    except Exception as e:
        # Log but don't crash — ingestion already succeeded
        logger.error("KG extraction background task failed for document %s: %s", document_id, e)


# --- Endpoints ---

@app.get("/health")
def health():
    """Health check — used by Docker Compose and nginx."""
    return {"status": "ok", "message": "DocLens AI Service v2.0 is healthy"}


@app.post("/ingest")
def process_document(req: IngestRequest, background_tasks: BackgroundTasks):
    """
    Ingest a document: parse → chunk → embed → store in PostgreSQL.
    KG extraction runs asynchronously AFTER this response is returned.
    """
    try:
        res = ingest.ingest_document(req.documentId, req.filePath, req.collectionId)
        logger.info("Ingestion complete for document %s: %s", req.documentId, res)

        # Fetch stored chunks for KG extraction (after ingestion)
        # Run in background — does not block this response
        if res.get("status") == "completed":
            try:
                from vector_store.pg_store import pg_store
                chunks = pg_store.get_document_chunks(req.documentId)
                background_tasks.add_task(_run_kg_extraction, req.documentId, chunks)
                logger.info(
                    "KG extraction queued for document %s (%d chunks)",
                    req.documentId, len(chunks),
                )
            except Exception as e:
                logger.warning("Could not queue KG extraction: %s", e)

        return res
    except Exception as e:
        logger.error("Ingestion failed for document %s: %s", req.documentId, e)
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/status/{document_id}")
def get_processing_status(document_id: str):
    return {"status": "completed", "message": "AI processed"}


@app.post("/search/semantic")
@app.post("/search")
@app.post("/search/chunk")
def search(req: SearchRequest):
    """Hybrid RRF search with BGE reranking."""
    try:
        from vector_store.pg_store import pg_store
        from ingest import get_model, get_reranker
        model = get_model()
        q_emb = model.encode(req.query, normalize_embeddings=True).tolist()
        chunks = pg_store.search(req.query, q_emb, req.collectionId, req.documentIds, top_k=40)

        if chunks:
            reranker = get_reranker()
            pairs = [[req.query, c["content"]] for c in chunks]
            scores = reranker.predict(pairs)
            for i, chunk in enumerate(chunks):
                chunk["score"] = _sigmoid_score(float(scores[i]))
            chunks = sorted(chunks, key=lambda x: x["score"], reverse=True)[:req.topK]

        return chunks
    except Exception as e:
        logger.error("Search failed: %s", e)
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/ask")
def ask(req: AskRequest):
    """Q&A via LangChain RAG pipeline with structured output and claim verification."""
    try:
        return query.ask_question(
            req.question,
            req.collectionId,
            req.documentIds,
            req.topK,
            req.history,
        )
    except Exception as e:
        import traceback
        traceback.print_exc()
        logger.error("Ask failed: %s", e)
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/summarise")
def summarise(req: DocumentRequest):
    try:
        return query.summarize_document(req.documentId)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/review")
def review(req: DocumentRequest):
    try:
        return query.review_document(req.documentId)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/literature-review")
def generate_literature_review(req: LiteratureReviewRequest):
    try:
        return query.literature_review(req.collectionId, req.documentIds, req.topic)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/compare")
def compare_documents(req: CompareRequest):
    try:
        return query.compare_documents(req.documentIds, req.collectionId, req.question, req.topK)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# --- Knowledge Graph endpoints ---

@app.post("/kg/entities")
@app.post("/graph/entities")
def kg_entities(req: KGQueryRequest):
    """Get KG entities for a collection from PostgreSQL."""
    try:
        from vector_store.pg_store import pg_store
        entities = pg_store.get_entities(req.collectionId, req.entityType, req.limit)
        return entities
    except Exception as e:
        logger.error("KG entities failed: %s", e)
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/kg/relationships")
def kg_relationships(req: KGQueryRequest):
    """Get KG relationships for a collection from PostgreSQL."""
    try:
        from vector_store.pg_store import pg_store
        relationships = pg_store.get_relationships(req.collectionId, req.limit)
        return relationships
    except Exception as e:
        logger.error("KG relationships failed: %s", e)
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/graph/expand")
@app.post("/graph/insights")
@app.post("/graph/discover")
def graph_unsupported():
    """These graph endpoints return empty lists (not yet implemented)."""
    return []


# --- Evaluation endpoint ---

@app.post("/evaluate")
def evaluate(req: EvaluateRequest):
    """
    Run RAG evaluation metrics for a question.
    Returns Recall@K, MRR, faithfulness, answer relevance, citation correctness,
    unsupported claim rate.

    If isNegativeTest=True, asserts that insufficient_evidence=True.
    """
    try:
        from rag.evaluation import EvaluationReport, test_unanswerable
        from rag.schemas import StructuredAnswer

        # Run the full RAG chain to get a structured answer
        result_dict = query.ask_question(
            req.question,
            req.collectionId,
            req.documentIds,
            req.topK,
        )

        # Fetch the retrieved chunks for metrics
        from vector_store.pg_store import pg_store
        from ingest import get_model
        model = get_model()
        q_emb = model.encode(req.question, normalize_embeddings=True).tolist()
        retrieved_chunks = pg_store.search(
            req.question, q_emb, req.collectionId, req.documentIds, top_k=req.topK
        )

        # Reconstruct StructuredAnswer from the result dict
        from rag.schemas import CitationRef, Claim
        citations = [
            CitationRef(
                chunk_id=c.get("chunkId", ""),
                document_id=c.get("documentId", ""),
                document_title=c.get("documentTitle", ""),
                page_number=c.get("pageNumber"),
                source_text=c.get("sourceText", ""),
                relevance=c.get("relevance", 0.0),
            )
            for c in result_dict.get("citations", [])
        ]
        claims = [
            Claim(
                claim_text=cl.get("claimText", ""),
                verified=cl.get("verified", False),
            )
            for cl in result_dict.get("claims", [])
        ]
        structured = StructuredAnswer(
            answer=result_dict.get("answer", ""),
            citations=citations,
            claims=claims,
            insufficient_evidence=result_dict.get("insufficient_evidence", False),
            confidence=result_dict.get("confidence", 0.0),
        )

        # Run evaluation
        report = EvaluationReport(
            question=req.question,
            answer=structured,
            retrieved_chunks=retrieved_chunks,
            relevant_chunk_ids=req.relevantChunkIds,
            k=req.topK,
        ).run()

        # Negative test assertion
        if req.isNegativeTest:
            passed, reason = test_unanswerable(structured, req.question)
            report["negative_test_passed"] = passed
            report["negative_test_reason"] = reason

        return report
    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))


if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("PORT", 8000))
    uvicorn.run("main:app", host="0.0.0.0", port=port, reload=True)
