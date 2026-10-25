# DocLens AI — Implemented Features and File Locations

> Status legend: **Implemented** = code path exists end to end (read in source; not run). **Partial** = works with
> caveats noted. **Not implemented** = schema/stub only. Paths are relative to the repository root.

## 1. Accounts and access

| Feature | Status | Where |
| --- | --- | --- |
| Register / login / profile (`/auth/*`) | Implemented | `backend/src/auth/` (`auth.controller.ts`, `auth.service.ts`, `strategies/`, `guards/`, `dto/`) |
| JWT bearer auth, live user lookup per request | Implemented | `backend/src/auth/strategies/jwt.strategy.ts`, `guards/jwt-auth.guard.ts` |
| Seeded admin + demo users | Implemented | `backend/src/main.ts`, `backend/src/users/users.service.ts` |
| Role-based access (`admin`/`viewer`) | **Not enforced** — guard + decorator exist, unused | `backend/src/common/guards/roles.guard.ts`, `decorators/roles.decorator.ts` |
| Update profile (name, password with current password) | Implemented | `PATCH /auth/me` (`auth.service.ts › updateProfile`); UI `frontend/src/pages/SettingsPage.jsx` |
| Google sign-in: popup (Google Identity Services ID token) or server-side redirect (authorization code + PKCE); accounts linked by Google `sub`, then by verified email | Implemented and unit-tested; **not tested with real Google credentials**. Off until `GOOGLE_CLIENT_ID` is set; redirect flow when `GOOGLE_CLIENT_SECRET` and `GOOGLE_CALLBACK_URL` are also set | `backend/src/auth/google-token.verifier.ts`, `google-oauth.service.ts`, `auth.service.ts › signInGoogleIdentity`, `auth.controller.ts`; `frontend/src/hooks/useGoogleSignIn.js`, `pages/Login.tsx`, `contexts/AuthContext.tsx › completeGoogleRedirect` |
| Login/landing UI, auth state | Implemented — split-screen sign-in (story panel + card), inline validation, show password, strength meter, caps-lock hint, animated mode switch | `frontend/src/pages/Login.tsx`, `styles/auth.css`, `Landing.jsx`, `contexts/AuthContext.tsx`, `App.jsx` |
| Responsive app shell: off-canvas sidebar under 900 px, persisted collapse, account menu, Ctrl/⌘ K search, page transitions | Implemented | `frontend/src/components/layout/*`, `contexts/AppContext.jsx`, `styles/polish.css` |
| Dashboard: greeting, quick actions, clickable stat cards, server-side counts | Implemented | `frontend/src/pages/Dashboard.jsx` (`queryApi.analytics`) |

## 2. Organisation of papers

| Feature | Status | Where |
| --- | --- | --- |
| Workspaces CRUD (owner-only) | Implemented | `backend/src/workspaces/` |
| Collections CRUD within a workspace | Implemented | `backend/src/collections/` ; UI: `frontend/src/pages/CollectionsPage.jsx`, `CollectionPage.jsx` |
| Paper library view | Implemented | `frontend/src/pages/PapersPage.jsx`, `hooks/useResearchCorpus.js` |
| Dashboard / workspace overview | Implemented | `frontend/src/pages/Dashboard.jsx`; `GET /documents/workspace/overview` in `backend/src/documents/documents.service.ts` |
| Reading progress per paper | Implemented | `documents.controller.ts` (`/documents/:id/progress`), `ReadingProgress` model |
| Research notes | Implemented (API: list/create/update/delete; UI "Notes" tab lists and creates) | `backend/src/query/query.service.ts` (`createNote`…), `ResearchNote` model; UI `frontend/src/pages/CollectionPage.jsx` |
| Analytics counts | Implemented (4 counters only) | `QueryService.getAnalytics` |

## 3. Document ingestion

| Feature | Status | Where |
| --- | --- | --- |
| PDF upload (≤ 50 MB, PDF mimetype + extension) | Implemented | `backend/src/documents/documents.controller.ts` |
| Download original PDF | Implemented | `documents.controller.ts` (`:id/download`) |
| Delete document | Implemented (DB rows only; file stays on disk) | `documents.service.ts › remove` |
| Processing orchestration + job record | Implemented (in-process; failed jobs are not retried; jobs interrupted by a restart resume on startup) | `backend/src/processing/document-processing-queue.service.ts` |
| Live status events over WebSocket | Implemented | `backend/src/gateway/events.gateway.ts`, `frontend/src/contexts/SocketContext.jsx` |
| Layout-aware PDF parsing, section typing | Implemented | `ai-service/rag/pdf_parser.py` |
| Section-bounded chunks with contextual header | Implemented | `ai-service/rag/chunking.py` |
| Tables (native PDF tables) and figure/table captions as chunks | Implemented (best effort; no image/pixel analysis, no OCR) | `pdf_parser.py` (`_tables`, `_extract_captions`), `chunking.py` |
| Reference list extraction | Implemented (heuristic) | `pdf_parser.py › _split_references` |
| Paper profile ("research card") | Implemented (Gemini or extractive) | `ai-service/rag/paper_profile.py` |
| BGE-M3 embeddings → pgvector | Implemented | `ai-service/ingest.py › embed_document`, `vector_store/pg_store.py` |
| Re-ingest all documents (keeps unchanged chunk ids, citations and same-model vectors; re-embeds the rest) | Implemented (CLI) | `ai-service/reindex.py`, `rag/chunking.py › reconcile_chunk_ids`, `pg_store.insert_ingestion_chunks` |

