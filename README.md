# DocLens AI

## A Citation-First Research Intelligence Platform

DocLens AI is a full-stack research intelligence platform that transforms static research papers into an interactive, evidence-grounded research system.

Researchers can organize papers into collections, search their content semantically, ask questions across documents, generate multi-paper comparisons and literature reviews, and explore relationships between research entities through a Knowledge Graph.

The core principle is:

> **NO EVIDENCE = NO CLAIM**

DocLens prioritizes grounded responses and traceability by connecting AI-generated answers to retrieved evidence and source citations.

---

## 🎯 Core Capabilities

### 1. Research Collections & Library

* Organize research papers into collections
* Workspace-based document management
* PDF library
* Document processing status
* User authentication and access control

### 2. PDF Ingestion

Research papers are automatically processed through:

```text
PDF
 ↓
Docling Parsing
 ↓
Hierarchical Chunking
 ↓
BGE-M3 Embeddings
 ↓
PostgreSQL + pgvector
```

### 3. Conversational Research Chat

Ask questions about documents in your research collections.

The RAG pipeline uses:

```text
Question
 ↓
Conditional Query Rewriting
 ↓
RRF Hybrid Retrieval
 ↓
BGE Reranking
 ↓
Evidence Selection
 ↓
Gemini Structured Output
 ↓
Claim Verification
 ↓
Citation Validation
 ↓
Final Answer
```

### 4. Evidence-Grounded Answers

DocLens verifies generated claims against retrieved evidence and validates citations against source chunks.

The goal is to prevent unsupported claims and provide researchers with a direct path from an answer back to the original paper.

### 5. Literature Reviews

Generate structured multi-paper research synthesis using retrieved evidence.

### 6. Paper Comparisons

Compare multiple papers across:

* Methods
* Datasets
* Models
* Metrics
* Findings
* Similarities
* Differences
* Limitations

### 7. Knowledge Graph

Extract research entities and relationships from documents.

Supported entity types include:

* Authors
* Concepts
* Datasets
* Methods
* Metrics
* Models

Knowledge Graph extraction runs asynchronously and stores results in PostgreSQL.

### 8. RAG Evaluation

Built-in evaluation support includes:

* Recall@K
* MRR
* Faithfulness
* Answer Relevance
* Citation Correctness
* Unsupported Claim Rate
* Negative/Insufficient-Evidence testing

---

# 🏗️ System Architecture

DocLens is a monorepo containing a React frontend, NestJS backend, and Python FastAPI AI service.

```text
                         Browser
                            │
                            ▼
                  ┌──────────────────┐
                  │ React + Vite     │
                  │ Nginx            │
                  └────────┬─────────┘
                           │
                           ▼
                  ┌──────────────────┐
                  │ NestJS Backend   │
                  │ TypeScript       │
                  │ Auth / API / ACL │
                  └───────┬──────────┘
                          │
             ┌────────────┴────────────┐
             │                         │
             ▼                         ▼
      ┌──────────────┐        ┌──────────────────┐
      │ Redis        │        │ FastAPI AI       │
      │ Cache        │        │ Semantic Engine  │
      └──────────────┘        └────────┬─────────┘
                                       │
                                       ▼
                              ┌──────────────────┐
                              │ Supabase         │
                              │ PostgreSQL       │
                              │ + pgvector       │
                              └──────────────────┘
```

---

# 🧰 Technology Stack

## Frontend

| Technology    | Purpose                       |
| ------------- | ----------------------------- |
| React 18      | UI                            |
| Vite          | Build tooling                 |
| Tailwind CSS  | Styling                       |
| Vanilla CSS   | Custom styling                |
| React Context | State management              |
| Nginx         | Production web server / proxy |

## Backend

| Technology | Purpose              |
| ---------- | -------------------- |
| NestJS     | Core API             |
| TypeScript | Backend language     |
| Prisma     | ORM                  |
| PostgreSQL | Application database |
| pgvector   | Vector storage       |
| Redis      | Caching              |
| JWT        | Authentication       |

## AI Service

| Technology            | Purpose                     |
| --------------------- | --------------------------- |
| FastAPI               | AI service API              |
| LangChain             | RAG orchestration           |
| Docling               | PDF parsing                 |
| BGE-M3                | Embeddings                  |
| BGE Reranker v2 M3    | Reranking                   |
| PostgreSQL + pgvector | Vector database             |
| Gemini                | LLM                         |
| Pydantic v2           | Structured outputs          |
| PyTorch               | ML runtime                  |
| Sentence Transformers | Embedding/reranking runtime |

---

# 📁 Project Structure

