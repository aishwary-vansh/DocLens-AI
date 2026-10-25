# DocLens AI — API and Authentication

> Verified from source (controllers, DTOs, `main.ts`, `ai-service/main.py`). Not exercised against a
> running instance. **⚠ Unverified** marks inferences. No secret values are listed.

## 1. Public backend API (NestJS)

- **Base URL:** `/api/v1` (global prefix, `backend/src/main.ts`). Compose publishes `:3001`; the
  frontend normally reaches it through Nginx at `:8080/api/`.
- **Swagger UI:** `/api/docs` — mounted only when `NODE_ENV !== 'production'` (Compose sets `production`).
- **Success envelope** (`TransformInterceptor`): `{ "data": <payload>, "meta": { "timestamp", "statusCode" } }`.
  The frontend client unwraps `json.data`.
- **Error envelope** (`HttpExceptionFilter`, only for `HttpException`):
  `{ statusCode, message, error, path, timestamp }`. Non-HTTP exceptions use Nest's default handler.
  **⚠ Unverified:** `res.sendFile`/`res.send` routes (download, export) bypass the success envelope by design.
- **Validation:** global `ValidationPipe` (`whitelist`, `forbidNonWhitelisted`, `transform`). It only
  validates parameters typed with DTO *classes*. Several `QueryController` handlers use inline object
  types for `@Body()`, which carry no runtime metadata, so those bodies are **not** validated by the pipe
  (checks happen manually in `QueryService`). Only `ResearchGapsDto` is a real DTO in `query/`.
- **CORS:** `CORS_ORIGINS` (comma list; `*` reflects any origin), credentials enabled, headers
  `Content-Type, Authorization`.
- **Rate limiting:** `ThrottlerModule` is configured (`RATE_LIMIT_TTL_MS`, `RATE_LIMIT_MAX`, defaults 60000/120)
  but no `ThrottlerGuard` is registered, so **no rate limit is enforced** (comment in `app.module.ts`).

### 1.1 Authentication model

| Aspect | Behavior (file) |
| --- | --- |
| Scheme | `Authorization: Bearer <JWT>` (`auth/strategies/jwt.strategy.ts`) |
| Login | `POST /auth/login` with email + password, `passport-local`, bcrypt compare (`auth/auth.service.ts`) |
| Register | `POST /auth/register` → creates user with role `viewer`, returns token immediately |
| Token payload | `{ sub: userId, email, role, iat, exp }`; expiry `JWT_EXPIRES_IN` (default `7d`) |
| Token validation | signature + expiry, then `UsersService.findById(sub)` — deleted users are rejected |
| Password hashing | `bcryptjs`, cost 10 (`users/users.service.ts`); register requires ≥ 6 chars |
| Roles | `admin` / `viewer` stored on `User.role`. `RolesGuard` + `@Roles()` exist in `common/` but **no controller uses them**, so roles do not currently gate any endpoint |
| Authorization | Ownership checks in services: workspace must belong to `user.id`; collection/document access resolves through `collection.workspace.userId` |
| Weak-secret check | Startup warns (does not stop) if `JWT_SECRET` is short (< 32 chars) or a known placeholder |
| Seed users | At startup `main.ts` creates (if absent) an admin from `ADMIN_EMAIL`/`ADMIN_PASSWORD` and a fixed demo viewer `demo@doclens.ai`. The demo password is hard-coded in source — see [KNOWN_LIMITATIONS.md](KNOWN_LIMITATIONS.md) |
| Frontend storage | Token in `localStorage['doclens_token']` (`frontend/src/services/api.ts`) |

Public (no JWT): `GET /api/v1` (service info), `POST /auth/register`, `POST /auth/login`.
Everything else below requires a valid JWT (controller-level `@UseGuards(JwtAuthGuard)`).

### 1.2 Endpoints

All paths are relative to `/api/v1`.

#### Health (`app.controller.ts`)
| Method | Path | Notes |
| --- | --- | --- |
| GET | `/` | API info and route list (no longer advertises the non-existent `/graph`) |
| GET | `/health` | Public. `{ api: { ok }, ai: { ok, modelsLoaded } }`; the backend asks the AI service's `/health` with a 5 s timeout. Used by the UI status lights, because the browser cannot reach the internal AI service |