## 4. Retrieval and question answering

| Feature | Status | Where |
| --- | --- | --- |
| Rule-based query routing (section boosts, reference exclusion) | Implemented | `ai-service/rag/query_router.py` |
| Hybrid semantic + OR-keyword retrieval | Implemented | `ai-service/vector_store/pg_store.py › hybrid_search`, `text_query.py` |
| Reciprocal Rank Fusion (k = 60) | Implemented | `ai-service/rag/retriever.py › reciprocal_rank_fusion` |
| Cross-encoder reranking (one pass per question, 20 pairs, 512 tokens), per-paper cap; section boost available but off by default | Implemented | `retriever.py › retrieve_multi`, `rerank`, `cap_per_document` |
| Model warm-up at startup, single load per process | Implemented | `ai-service/ingest.py › warm_up_models`, `main.py` startup hook |
| Streaming progress (SSE) with cancel, timeouts, idempotent retries | Implemented (stages only, no token streaming) | AI `main.py › /ask/stream`; `backend/src/query/query.controller.ts › askStream`, `query.service.ts › ask`; `ai-proxy.service.ts › askStream`; `frontend/src/services/api.ts › askStream`, `ChatPage.jsx` |
| Conversational Q&A with rewrite + facet multi-query | Implemented | `ai-service/rag/chain.py`, `ai-service/query.py › ask_question` |
| Numbered evidence → server-resolved citations | Implemented | `ai-service/rag/evidence.py`, `chain.py › build_structured_answer` |
| Claim verification (token containment ≥ 0.45 **and** every claimed number present) + answer note for unverified claims and uncited sentences + refusal detection | Implemented (lexical only) | `ai-service/rag/verification.py › claim_supported`, `chain.py › build_structured_answer`, `opens_with_refusal` |
| Scope-checked citation alignment and `[n]` renumbering in the backend | Implemented | `QueryService.alignAiCitations`, `remapMarkers` |
| No-relevant-evidence floor (abstain before generation when the best BGE-M3 cosine < `RETRIEVAL_MIN_SIMILARITY`, default 0.48) | Implemented (catches off-topic questions only; see RAG_PIPELINE §6) | `ai-service/rag/chain.py › below_relevance_floor`, `retriever.py › top_scores`, `pg_store.py › hybrid_search` (`similarity`); calibration `ai-service/eval/abstention_calibration.py` |
| Labelled background knowledge for general questions (separate from cited evidence, never cited) | Implemented | `chain.py › _background`, `clean_background`; `AnswerDraft.background`; UI `ChatPage.jsx` (`.answer-background`) |
| Evidence-conflict flag (cited passages disagree) | Implemented (set by the model, not verified) | `AnswerDraft.evidence_conflict`, `build_structured_answer`; UI flag in `ChatPage.jsx` |
| Chat UI flags for insufficient evidence / conflicting sources / fallback (with reason: timeout or Gemini quota/key) / unverified claims; kept when a session is reopened | Implemented | `frontend/src/pages/ChatPage.jsx › answerFlags`, `toAssistantMessage`; backend `query.service.ts › storedAnswerFields` |
| Persisted chat sessions, queries, citations | Implemented | `backend/src/query/query.service.ts` (`ask`, `listSessions`, `getSession`), models `ChatSession/Query/Citation` ; UI `frontend/src/pages/ChatPage.jsx` |
| Local (non-AI) fallback answers, labelled as such | Implemented | `QueryService.composeCitedAnswer`, `rankChunks` |
| Search endpoints (routed and raw hybrid) | Implemented | `/query/search`, `/query/search/hybrid` ; AI `/search*` |

## 5. Research workflows

| Feature | Status | Where |
| --- | --- | --- |
| Single-paper summary | Implemented (profile-based) | `ai-service/rag/synthesis.py › paper_summary`; `POST /query/summarise` |
| AI peer-review of one paper | Implemented (free text, not claim-verified) | `ai-service/query.py › review_document`; `POST /query/review` |
| Multi-paper comparison (+ stored history) | Implemented | `synthesis.py › compare_papers`; `QueryService.compare`; UI `frontend/src/pages/ComparePapersPage.jsx` |
| Thematic literature review + matrix + Sources | Implemented | `synthesis.py › literature_review`; `QueryService.generateLiteratureReview`; UI `LiteratureReviewsPage.jsx` |
| Literature review export (Markdown, simple PDF) | Implemented | `QueryService.exportLiteratureReview`, `renderSimplePdf` |
| Research gap analysis (gaps, consensus, contradictions, coverage) | Implemented in backend + AI; returned, **not stored** | `synthesis.py › research_gaps`; `POST /query/research-gaps`; called from `frontend/src/pages/LiteratureReviewsPage.jsx` (`queryApi.researchGaps`); how fully the result is rendered was not inspected |
| Evaluation endpoint (Recall@K, MRR, faithfulness, citation metrics) on the production retriever | Implemented | `ai-service/rag/evaluation.py`, `main.py › /evaluate` |
| Offline retrieval / live-answer quality harnesses with a 16-question gold set | Implemented | `ai-service/eval/` |

