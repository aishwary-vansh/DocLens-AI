# DocLens AI — Setup and Deployment

> Verified from `docker-compose.yml`, the three Dockerfiles, `frontend/nginx.conf`, `package.json` files and the
> `.env.example` templates. The stack was **not started** while writing this document; commands are those defined in the
> repo. **Secret values are never shown** — only variable names and non-secret defaults.

## 1. Prerequisites

| For | Needs |
| --- | --- |
| Docker route | Docker + Docker Compose; several GB of disk for images and the Hugging Face cache (BGE-M3 and the reranker are downloaded on first start into the `huggingface-cache` volume) |
| Local (non-Docker) route | Node.js 22 (images use `node:22-bookworm-slim`), Python 3.11 (`python:3.11-slim`), PostgreSQL 16 with `pgvector`, optional Redis 7 |
| LLM features | A Google Gemini API key (`GEMINI_API_KEY`). Without it, ingestion still works (extractive profile) and synthesis degrades to extractive output; `/ask` returns a "not configured" message (see [RAG_PIPELINE.md](RAG_PIPELINE.md) §6) |

## 2. Configuration

Compose reads variables from the shell / a root `.env` (copy `.env.example`; never commit `.env`).
Backend local dev reads `backend/.env` (`ConfigModule` `envFilePath: '.env'`, template `backend/.env.example`).
Frontend reads `VITE_API_URL` at **build time** (`frontend/.env.example`).

