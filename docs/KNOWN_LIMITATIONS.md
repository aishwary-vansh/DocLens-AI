# DocLens AI — Known Limitations and Technical Debt

> Items were found by reading the source (file references given). Rows marked **Fixed 2026-10-23** were changed and are covered by the
> offline tests listed in [RAG_PIPELINE.md](RAG_PIPELINE.md) §10 — with fakes, **not** against a running PostgreSQL/pgvector stack or the BGE models.
> Other rows were not reproduced by running the system, so their impact statements describe what the code does, not observed incidents. Severity is a judgment call:
> **High** = security/data exposure or likely user-visible failure; **Medium** = correctness/robustness; **Low** = hygiene.
> Credentials are intentionally not reproduced here.

## 1. Security

| # | Sev | Finding | Evidence |
| --- | --- | --- | --- |
| S1 | High | **Fixed 2026-10-23** — `X-Internal-Secret` required when `INTERNAL_API_SECRET` is set (`ai-service/internal_auth.py`, sent by `ai-proxy.service.ts`); CORS and the Nginx `/ai/` proxy removed; `/ingest` path-guarded by `INGEST_ALLOWED_DIR`. Still open in dev when the secret is unset, and compose still publishes 8000. Original finding: **AI service is unauthenticated and exposed.** `INTERNAL_API_SECRET` is configured but never sent or checked; FastAPI has CORS `*`; port 8000 is published and Nginx proxies `/ai/` to it. Anyone who can reach it can ingest paths, read chunks and call Gemini | `ai-service/main.py`, `backend/src/ai-proxy/ai-proxy.service.ts`, `docker-compose.yml`, `frontend/nginx.conf` |
| S2 | High | **Fixed 2026-10-23** — `useStaticAssets('/uploads')` removed from `main.ts`. Original finding: **Uploaded PDFs are served without authentication** at `/uploads/<userId>/<file>` via `useStaticAssets`, independent of the JWT-guarded download route. Names are `timestamp-random.pdf` but not secret | `backend/src/main.ts` |
| S3 | High | **Fixed 2026-10-23** — `scope_filter` always intersects ids with the collection and refuses unscoped queries; backend checks ids for `/query/ask` and `/query/search/hybrid`; citations are re-checked against user scope (`alignAiCitations`). Original finding: **Document-id scoping gap in hybrid search.** When `documentIds` is supplied, the SQL filters by those ids and ignores the collection. `POST /query/search/hybrid` only verifies the *collection*, so ids from another user's documents can be queried. (`/query/ask` does check ids; `/query/search` goes through the same checked path.) | `ai-service/vector_store/pg_store.py › hybrid_search`; `backend/src/query/query.service.ts › hybridSearch` |
| S4 | Med | **Fixed 2026-10-23** — ownership check, 404 otherwise. Original finding: **`GET /query/status/:documentId` has no ownership check** (returns job stage/progress/error for any id) | `query.controller.ts › status`, `QueryService.pipelineStatus` |
| S5 | Med | **Hard-coded demo account**: `main.ts` always seeds `demo@doclens.ai` with a password literal in source; admin password falls back to a documented default in code, compose and `backend/.env.example` | `backend/src/main.ts`, `docker-compose.yml` |
| S6 | Med | **No rate limiting enforced** (Throttler configured, guard removed "to prevent 429 during local dev"); login/register are brute-forceable | `backend/src/app.module.ts` |
| S7 | Med | **Weak `JWT_SECRET` only warns**; code default for the secret is a placeholder string | `backend/src/main.ts`, `config/app.config.ts`, `jwt.strategy.ts` |
| S8 | Med | **Roles are not enforced**; `admin` and `viewer` have identical access | `common/guards/roles.guard.ts` unused |
| S9 | Med | **JWT stored in `localStorage`** (XSS-exposed); no refresh/revocation (7-day tokens) | `frontend/src/services/api.ts` |
| S10 | Low | Many `QueryController` bodies use inline types, so `ValidationPipe` does not validate them (e.g. `topK`, `documentIds` shape) | `backend/src/query/query.controller.ts` |
| S11 | Low | Compose defaults: wildcard `CORS_ORIGINS=*`, dev DB password fallback, Postgres/Redis ports published | `docker-compose.yml` |
| S12 | Low | Frontend route protection is only the `isAuthenticated` branch in `App.jsx`; an earlier "protected routes" commit was reverted (`d37c47e` → `5cfb314`). Backend enforcement is what matters | `frontend/src/App.jsx`, git log |

## 2. Correctness and robustness