#### Auth (`auth/auth.controller.ts`)
| Method | Path | Body | Notes |
| --- | --- | --- | --- |
| POST | `/auth/register` | `{ email, name (2–60), password (≥6) }` | 201; returns `{ accessToken, user }` |
| POST | `/auth/login` | `{ email, password }` | 200; returns `{ accessToken, user }` |
| GET | `/auth/me` | — | Profile without `passwordHash` |
| PATCH | `/auth/me` | `{ name? (2–60), password? (≥6), currentPassword? }` | JWT; changing the password requires the correct `currentPassword` (400 if missing, 401 if wrong) |
| POST | `/auth/google` | `{ credential }` (Google Identity Services ID token) | 200 `{ accessToken, user }`. The token is verified in `google-token.verifier.ts`: RS256 signature against Google's JWKS (cached per Cache-Control), `iss` = accounts.google.com, `aud` = `GOOGLE_CLIENT_ID`, not expired, `email_verified` = true. Account matching: an account linked to the token's `sub` (`User.googleId`) is signed in; else an account with the same verified email is linked to that `sub` and signed in (its password keeps working); else a viewer account is created with an unusable random password. 409 if that email is already linked to a different Google account. 503 when `GOOGLE_CLIENT_ID` is unset |
| GET | `/auth/google/start` | — | Public. 302 to Google's consent screen (authorization code + PKCE S256, `prompt=select_account`); sets the HttpOnly `dl_google_oauth` cookie holding state and verifier. Redirects to `#/login?google_error=unconfigured` unless `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` and `GOOGLE_CALLBACK_URL` are all set |
| GET | `/auth/google/callback` | `?code&state` or `?error` | Public. Checks state against the cookie (constant-time), exchanges the code with the client secret, verifies the returned ID token like `/auth/google`, then 302 to `<FRONTEND_URL>/#/login?google_code=<one-time code>` or `?google_error=<reason>` (`cancelled`, `state`, `exchange`, `invalid`, `unverified`, `conflict`, `unavailable`). The JWT is never put in a URL |
| POST | `/auth/google/exchange` | `{ code }` (≥ 20 chars) | Public. Trades the one-time code (in memory, 60 s, single use) for `{ accessToken, user }`; 401 if unknown or expired |
| GET | `/auth/config` | — | Public: `{ googleClientId, googleRedirect }`. `googleClientId` is null when Google sign-in is off; `googleRedirect` is true when the redirect flow is configured. The frontend reads it at runtime |

#### Workspaces (`workspaces/workspaces.controller.ts`)
`POST /workspaces`, `GET /workspaces`, `GET|PATCH|DELETE /workspaces/:id`.
Body: `{ name (1–100), description? (≤500) }`. Only the owner may read/modify (`ForbiddenException` otherwise).

#### Collections (`collections/collections.controller.ts`)
`POST /collections` (body `{ name, description?, workspaceId }`), `GET /collections?workspaceId=` (required),
`GET|PATCH|DELETE /collections/:id`.

#### Documents (`documents/documents.controller.ts`)
| Method | Path | Notes |
| --- | --- | --- |
| POST | `/documents/upload` | `multipart/form-data`: `file` (PDF only: mimetype **and** `.pdf` extension), `collectionId`. Limit 50 MB, 1 file. Triggers processing |
| GET | `/documents?collectionId=` | Cached (`CacheInterceptor`, default TTL 60 s) |
| GET | `/documents/workspace/overview` | Cached; dashboard data |
| GET / PATCH | `/documents/:id/progress` | Reading progress `{ status?, progress?, lastReadPage?, notes? }` |
| GET | `/documents/:id` | Metadata incl. `status`, `metadata` JSON |
| GET | `/documents/:id/download` | Streams original PDF |
| DELETE | `/documents/:id` | Deletes row (cascades chunks); emits `document:deleted`. Does **not** remove the file from disk (no unlink in `remove`) |

Because `GET`s are cached by URL, a status poll may be up to the TTL stale **⚠ Unverified** (cache key
behavior of `CacheInterceptor` with per-user data was not tested).