```text
doclens-fullstack/

├── frontend/
│   ├── src/
│   ├── nginx.conf
│   ├── Dockerfile
│   └── package.json
│
├── backend/
│   ├── src/
│   │   ├── auth/
│   │   ├── users/
│   │   ├── collections/
│   │   ├── documents/
│   │   ├── query/
│   │   └── ...
│   ├── prisma/
│   ├── Dockerfile
│   └── package.json
│
├── ai-service/
│   ├── main.py
│   ├── ingest.py
│   ├── query.py
│   ├── requirements.txt
│   ├── Dockerfile
│   │
│   ├── rag/
│   │   ├── chain.py
│   │   ├── retriever.py
│   │   ├── schemas.py
│   │   ├── verification.py
│   │   ├── kg_extractor.py
│   │   └── evaluation.py
│   │
│   └── vector_store/
│       └── pg_store.py
│
├── docker-compose.yml
├── .env.example
└── README.md
```

---

# 🧠 RAG Architecture

DocLens uses LangChain to orchestrate the RAG workflow while preserving the existing PostgreSQL RRF retrieval implementation.

```text
                         User Question
                              │
                              ▼
                  Conditional Query Rewrite
                              │
                              ▼
                       RRF Retrieval
                              │
                              ▼
                        BGE Reranker
                              │
                              ▼
                       Evidence Set
                              │
                              ▼
                  LangChain RAG Pipeline
                              │
                              ▼
                 Gemini Structured Output
                              │
                              ▼
                    Claim Verification
                              │
                              ▼
                    Citation Validation
                              │
                              ▼
                         Answer
```

The existing RRF SQL retrieval is retained instead of replacing it with a generic LangChain vector store.

This allows LangChain to provide orchestration while maintaining the existing retrieval architecture.

---

# 📄 Document Processing

The ingestion service processes research papers using Docling and hierarchical chunking.

```text
Research PDF
     │
     ▼
   Docling
     │
     ▼
Document Structure
     │
     ▼
Hierarchical Chunks
     │
     ▼
   BGE-M3
     │
     ▼
1024-D Embeddings
     │
     ▼
PostgreSQL / pgvector
```

The resulting embeddings are available for semantic and hybrid retrieval.

---

# 🔎 Retrieval

DocLens uses a hybrid retrieval architecture.

```text
              User Query
                  │
          ┌───────┴───────┐
          ▼               ▼
      Semantic         Lexical
      Retrieval        Retrieval
          │               │
          └───────┬───────┘
                  ▼
               RRF
                  │
                  ▼
            Candidate Set
                  │
                  ▼
            BGE Reranker
                  │
                  ▼
          Relevant Evidence
```

RRF combines retrieval signals before BGE reranking selects the most relevant evidence.

---

# 🛡️ Grounding & Verification

DocLens follows:

> **NO EVIDENCE = NO CLAIM**

The verification layer checks generated claims against retrieved evidence and validates citation references against document chunks.

The current verification mechanism uses heuristic text-overlap validation.

This provides a lightweight grounding layer while keeping the system transparent about the limitations of automated verification.

The system should be evaluated for:

* Unsupported claims
* Incorrect citations
* Missing evidence
* Irrelevant evidence
* Hallucinated answers

---

# 🧾 Structured Outputs

Pydantic v2 schemas provide structured outputs for:

* Answers
* Citations
* Claims
* Paper comparisons
* Literature reviews
* Knowledge Graph entities
* Knowledge Graph relationships

Example conceptual structure:

```text
Structured Answer
├── Answer
├── Claims
│   ├── Claim
│   └── Citation
└── Evidence
```

Structured outputs make downstream validation and API responses more predictable.

---

# 🕸️ Knowledge Graph

The Knowledge Graph extracts research entities and relationships from documents.

```text
                  Research Paper
                        │
                        ▼
                Entity Extraction
                        │
                        ▼
             Relationship Extraction
                        │
                        ▼
              Structured Validation
                        │
                        ▼
                   PostgreSQL
                        │
                        ▼
                 Knowledge Graph
```

Example:

```text
Author ──wrote──> Paper
Paper ──uses──> Dataset
Paper ──implements──> Method
Method ──achieves──> Metric
Paper ──discusses──> Concept
```

Extraction is performed asynchronously to avoid blocking the main document-processing workflow.

Because LLM-based extraction is probabilistic, Knowledge Graph results should be evaluated against the source documents.

---

# 📊 RAG Evaluation

DocLens includes an evaluation framework for measuring retrieval, generation, and grounding quality.

## Retrieval Metrics

```text
Recall@K
MRR
```

