# DocLens AI

## Citation-First Research Intelligence Platform

DocLens AI turns research papers into an evidence-grounded research workspace.
Researchers can upload papers, organize them into workspaces and collections,
search across documents, ask questions, compare papers, generate literature
reviews, and trace answers back to page-level source evidence.

The platform follows one core rule:

> **No evidence = no claim**

The implementation is intentionally separated into a lightweight application
control plane and a Python AI service. The NestJS backend owns authentication,
authorization, uploads, persistence, and API contracts. The FastAPI service owns
PDF extraction, embeddings, retrieval, generation, and verification.

---

## Core capabilities

- Workspace, collection, and paper library management
- Authenticated PDF upload with processing status
- PyMuPDF text extraction with page metadata
- Section-aware text chunking
- Native PDF table evidence extraction
- Figure/caption evidence representation
- BGE-M3 embeddings stored in PostgreSQL with pgvector
- Hybrid semantic and keyword retrieval
- Reciprocal Rank Fusion (RRF)
- BGE cross-encoder reranking
- Conversational multi-paper Q&A
- Follow-up question rewriting and bounded multi-query retrieval
- Structured Gemini answers
- Page- and chunk-level citations
- Citation overlap validation and claim verification
- Paper comparison
- Literature-review generation
- Research notes and reading progress
- Retrieval, citation, grounding, and latency evaluation

The current ingestion path does not use Docling, Semantic Scholar, a separate
vector database, or a mandatory knowledge-graph processing stage.

---

# System architecture

```text
                                Browser
                                   │
                                   ▼
                    ┌──────────────────────────────┐
                    │ React + Vite + Tailwind      │
                    │ Research workspace UI        │
                    └──────────────┬───────────────┘
                                   │ REST / WebSocket
                                   ▼
                    ┌──────────────────────────────┐
                    │ NestJS Backend                │
                    │ Auth, ACL, APIs, persistence  │
                    │ Uploads, jobs, AI proxy       │
                    └───────┬──────────────┬─────────┘
                            │              │
                            ▼              ▼
                 ┌────────────────┐  ┌──────────────────────┐
                 │ Redis          │  │ FastAPI AI Service   │
                 │ Cache/session  │  │ Ingestion and RAG    │
                 │ job coordination│ │ Models and evaluation│
                 └────────────────┘  └──────────┬───────────┘
                                                │
                                                ▼
                         ┌──────────────────────────────────┐
                         │ PostgreSQL + pgvector             │
                         │ Application data, chunks, vectors │
                         └──────────────────────────────────┘
                                                ▲
                                                │
                         ┌──────────────────────┴────────────┐
                         │ Persistent PDF upload volume       │
                         │ Backend read/write, AI read-only   │
                         └───────────────────────────────────┘
```

## Service responsibilities

| Service | Responsibility |
| --- | --- |
| Frontend | Research UI, uploads, chat, citations, comparison, reviews |
| NestJS backend | Authentication, authorization, API contracts, uploads, persistence, orchestration |
| FastAPI AI service | PDF extraction, chunking, embeddings, retrieval, reranking, generation, verification |
| PostgreSQL | Users, workspaces, documents, chunks, chats, citations, reviews, notes |
| pgvector | 1024-dimensional BGE-M3 chunk embeddings |
| Redis | Cache, session support, and processing coordination |
| Upload volume | Persistent PDF files shared between backend and AI service |

---

# Repository structure

```text
DocLens-AI/
├── frontend/
│   ├── src/
│   │   ├── components/       # Reusable UI components
│   │   ├── contexts/         # Auth and application state
│   │   ├── pages/            # Workspace, library, chat, comparison, review views
│   │   ├── services/         # Backend API clients
│   │   ├── hooks/            # Frontend hooks
│   │   ├── types/            # Frontend types
│   │   ├── App.*             # Application shell and routes
│   │   └── main.*            # Browser entrypoint
│   ├── Dockerfile
│   ├── nginx.conf
│   ├── package.json
│   └── vite.config.*
│
├── backend/
│   ├── src/
│   │   ├── auth/             # Registration, login, JWT, guards
│   │   ├── users/            # User APIs
│   │   ├── workspaces/       # Workspace APIs
│   │   ├── collections/      # Collection APIs
│   │   ├── documents/        # Uploads, document metadata, access checks
│   │   ├── processing/       # Ingestion and embedding job orchestration
│   │   ├── query/            # Search, chat, comparisons, literature reviews
│   │   ├── ai-proxy/         # NestJS-to-FastAPI client
│   │   ├── gateway/          # WebSocket updates
│   │   ├── prisma/           # Prisma service and database access
│   │   ├── common/           # Shared guards, DTOs, and utilities
│   │   ├── config/           # Environment configuration
│   │   ├── app.module.ts
│   │   └── main.ts
│   ├── prisma/
│   │   ├── schema.prisma
│   │   └── migrations/
│   ├── Dockerfile
│   ├── package.json
│   └── tsconfig.json
│
├── ai-service/
│   ├── main.py               # FastAPI endpoints
│   ├── ingest.py             # PyMuPDF extraction, chunking, embeddings
│   ├── query.py              # AI use cases: ask, summarize, compare, review
│   ├── requirements.txt
│   ├── Dockerfile
│   ├── rag/
│   │   ├── chain.py          # Conversational RAG and structured generation
│   │   ├── retriever.py      # Hybrid candidates, RRF, reranking adapter
│   │   ├── schemas.py        # Structured answers, claims, citations, reviews
│   │   ├── verification.py   # Claim and citation validation
│   │   ├── evaluation.py     # Retrieval and grounding metrics
│   │   └── test_phase_pipeline.py
│   └── vector_store/
│       └── pg_store.py       # PostgreSQL/pgvector persistence and search
│
├── docker-compose.yml        # PostgreSQL, Redis, migrations, backend, AI, frontend
├── package.json              # Workspace commands
├── .env.example              # Environment variable template
└── README.md
```