| Variable | Used by | Default / notes |
| --- | --- | --- |
| `POSTGRES_DB`, `POSTGRES_USER`, `POSTGRES_PASSWORD` | postgres | compose has dev fallbacks — **override the password** |
| `DATABASE_URL` | backend, backend-migrate, ai-service | compose default points to the `postgres` service with the dev credentials |
| `JWT_SECRET` | backend | required; ≥ 32 chars recommended (startup only *warns* if weak) |
| `JWT_EXPIRES_IN` | backend | `7d` |
| `GOOGLE_CLIENT_ID` | backend | empty = Google sign-in off. OAuth 2.0 **Web** client id. Alone it enables the Google Identity Services popup button. Public value; the frontend fetches it from `GET /auth/config`, so no frontend rebuild is needed. Setup: §7 |
| `GOOGLE_CLIENT_SECRET`, `GOOGLE_CALLBACK_URL` | backend | both set (with the client id) ⇒ the button uses the server-side redirect flow (authorization code + PKCE) instead of the popup. The callback must be on the origin the browser uses for `/api/v1` (Docker: `http://localhost:8080/api/v1/auth/google/callback`). Never commit the secret |
| `FRONTEND_URL` | backend | where the Google callback sends the browser (`<FRONTEND_URL>/#/login?google_code=…`). Empty ⇒ same origin as the API (Docker/nginx, Vite proxy) |
| `ADMIN_EMAIL`, `ADMIN_PASSWORD` | backend seed | fallback values exist in code and compose; **set your own** |
| `CORS_ORIGINS` | backend, gateway | compose default `*`; use an explicit list in production |
| `PORT` | backend (3001), ai-service (8000) | |
| `REDIS_URL` | backend | compose sets `redis://redis:6379`; unset ⇒ in-memory cache |
| `CACHE_TTL_MS`, `CACHE_NAMESPACE` | backend | `60000`, `doclens` |
| `RATE_LIMIT_TTL_MS`, `RATE_LIMIT_MAX` | backend | configured but no guard applied |
| `AI_SERVICE_URL` | backend | compose: `http://ai-service:8000`; code default `http://localhost:8000` |
| `INTERNAL_API_SECRET` | compose → backend, ai-service | backend sends it as `X-Internal-Secret`; AI service requires it on all routes but `/health` when set. Unset/placeholder ⇒ AI service open (dev only) |
| `INGEST_ALLOWED_DIR` | ai-service | compose `/app/uploads`; `/ingest` refuses files outside it. Unset ⇒ no path check |
| `NESTJS_CALLBACK_URL` | compose → backend | unused (the callback route no longer exists) |
| `GEMINI_API_KEY` | ai-service | enables LLM features; `REPLACE_WITH…` placeholders are treated as unset |
| `LLM_MODEL` | ai-service | compose/example default `gemini-2.5-flash` |
| `PAPER_PROFILE_ENABLED` | ai-service | `true` |
| `CHUNK_MAX_CHARS`, `CHUNK_OVERLAP_CHARS`, `MIN_CHUNK_CHARS` | ai-service | 2000 / 300 / 120 (compose passes the first two) |
| `PROFILE_CONTEXT_CHARS` | ai-service | `28000` |
| `EMBEDDING_MODEL`, `RERANKER_MODEL`, `EMBED_BATCH_SIZE` | ai-service | `BAAI/bge-m3`, `BAAI/bge-reranker-v2-m3`, `16` (embedding dim must be 1024; the most chunks per embedding batch) |
| `EMBED_REFERENCE_TOKENS` | ai-service | `512`. Embedding batches keep batch × longest-chunk-tokens² ≤ `EMBED_BATCH_SIZE` × this², which bounds attention memory. Lower it on hosts with less RAM |
| `RERANK_CANDIDATES` | ai-service | `20` — candidates per list and pairs scored by the cross-encoder per question (its cost dominates CPU latency) |
| `RERANKER_MAX_LENGTH` | ai-service | `512` tokens per (question, chunk) pair |
| `RERANKER_ENABLED` | ai-service | `true`; `false` ranks by fused RRF only (faster, lower quality) |
| `ROUTER_SECTION_BOOST` | ai-service | `0` (off); see [RAG_PIPELINE.md](RAG_PIPELINE.md) §4, §11 |
| `RETRIEVAL_MIN_SIMILARITY` | ai-service | `0.48`; abstain before calling Gemini when the best retrieved chunk's BGE-M3 cosine is lower; `0` disables. See RAG_PIPELINE §6 |
| `RETRIEVAL_MIN_RERANK` | ai-service | `0` (off); same floor on the cross-encoder score; not calibrated |
| `MODEL_WARMUP` | ai-service | `true` — load BGE models in a background thread at startup |
| `LLM_TIMEOUT_S`, `LLM_MAX_RETRIES` | ai-service | `60`, `1` per Gemini call |
| `SYNTHESIS_LLM_TIMEOUT_S` | ai-service | `100` — Gemini timeout for compare / literature review / gap analysis |
| `SYNTHESIS_RERANK_BUDGET` | ai-service | `60` cross-encoder pairs per multi-paper task, split across papers |
| `AI_SYNTHESIS_TIMEOUT_MS` | backend | `280000` for `/compare`, `/literature-review`, `/research-gaps`, `/review`; below nginx's 300 s |
| `AI_REQUEST_TIMEOUT_MS` | backend | `180000` for AI calls (ingest/embed use 900 s); keep below the nginx 300 s read timeout |
| `UPLOAD_ROOT` | `reindex.py` only | `/app` |
| `VISION_ENABLED`, `VISION_MAX_PAGES` | — | present in compose/example, **read by no code** |
| `VITE_API_URL` | frontend build | default in code `http://localhost:3001/api/v1` |

## 3. Run with Docker Compose

```bash
cp .env.example .env      # then edit: strong JWT_SECRET, passwords, GEMINI_API_KEY, CORS_ORIGINS
docker compose up --build
```

Services, ports and volumes (`docker-compose.yml`):