## 6. Knowledge graph

| Feature | Status | Where |
| --- | --- | --- |
| Entity/relationship tables | Schema only | `backend/prisma/schema.prisma` (`Entity`, `DocumentEntity`, `Relationship`) |
| LLM extractor + persistence helpers | Code exists, **never invoked** | `ai-service/rag/kg_extractor.py`, `pg_store.insert_entities/insert_relationships` |
| Read endpoints (`/kg/entities`, `/kg/relationships`, `/graph/entities`) | Implemented (return whatever rows exist — normally none) | `ai-service/main.py` |
| `/graph/expand|insights|discover` | Stubs returning `[]` | `ai-service/main.py › graph_unsupported` |
| Backend graph API / UI | Not implemented (no controller; proxy methods only) | `backend/src/ai-proxy/ai-proxy.service.ts` |

## 7. Platform, ops, UI shell

| Feature | Where |
| --- | --- |
| Docker Compose stack, health checks, shared upload volume, HF model cache | `docker-compose.yml`, `*/Dockerfile` |
| Nginx SPA hosting + API and Socket.IO proxies (the AI service is not exposed) | `frontend/nginx.conf`; the Vite dev proxy mirrors it (`/api`, `/socket.io`; the old `/ai` dev route was removed) in `frontend/vite.config.js` |
| Caching of list endpoints | `@nestjs/cache-manager` in `backend/src/app.module.ts`, `CacheInterceptor` in `documents.controller.ts` |
| Swagger (non-production) | `backend/src/main.ts` |
| Request logging, response envelope, error filter | `backend/src/common/interceptors/`, `filters/` |
| Landing page: hero with app screenshot (`frontend/public/app-screenshot.png`, mock data), features, how it works, architecture, call to action. Copy revised 2026-10-26 to describe only shipped features; nav gets its background on scroll (listens to `.landing-root`, the scroll container) | `frontend/src/pages/Landing.jsx`, `components/blocks/HeroSection.jsx`, `pages/landing/*` |
| Hash-routed SPA shell (sidebar/topbar) | `frontend/src/contexts/AppContext.jsx`, `components/layout/` |
| Service health polling hook (backend `GET /health`; it previously probed `/ai/health`, which nginx no longer serves) | `frontend/src/hooks/useServiceHealth.js` |
| Light / dark / system theme | `frontend/src/hooks/useTheme.js`, `styles/theme-light.css`; toggle in the top bar and Settings → Appearance |
| Design system (2026-10-24): one neutral palette, one accent, status colours only for status, Inter loaded from Google Fonts, sans labels instead of uppercase mono, no grid texture; remaps the older `--rp-*` tokens for both themes | `frontend/src/styles/design-system.css` (imported last in `App.jsx`), fonts in `frontend/index.html` |
| Layout and theme pass (2026-10-25/26): app dark tokens use a navy/indigo palette; stat and card grids size to their content (no empty columns); chat suggestions and scope controls as classes; history panel overlays the chat under 1200 px; report tables stack on phones; comparison and literature-review readers use one full-width panel with Download and Close in the header and a one-line metadata row, and the comparison paper matrix follows the summary. The sign-in page keeps the landing page's cyan/emerald palette (`styles/auth.css`). Checked by screenshot at 1440, 1024 and 390 px | `frontend/src/styles/design-system.css`, `pages/ChatPage.jsx`, `ComparePapersPage.jsx`, `LiteratureReviewsPage.jsx`, `components/research/Icons.jsx` |
| Chat composer (textarea + send; the mic / "magic" / attach buttons had no behaviour and were removed) | `frontend/src/components/ui/PromptInput.jsx` |
| Markdown answers with clickable `[n]` citations and numbered source cards | `frontend/src/components/research/MarkdownAnswer.jsx`, `pages/ChatPage.jsx` |
| Report reader for literature reviews and comparisons (Markdown, tables, clickable sources with excerpts, verification line) | `frontend/src/components/research/CitedReport.jsx`, `utils/reportMarkdown.js` |
| Error boundary, toasts | `components/common/ErrorBoundary.jsx`, `contexts/ToastContext.jsx` |
| Tests | `backend/src/**/*.spec.ts` (auth, Google sign-in, query service, AI proxy long calls); `ai-service/rag/test_*.py` |