## Generation Metrics

```text
Faithfulness
Answer Relevance
```

## Citation Metrics

```text
Citation Correctness
Unsupported Claim Rate
```

## Negative Tests

The system should also be tested with questions for which the uploaded documents contain insufficient evidence.

Expected behavior:

```text
No Supporting Evidence
        ↓
No Unsupported Claim
        ↓
Transparent Insufficient-Evidence Response
```

Evaluation numbers should only be reported after running the actual evaluation suite.

---

# 🔐 Authentication

Authentication is handled entirely by the NestJS backend.

```text
Client
  │
  ▼
POST /api/v1/auth/login
  │
  ▼
AuthService
  │
  ▼
Credential Validation
  │
  ▼
JWT Generation
  │
  ▼
Client
```

Protected API requests use:

```text
Authorization: Bearer <JWT>
```

JWT configuration is validated during startup.

Authentication tests cover:

* Registration
* Duplicate registration
* Valid login
* Invalid credentials
* JWT validation
* Expired tokens
* Tampered tokens
* Wrong-secret tokens
* User isolation
* Logout behavior

---

# 🐳 Docker Architecture

DocLens runs as multiple Docker services:

```text
┌─────────────────────────────────────────────┐
│                Docker Compose               │
│                                             │
│  ┌──────────┐     ┌──────────┐              │
│  │ Frontend │────▶│ Backend  │              │
│  │  :8080   │     │  :3001   │              │
│  └──────────┘     └─────┬────┘              │
│                         │                   │
│                    ┌────▼────┐              │
│                    │AI       │              │
│                    │Service  │              │
│                    │:8000    │              │
│                    └─────────┘              │
│                                             │
│  ┌──────────┐                               │
│  │ Redis    │                               │
│  │ :6379    │                               │
│  └──────────┘                               │
└───────────────────────┬─────────────────────┘
                        │
                        ▼
                ┌───────────────┐
                │   Supabase    │
                │ PostgreSQL    │
                │ + pgvector    │
                └───────────────┘
```

---

# 🚀 Installation

## Prerequisites

Recommended:

* Docker
* Docker Compose
* Supabase PostgreSQL
* pgvector
* Gemini API key

For manual development:

* Node.js 18+
* Python 3.11+
* PostgreSQL 14+

---

# ⚙️ Environment Configuration

Create the local environment file:

```bash
cp .env.example .env
```

Configure:

```env
DATABASE_URL=your-supabase-database-url
GEMINI_API_KEY=your-gemini-api-key
JWT_SECRET=your-secure-jwt-secret
INTERNAL_API_SECRET=your-internal-service-secret
JWT_EXPIRES_IN=7d
CORS_ORIGINS=http://localhost:8080
LLM_MODEL=gemini-1.5-flash
```

Do not commit real credentials.

Use `.env.example` as the public configuration template.

---

# 🐳 Run with Docker

Build and start the application:

```bash
docker compose up --build -d
```

Check service status:

```bash
docker compose ps
```

Watch all logs:

```bash
docker compose logs -f
```

Watch the backend:

```bash
docker compose logs -f backend
```

Watch the AI service:

```bash
docker compose logs -f ai-service
```

Stop the application:

```bash
docker compose down
```

---

# 🌐 Application URLs

When running locally:

| Service   | URL                              |
| --------- | -------------------------------- |
| Frontend  | `http://localhost:8080`          |
| Backend   | `http://localhost:3001/api/v1`   |
| Swagger   | `http://localhost:3001/api/docs` |
| AI Health | `http://localhost:8000/health`   |
| Redis     | `localhost:6379`                 |

---

# ❤️ Health Checks

Backend:

```bash
curl http://localhost:3001/api/v1
```

AI service:

```bash
curl http://localhost:8000/health
```

Docker:

```bash
docker compose ps
```

The migration container may show:

```text
Exited (0)
```

This is expected after successful database migrations.

---

# 🔑 Authentication Test

Login:

```bash
curl -i -X POST \
  http://localhost:3001/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@doclens.ai","password":"YOUR_PASSWORD"}'
```

Test the protected `/me` endpoint:

```bash
curl -i \
  http://localhost:3001/api/v1/auth/me \
  -H "Authorization: Bearer YOUR_TOKEN"
```

Never commit or publicly share JWT tokens.

---

# 📦 Docker Volumes

The Docker deployment uses volumes for persistent application data and model caching.

```text
redis-data
backend-uploads
huggingface-cache
```

The HuggingFace cache prevents the large BGE models from being downloaded on every restart.

The current PDF storage uses the Docker `backend-uploads` volume.

