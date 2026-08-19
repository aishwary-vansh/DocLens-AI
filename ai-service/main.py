from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import List, Optional

import ingest
import query

app = FastAPI(title="DocLens AI Service")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# --- Models ---
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

# --- Endpoints ---

@app.get("/health")
def health():
    return {"status": "ok", "message": "AI Service is healthy"}

@app.post("/ingest")
def process_document(req: IngestRequest):
    try:
        res = ingest.ingest_document(req.documentId, req.filePath, req.collectionId)
        return res
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/status/{document_id}")
def get_processing_status(document_id: str):
    # Status is mostly managed by backend, returning completed if reachable
    return {"status": "completed", "message": "AI processed"}

@app.post("/search/semantic")
@app.post("/search")
@app.post("/search/chunk")
def search(req: SearchRequest):
    # Simply perform vector search without LLM
    try:
        from vector_store.pg_store import pg_store
        from ingest import get_model, get_reranker
        model = get_model()
        q_emb = model.encode(req.query).tolist()
        chunks = pg_store.search(req.query, q_emb, req.collectionId, req.documentIds, top_k=40)
        
        if chunks:
            reranker = get_reranker()
            pairs = [[req.query, c["content"]] for c in chunks]
            scores = reranker.predict(pairs)
            for i, chunk in enumerate(chunks):
                chunk["score"] = float(scores[i])
            chunks = sorted(chunks, key=lambda x: x["score"], reverse=True)[:req.topK]
            
        return chunks
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/ask")
def ask(req: AskRequest):
    try:
        return query.ask_question(req.question, req.collectionId, req.documentIds, req.topK, req.history)
    except Exception as e:
        import traceback
        traceback.print_exc()
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

# Note: Graph endpoints (Entities/Insights) are not supported per README
@app.post("/graph/entities")
@app.post("/graph/expand")
@app.post("/graph/insights")
@app.post("/graph/discover")
def graph_unsupported():
    return []

if __name__ == "__main__":
    import uvicorn
    import os
    port = int(os.environ.get("PORT", 8000))
    uvicorn.run("main:app", host="0.0.0.0", port=port, reload=True)