#### Query / research intelligence (`query/query.controller.ts`)
| Method | Path | Body / query | Persists |
| --- | --- | --- | --- |
| POST | `/query/ask` | `{ question, collectionId, sessionId?, topK?, documentIds?, clientRequestId? }` (ids must be in the collection, else 403). Response adds `claims[]`, `confidence`, `insufficient_evidence`, `evidence_conflict`, `background`, `abstain_reason`, `ai_failure` (`timeout` / `unavailable` = Gemini quota or key / `error`, only with the fallback), `model_used` (`extractive-citation-fallback` when the AI service failed; its first line now names the reason), `timings_ms`, `replayed`. `background`, `evidence_conflict` and `insufficient_evidence` are stored in `Query.rawRequest.answerMeta` and returned again by `GET /query/sessions/:id` and replays | `ChatSession`, `Query`, `Citation` |
| POST | `/query/ask/stream` | same body; `text/event-stream` response: `stage` events `{stage}` (`queued`, `loading_models`, `rewriting`, `retrieving`, `generating`, `verifying`, `fallback`), then one `result` (the `/query/ask` JSON) or one `error` `{statusCode, message}`; `: keep-alive` comment every 15 s. Closing the connection cancels the run and nothing is persisted | same as `/query/ask` |
| GET | `/query/sessions?collectionId=` | | up to 50 sessions |
| GET | `/query/sessions/:id` | | messages + citations |
| POST | `/query/search` | `{ query, collectionId, topK?, documentIds? }` | no |
| POST | `/query/search/hybrid` | same (document ids checked against the collection) | no; returns raw semantic + keyword candidate lists |
| POST | `/query/summarise` | `{ documentId }` | no |
| POST | `/query/review` | `{ documentId }` | no |
| POST | `/query/compare` | `{ documentIds (≥2), collectionId?, question?, topK? }` | `PaperComparison` |
| GET | `/query/comparisons?collectionId=` | | up to 50 |
| POST | `/query/literature-review` | `{ documentIds, collectionId?, topic?, title? }` | `LiteratureReview` |
| GET | `/query/literature-reviews[?collectionId=]` | | up to 50 |
| GET | `/query/literature-reviews/:id` | | |
| GET | `/query/literature-reviews/:id/export?format=markdown\|pdf` | | file download (PDF is a hand-built simple PDF: `renderSimplePdf`) |
| POST | `/query/research-gaps` | `ResearchGapsDto`: `collectionId?` (UUID), `documentIds?` (≤30 UUIDs), `topic?` (≤300), `maxGaps?` (1–15) | **not persisted** |
| GET / POST | `/query/notes` | list filters `collectionId`, `documentId`; create `{ title, content, collectionId?/documentId?/scope* }` | `ResearchNote` |
| PATCH / DELETE | `/query/notes/:id` | | |
| GET | `/query/analytics` | | counts for the current user |
| GET | `/query/status/:documentId` | | latest `ProcessingJob`; 404 unless the caller owns the document |

Notable behaviors (from `query.service.ts`):
- `ask`: requires collection access; loads ≤ 20 prior queries of the session as history (roles `user`/`model`);
  400 if no evidence is found; falls back to a locally composed answer when the AI call throws. After an AI **timeout** the fallback
  ranks chunks locally instead of calling the AI `/search` again.
- `clientRequestId` (8–64 chars `[A-Za-z0-9-]`, the chat UI sends a UUID per question): a duplicate while the first is running joins the
  same in-flight promise (one AI call, one write); a duplicate after it finished returns the stored answer with `replayed: true` (looked up
  via `Query.rawRequest.clientRequestId` for the same user). The in-flight map is per backend process.
- AI proxy (`ai-proxy.service.ts`): every call has a timeout (`AI_REQUEST_TIMEOUT_MS`, default 180 s; `/compare`, `/literature-review`,
  `/research-gaps`, `/review` use `AI_SYNTHESIS_TIMEOUT_MS`, 280 s; `/ingest` and `/embed` 900 s) → **504**
  "The AI service did not answer in time"; a cancelled request → **499** "Request cancelled"; unreachable → 503. Only read-only calls are
  retried, once after 500 ms, and only on connection errors (`ECONNREFUSED`, `ECONNRESET`, `EAI_AGAIN`, `UND_ERR_SOCKET`).
- `compare` needs ≥ 2 documents; every document must be owned by the caller or `403`.
- `search` and `search/hybrid` both call `assertCollectionAccess` when a user id is present (the controller
  always passes one). `summarise`/`review` look the document up through `collection.workspace.userId`.
  `search/hybrid` returns the AI service's raw candidate lists. `documentIds` passed to `search/hybrid` are
  **not** ownership-checked individually (only the collection is) — the SQL filters by those ids directly.

#### Not present
`/api/v1/graph/*` is advertised in `GET /api/v1` output but there is **no graph controller** in the backend.
`GET /api/v1/internal/*` (an `ai-callback` URL appears in compose env) does not exist either.

### 1.3 WebSocket (Socket.IO, default namespace)

In Docker the browser connects to `/socket.io/` on the frontend origin; nginx proxies it to the backend with the WebSocket upgrade headers (`frontend/nginx.conf`).