| Service | Image / build | Host port | Volumes | Depends on |
| --- | --- | --- | --- | --- |
| `postgres` | `pgvector/pgvector:pg16` | 5432 | `postgres-data` | — |
| `redis` | `redis:7-alpine` (AOF on) | 6379 | `redis-data` | — |
| `backend-migrate` | `./backend` target `build` | — | — | postgres healthy; runs `npx prisma migrate deploy`, then exits |
| `ai-service` | `./ai-service` | 8000 | `huggingface-cache`, `backend-uploads:/app/uploads:ro` | postgres healthy |
| `backend` | `./backend` | 3001 | `backend-uploads:/app/uploads` | redis + postgres healthy, migrate completed, ai-service healthy |
| `frontend` | `./frontend` (build → nginx) | 8080 | — | backend healthy |

Open the app at `http://localhost:8080`. Health checks: backend `GET /api/v1`, AI `GET /health` (180 s start period).

The upload volume is shared: the backend stores `uploads/<userId>/<file>.pdf` and passes the **absolute path**
`<cwd>/uploads/...` to the AI service, which works because both containers mount it at `/app/uploads`.

### Images
- **backend** (`backend/Dockerfile`): 3 stages (deps → build with `prisma generate` + Nest build → runtime with `npm install --omit=dev`). It runs
  `COPY generated ./generated`, but `backend/generated/prisma` is listed in `backend/.gitignore` and `schema.prisma` sets no generator `output`.
  **⚠ Unverified:** on a fresh clone `backend/generated` may not exist and the `COPY` would fail; on this machine the directory exists locally (untracked).
  If the build fails at that step, create the directory (or run `npm run prisma:generate` first) — see [KNOWN_LIMITATIONS.md](KNOWN_LIMITATIONS.md).
- **ai-service** (`ai-service/Dockerfile`): `python:3.11-slim`, CPU PyTorch (extra index in `requirements.txt`), single uvicorn worker, model cache via `HF_HOME`.
- **frontend** (`frontend/Dockerfile`): `npm ci && npm run build`, served by `nginx:1.27-alpine` with `frontend/nginx.conf`
  (`client_max_body_size 100M`, `/api/` → `backend:3001` with 300 s read timeout for LLM synthesis, `/socket.io/` → `backend:3001` with WebSocket upgrade (added 2026-10-24; before that the SPA fallback answered it and live status never connected in Docker), SPA fallback, `/assets/` cached 1 year).
  There is no `/ai/` proxy: the AI service is internal.

## 4. Local development (without Docker for the apps)

```bash
npm install                      # root workspaces: frontend + backend
npm run prisma:generate
# PostgreSQL+pgvector (and optional Redis) must be running; set DATABASE_URL in backend/.env
npm --prefix backend run prisma:deploy     # apply migrations
npm run dev:backend              # ts-node, :3001
npm run dev:frontend             # Vite; proxies /api and /socket.io → :3001 (like nginx; the AI service is not proxied)
```
```bash
cd ai-service
python -m venv venv && source venv/bin/activate   # Windows: venv\Scripts\activate
pip install -r requirements.txt
uvicorn main:app --port 8000
```
Notes: `ai-service/main.py` calls `uvicorn.run(..., reload=True)` when executed as a script. `ai-service/venv/` is git-ignored.
The first request that needs embeddings downloads the models (several GB) to the Hugging Face cache.

## 5. Build, test, and validation commands (defined in the repo)

| Command | What it does |
| --- | --- |
| `npm run build:all` | build backend then frontend |
| `npm --prefix backend run test` | Jest: `auth.service.spec.ts`, `query/query.service.spec.ts` (19 tests, passing 2026-10-23) |
| `npm run lint:frontend` / `lint:backend` | ESLint (backend script uses `--fix`) |
| `python -m pytest ai-service/rag -q` | Python tests, offline (56 passing 2026-10-23) |
| `python ai-service/eval/retrieval_eval.py` / `answer_eval.py` | retrieval / live-answer quality on local PDFs (see RAG_PIPELINE §11) |
| `python -m compileall -q ai-service` | syntax check |
| `docker compose config` | validate compose |
| `python ai-service/reindex.py` | re-ingest **and re-embed** every document |