| # | Sev | Finding | Evidence |
| --- | --- | --- | --- |
| R1 | High | **Processing is in-process fire-and-forget** (`void this.runJobDirect`) with `maxAttempts=1`. A backend restart mid-job leaves the document in `EXTRACTING`/`EMBEDDING` forever; no retry, stuck-job sweeper or manual "reprocess" endpoint. Redis is not used as a queue despite the `queueName` field | `backend/src/processing/document-processing-queue.service.ts` |
| R2 | High | **Partly mitigated 2026-10-23** — unverified claims are now disclosed in the answer text and the chat UI; refusal openings force `insufficient_evidence`. Still lexical. Original finding: **Claim verification is lexical** (≥ 45 % content-token containment). Unsupported claims are flagged and reduce `confidence`, but remain in the answer text. Wrong-but-lexically-similar claims pass. The README's "No evidence = no claim" is only partially enforced | `ai-service/rag/verification.py`, `rag/chain.py` |
| R3 | Med | **Fixed 2026-10-23** — backend retrieval runs only when `/ask` fails. Original finding: **Backend runs a separate pre-retrieval before `/ask`** and returns HTTP 400 if it finds nothing, even when `/ask` could have answered; double retrieval/rerank cost per question | `QueryService.ask` |
| R4 | Med | **Fixed 2026-10-23** — `/ask` raises without a key / on LLM errors; backend shows a labelled extractive fallback. Original finding: **Without `GEMINI_API_KEY`, `/ask` returns the text "GEMINI_API_KEY is not configured…" as the answer** with `insufficient_evidence: false` (fallback path) | `ai-service/query.py`, `rag/llm.py` |
| R5 | Med | **Partly fixed 2026-10-23** — ask and compare fallbacks are labelled (`model_used`, `degraded`, UI notice) and cite exactly what they show; the literature-review per-section fallback is still not labelled. Original finding: **Inconsistent fallbacks hide AI outages**: compare/literature-review/ask silently fall back to backend-local keyword text with `model_used: extractive-citation-fallback`; callers may not notice the AI path failed | `QueryService` |
| R6 | Med | **Partly mitigated** — `/review` responses carry `verified: false`; legacy free-text fallbacks in `query.py` were removed. Original finding: `/review` (and all legacy fallbacks) use unstructured Gemini text with `[Citation N]`; no verification | `ai-service/query.py` |
| R7 | Med | **Fixed 2026-10-23** — `reindex.py` re-embeds; re-ingest reuses ids/vectors of unchanged chunks so citations survive. Original finding: **Re-ingest drops vectors**: `/ingest` replaces all chunks; `reindex.py` does not call `/embed`, so documents are unsearchable by vector until re-embedded. Migration `20260916…` also nulled all old embeddings | `pg_store.insert_ingestion_chunks`, `reindex.py` |
| R8 | Med | **Fixed 2026-10-23** — `/evaluate` uses `chain.production_retriever` + `retrieve_merged`. Original finding: **`/evaluate` measures a different retrieval path** (`pg_store.search`, plain tsquery, no router/rerank) than production `/ask`, so its Recall@K/MRR do not describe live behavior | `ai-service/main.py` |
| R9 | Med | **Fixed 2026-10-23** — uses `rag/llm.model_name()`. Original finding: `answer_relevance` reads `LLM_MODEL` with default `gemini-1.5-flash`, while the rest of the code defaults to `gemini-2.5-flash` | `rag/evaluation.py` vs `rag/llm.py` |
| R10 | Low | `GET /status/{id}` on the AI service is a stub that always reports `completed` | `ai-service/main.py` |
| R11 | Low | Deleting a document leaves its PDF on disk (no unlink) | `documents.service.ts › remove` |
| R12 | Low | List endpoints use `CacheInterceptor` (default 60 s), so status/lists may lag the WebSocket events **⚠ Unverified** | `documents.controller.ts` |
| R13 | Low | Gateway CORS built from `CORS_ORIGINS` split literally; `*` default may not behave as intended for Socket.IO **⚠ Unverified** | `events.gateway.ts` |
| R14 | Low | **Fixed 2026-10-24** — `PATCH /auth/me` exists (name, password with current password). Original finding: frontend `authApi.updateProfile` targeted a non-existent route | `backend/src/auth/auth.controller.ts` |
| R16 | Low | Google sign-in links to an existing password account with the same (Google-verified) email. A Google-created account has a random password it cannot use; it can only sign in with Google unless a password reset flow is added (none exists) | `auth.service.ts › googleLogin` |
| R15 | Low | `GET /api/v1` advertises `/api/v1/graph` which does not exist | `backend/src/app.controller.ts` |
| R17 | Med | **Fixed 2026-10-24** — `/ingest` and `/embed` calls died at 300 s with `fetch failed` ("AI Service Unavailable") although their timeout is 900 s: Node's fetch (undici) has a fixed 300 s response-header limit. Seen live: BERT (81 chunks) was marked FAILED while the AI service was still embedding. Calls allowed > 290 s now use `node:http`. Documents that failed this way before the fix stay FAILED until re-uploaded or re-processed | `backend/src/ai-proxy/ai-proxy.service.ts › longRequest` |
| R18 | Med | The relevance floor only catches off-topic questions. Questions about the papers whose answer is absent score like answerable ones (cosine 0.53–0.66 vs 0.55–0.75), so their abstention still depends on Gemini and the refusal / claim checks. The cross-encoder floor (`RETRIEVAL_MIN_RERANK`) is not calibrated: the calibration run was stopped after an hour on CPU because it starved Docker of memory | `ai-service/rag/chain.py`, `eval/abstention_calibration.py` |
| R19 | Low | `evidence_conflict` is the model's own judgement; nothing checks it against the passages | `chain.py › build_structured_answer` |