For production deployments with replaceable or horizontally scaled servers, durable object storage should be considered for uploaded PDFs.

---

# ☁️ Deployment Model

Supabase hosts the PostgreSQL database independently from the application containers.

Therefore:

```text
Application
 ├── Frontend
 ├── Backend
 ├── AI Service
 └── Redis

Database
 └── Supabase PostgreSQL + pgvector
```

The application can be moved to another Docker-capable server without moving the PostgreSQL database.

Production deployment requires supplying the environment secrets to the deployment platform/server.

---

# 🧪 Testing

## Backend Tests

```bash
cd backend
npm test
```

Authentication tests cover the complete basic authentication flow.

## Backend Build

```bash
cd backend
npm run build
```

## Docker Validation

```bash
docker compose config
docker compose build
docker compose up -d
docker compose ps
```

## End-to-End Test

The recommended end-to-end workflow is:

```text
Login
 ↓
Create Workspace
 ↓
Upload PDF
 ↓
Document Processing
 ↓
Embedding
 ↓
Vector Storage
 ↓
Ask Question
 ↓
RRF Retrieval
 ↓
BGE Reranking
 ↓
Gemini
 ↓
Claim Verification
 ↓
Citation Validation
 ↓
Grounded Answer
```

---

# 🔬 Research Workflow

A typical DocLens workflow is:

```text
Researcher
    │
    ▼
Upload Papers
    │
    ▼
Organize into Collection
    │
    ▼
Semantic Search
    │
    ├──────────────┐
    ▼              ▼
Ask Questions   Compare Papers
    │              │
    ▼              ▼
Cited Answers   Structured Comparison
    │
    ▼
Literature Review
    │
    ▼
Knowledge Graph
```

This allows researchers to move from individual papers to collection-level research intelligence.

---

# 🎯 Design Principles

## Grounded Over Generative

AI features should prioritize evidence from source documents rather than unrestricted generation.

## No Evidence = No Claim

The RAG pipeline must preserve claim verification and citation validation.

## Citation First

Research answers should provide a path from:

```text
Answer
 ↓
Claim
 ↓
Citation
 ↓
Retrieved Chunk
 ↓
Original Paper
```

## Clear Service Boundaries

NestJS owns:

* Authentication
* Authorization
* Users
* Application business logic
* API orchestration

FastAPI owns:

* Document processing
* Embeddings
* Retrieval
* Reranking
* RAG
* Structured AI processing
* Knowledge Graph extraction
* AI evaluation

## Measured Improvements

New AI features should be evaluated rather than described as improvements without supporting measurements.

---

# 🔒 Security

Before production deployment:

* Rotate any credentials previously committed to Git
* Use strong JWT secrets
* Use a strong internal API secret
* Use a strong admin password
* Keep `.env` out of Git
* Never log passwords
* Never log API keys
* Never log JWT tokens
* Restrict CORS to trusted origins
* Use HTTPS in production

Recommended:

```bash
openssl rand -hex 32
```

for generating strong random secrets.

---

# ⚠️ Current Limitations

### Claim Verification

Current claim verification is heuristic and based on text overlap. A semantic or LLM-based verification layer could improve precision but would introduce additional computation and API calls.

### JWT Logout

Current logout behavior relies on token removal on the client side. A Redis-backed token denylist could provide stronger server-side revocation.

### Knowledge Graph Quality

LLM-based entity and relationship extraction requires evaluation because structured extraction can occasionally produce incorrect or incomplete results.

### PDF Storage

Current uploaded PDFs are stored in a Docker volume. Production deployments should consider durable object storage.

### AI Model Size

BGE-M3 and the BGE reranker are relatively large models. Initial AI-service startup can therefore take longer and requires additional memory/storage.

---

# 🚀 Future Improvements

Potential future improvements include:

* Semantic claim verification
* Stronger citation validation
* Redis-backed JWT revocation
* Durable PDF object storage
* Improved Knowledge Graph evidence linking
* Automated RAG benchmarks
* Larger evaluation datasets
* Improved structured-output reliability
* Production observability
* AI-service horizontal scaling
* GPU inference for larger deployments

---

# 🤝 Contributing

When extending DocLens:

1. Preserve evidence grounding.
2. Preserve citation traceability.
3. Keep authentication inside NestJS.
4. Keep AI workloads inside FastAPI.
5. Preserve claim verification.
6. Add tests for new functionality.
7. Evaluate AI improvements with measurable metrics.
8. Never commit credentials.

---

# 📄 License

© Aishwary Vansh 2026.

This project is licensed under the MIT License.