---

# Document ingestion pipeline

Ingestion is intentionally separate from answering questions.

```text
PDF upload
    │
    ▼
NestJS validation and persistent file storage
    │
    ▼
Processing job
    │
    ▼
FastAPI POST /ingest
    │
    ▼
PyMuPDF extraction
    │
    ├── Page text and document metadata
    ├── Section detection
    ├── Section-aware text chunks
    ├── Native table evidence
    └── Figure/caption evidence
    │
    ▼
DocumentChunk records in PostgreSQL
    │
    ▼
FastAPI POST /embed
    │
    ▼
BAAI/bge-m3, 1024 dimensions
    │
    ▼
pgvector + EmbeddingMetadata
    │
    ▼
Document status = READY
```

## Evidence representation

Every persisted chunk contains content plus metadata such as:

```json
{
  "pageNumber": 7,
  "chunkIndex": 12,
  "contentType": "table",
  "section": "Experiments",
  "contentHash": "..."
}
```

Text chunks preserve page and section context. Native tables are represented as
searchable Markdown-like content with table indexes. Figure evidence preserves
the page, caption, image count, and section. This allows answers to identify
visual evidence and connect it to surrounding paper text.

The base ingestion path records figure evidence and captions; full pixel-level
interpretation of arbitrary charts, diagrams, and scanned pages is not assumed
for every document.

---

# Data model

The canonical schema is in `backend/prisma/schema.prisma`.

```text
User
 └── Workspace
      └── Collection
           └── Document
                ├── DocumentChunk
                ├── EmbeddingMetadata
                ├── ProcessingJob
                ├── DocumentEntity
                └── Relationship

User
 ├── ChatSession ── Query ── Citation ── DocumentChunk
 ├── PaperComparison
 ├── LiteratureReview
 ├── ResearchNote
 └── ReadingProgress
```

Important models:

- `User`: identity, role, authentication, and ownership relationships
- `Workspace`: top-level research environment
- `Collection`: thematic grouping of documents
- `Document`: uploaded PDF metadata and processing state
- `DocumentChunk`: persistent text/table/figure evidence unit
- `EmbeddingMetadata`: model, dimensions, vector-store, and chunk linkage
- `ChatSession`, `Query`, and `Citation`: conversational history and traceability
- `PaperComparison`: multi-paper comparison result
- `LiteratureReview`: generated review sections and Markdown output
- `ResearchNote`: user-authored research notes
- `ReadingProgress`: document reading state

Document processing states include:

```text
PENDING → UPLOADED → EXTRACTING → CHUNKING → EMBEDDING → INDEXING → READY
                                      └──────────────────────────────→ FAILED
```

---

# RAG architecture

```text
Question and conversation history
              │
              ▼
Conditional standalone-question rewrite
              │
              ▼
Bounded multi-query expansion
              │
              ▼
Query embedding with BGE-M3
              │
       ┌──────┴──────┐
       ▼             ▼
Semantic search   Keyword search
       │             │
       └──────┬──────┘
              ▼
Reciprocal Rank Fusion, k = 60
              │
              ▼
BGE cross-encoder reranking
              │
              ▼
Evidence context construction
              │
              ▼
Gemini structured generation
              │
              ▼
Claim verification
              │
              ▼
Citation validation
              │
              ▼
Grounded answer with citations
```

## Retrieval stages

### Semantic retrieval

The question is embedded with `BAAI/bge-m3` and compared with chunk vectors in
pgvector. This handles conceptually similar wording.

### Keyword retrieval

The chunk text is searched for exact terms. This is important for model names,
dataset names, acronyms, equations, identifiers, and numeric table values.

### Reciprocal Rank Fusion

Independent semantic and keyword candidate lists are combined using:

```text
RRF contribution = 1 / (60 + rank)
```

Chunks present in both lists receive contributions from both retrieval signals.
Source and rank provenance are preserved in the result metadata.

### Cross-encoder reranking

The fused candidates are scored with:

```text
BAAI/bge-reranker-v2-m3
```

The reranker evaluates the complete `(question, chunk)` pair before final
top-K evidence selection.

---

# Evidence-grounded generation

