# DocLens AI

**A Product-Focused Research Intelligence Platform**

DocLens AI is a full-stack platform designed to transform static research papers into an interactive intelligence system. It provides researchers with powerful semantic search, high-accuracy Retrieval-Augmented Generation (RAG), and a direct line of sight from AI-generated answers back to the original source text.

*DocLens focuses on delivering robust, grounded AI features without the hallucination risks or brittleness of complex, speculative pipelines.*

---

## 🎯 Core Capabilities (What DocLens Actually Does)

1. **Research Collections & Library**: Organize your PDFs into targeted domains.
2. **Fast & Reliable Ingestion**: Upload PDFs and watch them get automatically extracted, chunked, and embedded into a high-speed FAISS vector index.
3. **Citation-Backed Research Chat**: Ask questions across your collections. DocLens uses an advanced RAG pipeline to retrieve relevant chunks and generate answers. Every claim is backed by a clickable citation that reveals the exact source paragraph.
4. **Literature Reviews**: Automatically synthesize multi-paper literature reviews based *only* on retrieved text. Export them to Markdown or PDF.
5. **Insights & Analytics**: Track your corpus size, processing health, and discovery velocity.
6. **Workspace Notes**: Keep track of manual synthesis and thoughts alongside your automated chats.

*Note: DocLens strictly relies on retrieved paper content and does not invent information. We do not support "Knowledge Graphs", "Neo4j integrations", or "Auto-generated concept pipelines", as we prioritize grounded, verifiable answers over speculative extraction.*

---

## 🏗️ System Architecture

DocLens operates as a monorepo containing a React frontend, a NestJS core API, and a Python-based FastAPI AI service.

### Technology Stack

**Frontend Layer**
- **Framework:** React 18 powered by Vite
- **Styling:** Custom Vanilla CSS (Dark-theme, glassmorphism aesthetics)
- **State Management:** React Context API
- **Icons:** Lucide React

**Core Backend Layer**
- **Framework:** NestJS (TypeScript)
- **Database:** PostgreSQL
- **ORM:** Prisma
- **Authentication:** JWT (JSON Web Tokens)

**AI & Semantic Service Layer**
- **Framework:** FastAPI (Python)
- **Vector Database:** FAISS (Facebook AI Similarity Search)
- **Embeddings:** HuggingFace `sentence-transformers/all-MiniLM-L6-v2`
- **LLM Provider:** OpenRouter (DeepSeek V3 default, Gemini 2.5 Flash fallback)
- **Document Parsing:** PyMuPDF (`fitz`)

---

## 📁 Project Structure

```text
doclens-fullstack/
├── frontend/                   # React SPA
│   ├── public/                 # Static assets
│   ├── src/
│   │   ├── components/         # Reusable UI components
│   │   ├── pages/              # Route-level components
│   │   ├── contexts/           # Application state providers
│   │   ├── styles/             # Application design system
│   │   └── services/           # API integration layer
│
├── backend/                    # NestJS Core API
│   ├── src/
│   │   ├── auth/               # Authentication & Authorization
│   │   ├── users/              # User management
│   │   ├── collections/        # Research collections
│   │   ├── documents/          # Document state machine
│   │   └── query/              # Proxy to AI Service
│   ├── prisma/                 # Database schema and migrations
│
├── ai-service/                 # FastAPI Python Semantic Engine
│   ├── main.py                 # REST Endpoints
│   ├── ingest.py               # PDF Parsing, Chunking & Embedding
│   ├── query.py                # FAISS Retrieval & LLM Generation
│   └── vector_store/           # Local FAISS index & metadata DB
```

---

## 🚀 Setup & Installation

### Prerequisites
- Node.js (v18 or higher)
- Python (3.9 or higher)
- PostgreSQL (v14 or higher)

### 1. Database Configuration
Ensure PostgreSQL is running, then create the database:
```bash
createdb doclens
```

Configure the backend environment:
```bash
cd backend
cp .env.example .env
```
Update `backend/.env` with your credentials:
```env
DATABASE_URL="postgresql://username:password@localhost:5432/doclens"
JWT_SECRET="your-secure-jwt-secret"
PORT=3001
AI_SERVICE_URL="http://localhost:8000"
```

### 2. Run Database Migrations
```bash
cd backend
npx prisma generate
npx prisma migrate dev
```

### 3. AI Service Configuration
Configure the Python environment and provide your OpenRouter API key.
```bash
cd ai-service
python -m venv venv
source venv/bin/activate  # (or `venv\Scripts\activate` on Windows)
pip install -r requirements.txt
```

Create `ai-service/.env`:
```env
OPENROUTER_API_KEY="your-openrouter-key"
```

### 4. Start Development Servers
You will need to run three separate processes:

**Terminal 1 (Backend API):**
```bash
cd backend
npm install
npm run start:dev
```

**Terminal 2 (AI Semantic Service):**
```bash
cd ai-service
source venv/bin/activate
uvicorn main:app --reload --port 8000
```

**Terminal 3 (Frontend UI):**
```bash
cd frontend
npm install
npm run dev
```

The application will be available at `http://localhost:5173`.

---

## 🤝 Contributing & Workflows

1. **Grounded Over Generative:** Any new AI features must maintain a strict line-of-sight to the source document. If a feature relies on LLMs "guessing" relationships or extracting structured data unreliably, it does not belong in DocLens.
2. **Architecture:** The NestJS backend acts as the source of truth for Users, Authentication, and access control. The FastAPI service acts purely as a stateless/semantic worker for ingestion and retrieval. Do not cross these boundaries.
3. **UI/UX:** Maintain the premium, dark-themed aesthetic. Avoid injecting massive frameworks like Tailwind unless strictly necessary for a specific component.

---

## 📝 License

© Aishwary Vansh 2026. This project is licensed under the MIT License.