## 3. Parsing and retrieval quality limits

- **Audit 2026-10-23, still open:**
  - Line-break de-hyphenation also joins real compounds split across lines ("English-to-German" → "Englishto-German"), hurting exact keyword match.
  - Citations of chunks whose text *changed* on re-ingest are still deleted by the `Citation → DocumentChunk` cascade (unchanged chunks are safe).
  - BGE-M3 + bge-reranker-v2-m3 measured offline (RAG_PIPELINE §11). The router section boost lowered recall under the real reranker; it is now off by default (`ROUTER_SECTION_BOOST=0`), chosen on a 12-question validation set. Both question sets are small (one question = 0.06–0.08). Measured in memory with BM25, not with PostgreSQL `ts_rank_cd`.
  - `attn-heads` (number of attention heads) is still not in the top 10 with section chunks.
  - The hybrid-search SQL changes (scope intersection, embedding-model filter, upsert re-ingest) were not executed against PostgreSQL; only unit-tested.
  - Refusal detection (`opens_with_refusal`), claim verification and the synthesis `SynthesisVerifier` are lexical heuristics: numbers and paper attribution are checked (2026-10-24), meaning is not (negated or paraphrased errors can pass). See [RAG_PIPELINE_REVIEW.md](RAG_PIPELINE_REVIEW.md) §3 for the remaining open findings.
  - With many papers in one synthesis task, the per-paper cross-encoder share drops to what is kept and papers are ranked by fused RRF only (`SYNTHESIS_RERANK_BUDGET`); quality effect not measured.

- **No OCR / scanned-PDF support**; image-only PDFs yield `failed` (`No extractable text`). Figures are represented by captions only (no pixel analysis). `VISION_*` settings are inert.
- Heading/section detection is heuristic (font size, boldness, regex vocabulary). Unusual layouts degrade to page-level chunks. Authors come only from PDF metadata (often empty).
- Reference splitting handles `[n]` and `12.` styles only. Tables rely on PyMuPDF `find_tables` (best effort, ≥ 80 chars).
- Keyword search computes `to_tsvector` per query with **no GIN index**; English-only stemming. Cost grows with corpus size.
- Retrieval fetches only `RERANK_CANDIDATES=20` candidates per list before RRF/rerank; the cross-encoder runs on CPU (CPU-only PyTorch in the image) and remains the slowest retrieval step (RAG_PIPELINE §11).
- **Streaming is progress-only:** stage events stream, answer tokens do not (the answer is shown after citation resolution and claim checks). Cancel takes effect at the next stage boundary; a Gemini call in flight still completes (and is billed).
- Duplicate-request protection (`clientRequestId`) joins in-flight requests only within one backend process; across processes it relies on the stored-answer lookup, which runs after the earlier request has been written. A replayed answer returns `claims: []`.
- `balanced_retrieve` (synthesis) reranks each paper's candidates against the concatenated queries (≤ 500 chars) rather than each query separately; its quality effect is not measured.
- The SSE path was tested with unit tests and the FastAPI test client only, not through nginx and a browser.
- Paper profiles are built from a character-budgeted subset of sections (28 000 chars), so long papers are summarised from partial evidence.
- Synthesis caps at 48 evidence blocks and `load_papers` at 30 documents per collection; large corpora are truncated.
- A single uvicorn worker (`--workers 1`) handles model inference; requests serialize behind model load/inference.
- Models (BGE-M3, reranker) are warmed up in a background thread at startup (≈ 22 s measured on CPU); a question that arrives earlier waits for the load (the UI shows "Loading models").

## 4. Incomplete or dead features