| Direction | Event | Payload |
| --- | --- | --- |
| client → server | handshake | `auth.token` = JWT (missing/invalid → disconnect) |
| client → server | `join:collection` | `collectionId` (must belong to the user's workspace) |
| client → server | `leave:collection` | `collectionId` |
| server → client | `document:uploaded` | full `Document` row |
| server → client | `document:status` | `{ id, status, updatedAt, errorMessage }` |
| server → client | `document:deleted` | `{ id }` |

Gateway CORS uses `CORS_ORIGINS` split on commas literally; a value of `*` is passed as the string `"*"`
inside an array — **⚠ Unverified** whether Socket.IO accepts that form in the Docker default.

## 2. Internal AI service API (FastAPI, `ai-service/main.py`)

**Shared-secret authentication** (`ai-service/internal_auth.py`): when `INTERNAL_API_SECRET` is set (not a `REPLACE_WITH…` placeholder), every
route except `GET /health` requires header `X-Internal-Secret: <secret>` (constant-time compare) or returns 401. The backend client
(`ai-proxy.service.ts`) sends it. Unset ⇒ open dev mode with a startup warning. CORS middleware was removed (browsers never call this service) and the
Nginx `/ai/` proxy was removed. Port 8000 is still published by compose (local dev convenience). `/ingest` rejects a `filePath` outside
`INGEST_ALLOWED_DIR` (compose: `/app/uploads`) with 400. AI-service errors keep their status code through the backend proxy (no longer all 503).

| Method | Path | Purpose | Body |
| --- | --- | --- | --- |
| GET | `/health` | liveness; `models_loaded` tells whether BGE-M3 / the reranker are in memory (warm-up runs at startup) | — |
| POST | `/ingest` | parse + chunk + profile + persist (no vectors) | `{ documentId, filePath, collectionId }` |
| POST | `/embed` | embed un-embedded chunks | `{ documentId }` |
| GET | `/status/{id}` | **stub** — always `{"status":"completed"}` | — |
| POST | `/search`, `/search/semantic`, `/search/chunk` | same handler: routed hybrid + rerank, returns chunk list | `{ query, collectionId, topK=5, documentIds? }` |
| POST | `/search/hybrid` | raw semantic + keyword candidates (no RRF/rerank) | same |
| POST | `/ask` | grounded Q&A; 500 when the LLM is unavailable (no free-text fallback) | `{ question, collectionId, sessionId?, topK=10, documentIds?, history? }` |
| POST | `/ask/stream` | same work as `/ask`, as SSE: `stage` `{stage}` events, then `result` (the `/ask` JSON) or `error` `{detail}`; stops at the next stage when the client disconnects | same as `/ask` |
| POST | `/summarise` | profile-based cited summary | `{ documentId }` |
| POST | `/review` | critical review text (Gemini, free text; response has `verified: false`) | `{ documentId }` |
| POST | `/compare` | structured comparison; `verification` {checked, supported, unsupported, misattributed, uncited, issues[]} | `{ documentIds, collectionId?, question?, topK=12 }` |
| POST | `/literature-review` | thematic review + matrix; `verification` overall and per section | `{ collectionId?, documentIds?, topic? }` |
| POST | `/research-gaps` | gap analysis (400 unless `collectionId` or `documentIds`); `verification`, per-gap `support` (`stated`/`inferred`/`ungrounded`), contradiction positions `verified` / `attributionMismatch` | `{ collectionId?, documentIds?, topic?, maxGaps=8 }` |
| POST | `/kg/entities`, `/graph/entities` | read `Entity` rows | `{ collectionId, entityType?, limit=60 }` |
| POST | `/kg/relationships` | read `Relationship` rows | same |
| POST | `/graph/expand`, `/graph/insights`, `/graph/discover` | **stub** — return `[]` | — |
| POST | `/evaluate` | run evaluation metrics for one question (production retriever) | see [RAG_PIPELINE.md](RAG_PIPELINE.md) §9 |

Response shape of `/ask` (`ai-service/query.py`): `answer`, `citations[{chunkId, documentId, documentTitle,
pageNumber, chunkIndex(null), sourceText, relevance}]`, `claims[{claimText, verified, supportedBy[]}]`,
`insufficient_evidence`, `confidence`, `uncited_sentences` (content sentences without an evidence marker), `evidence_conflict`,
`background` (general-knowledge text or null; never cited), `abstain_reason` (`no_chunks` / `low_relevance` / null), `top_similarity`,
`top_rerank` (null when the reranker did not run), `query_was_rewritten`, `rewritten_query`, `model_used`, `timings_ms` (`setup`, `rewriting`?, `retrieving`,
`generating`, `verifying`, `total`, milliseconds).
