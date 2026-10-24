from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import BaseModel
from typing import List, Optional
import logging
import os
import json
import math
import queue
import threading
import time

import ingest
import internal_auth
import query

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger(__name__)

app = FastAPI(title="DocLens AI Service", version="2.0.0")

# No CORS: browsers never call this service directly. Only the NestJS backend
# (which enforces per-user ownership) may, authenticated by a shared secret.
internal_auth.log_startup_mode()


@app.middleware("http")
async def require_internal_secret(request: Request, call_next):
    if not internal_auth.is_authorised(request.url.path, request.headers.get(internal_auth.HEADER)):
        return JSONResponse(status_code=401, content={"detail": "Missing or invalid internal API secret"})
    return await call_next(request)

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

class EmbedRequest(BaseModel):
    documentId: str

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

class ResearchGapsRequest(BaseModel):
    collectionId: Optional[str] = None
    documentIds: Optional[List[str]] = None
    topic: Optional[str] = None
    maxGaps: int = 8

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


# --- Endpoints ---

@app.on_event("startup")
def warm_up_models():
    # Load BGE-M3 and the reranker in the background so /health answers at
    # once and the first question does not pay the ~20 s model load.
    if os.getenv("MODEL_WARMUP", "true").strip().lower() not in ("0", "false", "no"):
        threading.Thread(target=ingest.warm_up_models, name="model-warmup", daemon=True).start()


@app.get("/health")
def health():
    """Health check — used by Docker Compose and nginx."""
    return {"status": "ok", "message": "DocLens AI Service v2.0 is healthy", "models_loaded": ingest.models_loaded()}


@app.post("/ingest")
def process_document(req: IngestRequest):
    """
    Phase 1 ingestion: parse → represent evidence → persist chunk metadata.
    Embedding and retrieval are intentionally deferred to later phases.
    """
    if not internal_auth.ingest_path_allowed(req.filePath):
        raise HTTPException(status_code=400, detail="filePath is outside the allowed upload directory")
    try:
        res = ingest.ingest_document(req.documentId, req.filePath, req.collectionId)
        logger.info("Ingestion complete for document %s: %s", req.documentId, res)

        return res
    except Exception as e:
        logger.error("Ingestion failed for document %s: %s", req.documentId, e)
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/embed")
def embed_document(req: EmbedRequest):
    """Phase 2: embed persisted ingestion chunks into pgvector."""
    try:
        return ingest.embed_document(req.documentId)
    except Exception as e:
        logger.error("Embedding failed for document %s: %s", req.documentId, e)
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/status/{document_id}")
def get_processing_status(document_id: str):
    return {"status": "completed", "message": "AI processed"}


@app.post("/search/semantic")
@app.post("/search")
@app.post("/search/chunk")
def search(req: SearchRequest):
    """Routed hybrid search (BGE-M3 + keyword → RRF → BGE rerank + section boost)."""
    try:
        return query._retrieve_and_rerank(req.query, req.collectionId, req.documentIds, req.topK)
    except Exception as e:
        logger.error("Search failed: %s", e)
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/search/hybrid")
def hybrid_search(req: SearchRequest):
    """Phase 3: return independent vector and keyword candidate lists."""
    try:
        from vector_store.pg_store import pg_store
        from ingest import get_model

        model = get_model()
        query_embedding = model.encode(
            req.query,
            normalize_embeddings=True,
            show_progress_bar=False,
        ).tolist()
        return pg_store.hybrid_search(
            req.query,
            query_embedding,
            req.collectionId,
            req.documentIds,
            top_k=req.topK,
        )
    except Exception as e:
        logger.error("Hybrid search failed: %s", e)
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


class _Cancelled(Exception):
    pass


def _sse(event: str, data) -> str:
    return f"event: {event}\ndata: {json.dumps(data)}\n\n"


@app.post("/ask/stream")
def ask_stream(req: AskRequest):
    """Same answer as /ask, delivered as Server-Sent Events:
    `stage` events while the pipeline runs, then one `result` or `error`.
    The answer itself is not token-streamed: it is structured JSON whose
    citations are resolved and verified before anything is shown.
    If the client disconnects, the pipeline stops at the next stage boundary."""
    events: "queue.Queue[tuple[str, object]]" = queue.Queue()
    cancelled = threading.Event()

    def on_stage(name: str) -> None:
        if cancelled.is_set():
            raise _Cancelled()
        events.put(("stage", {"stage": name}))

    def work() -> None:
        try:
            result = query.ask_question(req.question, req.collectionId, req.documentIds, req.topK, req.history, on_stage=on_stage)
            events.put(("result", result))
        except _Cancelled:
            logger.info("ask/stream cancelled by client")
        except Exception as e:  # reported to the client as an error event
            logger.error("Ask (stream) failed: %s", e)
            events.put(("error", {"detail": str(e)}))
        finally:
            events.put(("end", None))

    def stream():
        threading.Thread(target=work, name="ask-stream", daemon=True).start()
        try:
            while True:
                try:
                    kind, data = events.get(timeout=10)
                except queue.Empty:
                    yield ": keep-alive\n\n"  # comment frame keeps proxies from idling out
                    continue
                if kind == "end":
                    return
                yield _sse(kind, data)
        finally:
            cancelled.set()  # client gone or stream finished

    return StreamingResponse(stream(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


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


@app.post("/research-gaps")
def research_gaps(req: ResearchGapsRequest):
    """Cross-paper research-gap analysis with cited evidence."""
    if not req.collectionId and not req.documentIds:
        raise HTTPException(status_code=400, detail="collectionId or documentIds is required")
    try:
        return query.research_gaps(req.collectionId, req.documentIds, req.topic, req.maxGaps)
    except Exception as e:
        logger.error("Research gap analysis failed: %s", e)
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
        started_at = time.perf_counter()
        result_dict = query.ask_question(
            req.question,
            req.collectionId,
            req.documentIds,
            req.topK,
        )

        # Retrieved chunks for metrics: the same retriever and merge as /ask.
        from rag.chain import production_retriever, retrieve_merged
        retrieved_chunks = retrieve_merged(
            production_retriever(req.collectionId, req.documentIds, req.topK), req.question
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
        report["latency_ms"] = round((time.perf_counter() - started_at) * 1000, 2)

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