- **Backend features with no UI (checked 2026-10-24 by matching `services/api.ts` calls to controllers):** reading progress
  (`GET/PATCH /documents/:id/progress`), paper summary (`/query/summarise`) and peer review (`/query/review`), semantic search
  results (`/query/search`, `/search/hybrid`), processing status (`/query/status/:id`), editing/deleting notes, renaming/deleting
  collections and workspaces, and the dashboard overview route (`/documents/workspace/overview`). They work through the API
  but have no screen yet.
- Saved literature reviews do not store their global citation list; the reader rebuilds it from the Markdown "Sources"
  section, so the excerpts shown are the shortened snippets written there (≤ 200 characters from the AI service), not the full passage.
- `npm run lint` in `frontend/` reports pre-existing errors in older files (React-compiler rules such as setState in effects,
  unused imports in `components/ui/*`); files changed on 2026-10-24 lint clean.

- **Knowledge graph:** tables, extractor (`rag/kg_extractor.py`), `pg_store.insert_entities/insert_relationships`, `/graph/*` endpoints exist but nothing writes entities, three endpoints are stubs, and the backend has no graph route.
- **Research-gap results are not persisted** (no table); each call re-runs the LLM.
- `DocumentsService.persistAiOutputs` and `updateStatus`, `AnalyticsSnapshot`, `ProcessingJob` statuses `RETRYING`/`DEAD_LETTER`, `DocumentStatus` `CHUNKING`/`INDEXING`/`COMPLETED` are defined but not driven by current code.
- `pg_store.insert_chunks` (legacy single-step insert) and `pg_store.search` (older RRF SQL) are kept; only `search` is still called (by `/evaluate`).
- `RolesGuard`/`@Roles` unused; `NESTJS_CALLBACK_URL`, `INTERNAL_API_SECRET`, `VISION_*`, `DB_TYPE/DB_NAME` (`config/app.config.ts` still defaults to `sqlite`) are leftover configuration.

## 5. Testing and quality gaps

- Backend: auth, Google sign-in, `query/query.service.spec.ts` (fake Prisma) and `ai-proxy/ai-proxy.service.spec.ts` (local HTTP server); no tests for documents, processing or the gateway.
- AI service: offline pytest files in `rag/` (89 tests on 2026-10-24); `eval/answer_eval.py` exercises live Gemini on demand. No test runs pgvector SQL or the BGE models (the `eval/` scripts do, offline).
- No end-to-end (Docker) or load tests. A 16-question gold set exists (`ai-service/eval/gold_questions.json`) but its PDFs are local uploads, not in git.
- Python dependencies use ranges (`>=…,<…`) without a lockfile.
- Two documentation sets exist; see §7.

## 6. Build and deployment risks

- `backend/Dockerfile` does `COPY generated ./generated`, but `backend/generated/prisma` is git-ignored and the schema sets no generator `output`; a fresh clone may fail this step **⚠ Unverified** (details in [SETUP_AND_DEPLOYMENT.md](SETUP_AND_DEPLOYMENT.md) §3).
- The AI image needs several GB of model downloads on first start; the 180 s health-check start period may be too short on slow networks (compose retries 5×30 s) **⚠ Unverified**.
- Backend runs migrations through a separate `backend-migrate` service; the backend waits for `ai-service` health, so a failing model download blocks the whole stack from becoming healthy.
- `main.py` uses `reload=True` when run as a script (dev only; Docker uses the `CMD` without reload).

## 7. Documentation drift (outside `docs/`)

These files sit outside `docs/` and may not match the code:

- `README.md` has uncommitted edits and was **not re-audited line by line**. The version read earlier in this session said the SPA uses "clean browser paths" (the code uses hash routing) and described "citation overlap validation" (see [RAG_PIPELINE.md](RAG_PIPELINE.md) §7 for what actually runs). Re-check it against these docs.
- The earlier `documentation/` folder was removed and the root `CLAUDE.md` now points to `docs/`.
- `.agents/brain/**/implementation_plan.md` — describes removing the AI service; obsolete.
- Root `package.json` (description/keywords) and the backend Swagger description still call the product "Knowledge Graph-Driven"; the graph is not implemented.

## 8. Suggested priorities (not implemented)

1. ~~Authenticate the AI service~~ (done); stop publishing port 8000 outside local dev and make the secret mandatory in production.
2. ~~Fix hybrid-search scoping and gate static `/uploads`~~ (done). Run the full stack against PostgreSQL (BGE eval done offline).
3. Make processing recoverable (retry/sweeper on startup; use the existing `ProcessingJob` fields).
4. Apply the throttler to auth routes; remove or rotate the seeded demo credentials.
5. Add a GIN index on `to_tsvector('english', content)` (`/evaluate` alignment done).