Retrieved chunks are converted into explicit evidence blocks:

```text
[Evidence 1]
chunk_id: ...
document_id: ...
document_title: ...
page: 8
evidence_type: table
section: Experiments
---
Original chunk content
```

Gemini receives the evidence, question, and conversation context through the
structured LangChain pipeline. The generation schema requires:

- Claims to be supported by retrieved evidence
- Exact chunk and document identifiers
- Near-verbatim source excerpts
- Explicit insufficient-evidence responses
- Preservation of table labels and values
- Separation of visible figure observations from author-reported conclusions

The AI response is parsed into typed Pydantic models rather than treated as
unstructured text.

---

# Citation and claim verification

The verification layer runs after generation.

```text
Generated answer
      │
      ▼
Extract claims and citations
      │
      ▼
Check chunk/document identity
      │
      ▼
Check non-empty source text
      │
      ▼
Check source-text overlap
      │
      ▼
Reject or remove unsupported citations/claims
      │
      ▼
Persist final answer and citations
```

Validation rejects unknown chunk IDs, empty source excerpts, and citations with
insufficient overlap against the retrieved source content. Evaluation tracks
unsupported-claim rate and citation coverage.

---

# Research workflows

## Multi-paper Q&A

Questions can be scoped to a collection or selected document IDs. Access
control is enforced by NestJS before the AI service is called.

## Paper comparison

The comparison workflow synthesizes selected papers across:

- Methods
- Datasets
- Models
- Metrics
- Findings
- Similarities
- Differences
- Limitations

## Literature reviews

The literature-review workflow retrieves evidence from selected papers and
generates structured sections plus Markdown output.

## Knowledge graph data

The schema supports research entities and relationships such as authors,
concepts, datasets, methods, models, and metrics. Entity and relationship
queries are available through the AI service. Advanced graph exploration
features are not part of the core RAG path.

---

# AI service API

The FastAPI entrypoint is `ai-service/main.py`.

```text
GET  /health

POST /ingest
POST /embed
GET  /status/{document_id}

POST /search
POST /search/semantic
POST /search/chunk
POST /search/hybrid

POST /ask
POST /summarise
POST /review
POST /compare
POST /literature-review

POST /kg/entities
POST /kg/relationships

POST /evaluate
```

The NestJS backend exposes the public `/api/v1` routes and uses the AI service
as an internal dependency.

---

# Evaluation

The evaluation implementation is in `ai-service/rag/evaluation.py`.

## Retrieval metrics

- Recall@K
- Mean Reciprocal Rank (MRR)
- Reranking improvement

## Generation and grounding metrics

- Faithfulness
- Answer relevance
- Unsupported-claim rate

## Citation metrics

- Citation correctness
- Citation precision
- Citation coverage

## Operational metrics

- Retrieval and generation latency
- Processing latency

Negative-evidence tests verify that questions with no supporting source
material produce transparent insufficient-evidence responses instead of
fabricated claims.

---

# Deployment

Docker Compose runs:

```text
postgres
redis
backend-migrate
backend
ai-service
frontend
```

Startup order:

```text
PostgreSQL and Redis
        ↓
Prisma migrations
        ↓
FastAPI AI service
        ↓
NestJS backend
        ↓
React/Nginx frontend
```

The AI container caches Hugging Face models in a persistent volume so BGE-M3
and the reranker are not downloaded on every restart.

Required production configuration includes:

```text
DATABASE_URL
POSTGRES_PASSWORD
JWT_SECRET
INTERNAL_API_SECRET
GEMINI_API_KEY
CORS_ORIGINS
```

See `.env.example` for the available configuration.

---

# Security and reliability boundaries

- The frontend never accesses PostgreSQL directly.
- The backend owns authentication and collection/document authorization.
- The AI service is an internal service behind the NestJS control plane.
- Uploaded PDFs are stored in a persistent backend volume.
- The AI service mounts uploaded files read-only.
- DTO validation and access checks occur before AI requests.
- Processing failures are represented in document/job status rather than
  silently marking a document ready.
- Retrieval provenance, page metadata, chunk IDs, and source text are preserved
  for traceability.

---

# Local development

Install JavaScript dependencies:

```powershell
npm install
```

Generate the Prisma client:

```powershell
npm run prisma:generate
```

Start infrastructure and services:

```powershell
docker compose up --build
```

Useful validation commands:

```powershell
npm run build:all
npm --prefix backend run test
python -m compileall -q ai-service
python -m pytest ai-service\rag\test_phase_pipeline.py -q
docker compose config
```

---

# Current implementation boundary

The implemented pipeline is:

```text
Ingestion
→ Embeddings
→ Hybrid retrieval
→ RRF
→ Cross-encoder reranking
→ Multi-query retrieval
→ Evidence construction
→ Gemini structured generation
→ Citation validation
→ Claim verification
→ Evaluation
```

The architecture avoids adding separate orchestration frameworks, a second
vector database, or heavyweight document-processing dependencies. The main
quality boundary is the evidence metadata preserved from ingestion through the
final answer.