`reindex.py` calls `ingest.ingest_document` then `ingest.embed_document`. Unchanged chunks keep their id (so chat citations survive) and their vector
when it came from the current `EMBEDDING_MODEL`; only new or changed chunks are embedded. Run it inside the ai-service container.

## 6. Production checklist (derived from code behavior)

1. Set strong `JWT_SECRET` (≥ 32 chars), `INTERNAL_API_SECRET`, `ADMIN_PASSWORD`, `POSTGRES_PASSWORD`; `CORS_ORIGINS` to real origins.
2. Do **not** publish ports 8000/5432/6379/3001 publicly. Set `INTERNAL_API_SECRET` — without it the AI service accepts unauthenticated calls.
3. Decide on the demo account: `main.ts` always seeds `demo@doclens.ai` with a hard-coded password — remove or rotate it.
4. Provide a Gemini key, or accept extractive behavior.
5. Enforce rate limiting (guard not applied). (`/uploads` is no longer served statically; PDFs go through the JWT-guarded download route.)
6. Back up `postgres-data` and `backend-uploads`; the HF cache is disposable.
7. Restarts mid-processing: interrupted jobs resume when the backend starts (see limitations R1). The ai-service has `restart: unless-stopped`, so an out-of-memory kill no longer leaves it down.
8. Swagger is disabled automatically when `NODE_ENV=production` (Compose sets it).
9. Google redirect flow: the one-time sign-in codes live in backend memory for 60 s, so run one backend instance (or move them to Redis).

## 7. Google sign-in setup

> **Unverified with real Google credentials.** The code paths are covered by unit tests (`backend/src/auth/google-*.spec.ts`),
> and the error redirects were checked against the running Docker stack on 2026-10-25. A real Google consent round trip has not been run.

1. Open <https://console.cloud.google.com/>, then create or pick a project.
2. **Google Auth Platform → Branding** (the OAuth consent screen): set the app name and support email. **Audience**: *External*. While the app is in *Testing*, add your Google accounts under *Test users*.
3. **Data access**: add the scopes `openid`, `.../auth/userinfo.email` and `.../auth/userinfo.profile` (all non-sensitive).
4. **Clients → Create client → Web application**.
5. **Authorized JavaScript origins** (needed for the popup button):
   - `http://localhost:8080` (Docker) and `http://localhost:5173` (Vite dev)
   - the deployed frontend origin, e.g. `https://<frontend>.onrender.com`
6. **Authorized redirect URIs** (needed only for the redirect flow; each must match `GOOGLE_CALLBACK_URL` exactly):
   - Docker: `http://localhost:8080/api/v1/auth/google/callback`
   - Vite dev (the dev server proxies `/api`): `http://localhost:5173/api/v1/auth/google/callback`
   - Separate backend host: `https://<backend>.onrender.com/api/v1/auth/google/callback`, with `FRONTEND_URL=https://<frontend>.onrender.com`
7. Put the values in `.env` (git-ignored), then recreate the backend: `docker compose up -d backend`.

   ```
   GOOGLE_CLIENT_ID=<client id>.apps.googleusercontent.com
   GOOGLE_CLIENT_SECRET=<client secret>      # omit to use the popup flow only
   GOOGLE_CALLBACK_URL=http://localhost:8080/api/v1/auth/google/callback
   FRONTEND_URL=                             # empty when frontend and API share an origin
   ```
8. Check: `curl http://localhost:8080/api/v1/auth/config` returns the client id, and `"googleRedirect": true` when the secret and callback are set.

On failure the callback redirects to `#/login?google_error=<reason>`, and the sign-in page shows a message for
`cancelled`, `state`, `exchange`, `invalid`, `unverified`, `conflict`, `unconfigured` and `unavailable`. The state/PKCE cookie
(`dl_google_oauth`: HttpOnly, `SameSite=Lax`, path `/api/v1/auth/google`, 10 min) is `Secure` when the callback URL is HTTPS.
