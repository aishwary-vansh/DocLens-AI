// src/services/api.ts
// ─────────────────────────────────────────────────────────────────────────────
// Centralised API client for DocLens.
// All components call these functions instead of raw fetch.
// ─────────────────────────────────────────────────────────────────────────────

const BASE_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:3001/api/v1';

// ── Token helpers ──────────────────────────────────────────────────────────
const TOKEN_KEY = 'doclens_token';

export const tokenStorage = {
  get: (): string | null => localStorage.getItem(TOKEN_KEY),
  set: (token: string) => localStorage.setItem(TOKEN_KEY, token),
  clear: () => localStorage.removeItem(TOKEN_KEY),
};

// ── Backend availability ───────────────────────────────────────────────────
// Shown when the API cannot be reached at all, so users see "server down"
// instead of a misleading "login failed" / "wrong password".
export const BACKEND_UNAVAILABLE_MESSAGE =
  'Cannot reach the DocLens server: the backend is not running or is unreachable. Please try again in a moment.';

/** fetch that turns a network failure (server down, DNS, offline) into a clear ApiError. */
async function send(url: string, init: RequestInit): Promise<Response> {
  try {
    return await fetch(url, init);
  } catch {
    throw new ApiError(BACKEND_UNAVAILABLE_MESSAGE, 0, 'BACKEND_UNAVAILABLE');
  }
}

/** Body as JSON, or null when it is empty or not JSON (proxy error pages). */
async function readJson(res: Response): Promise<any | null> {
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/**
 * The error for a failed response. nginx answers 502/503/504 with
 * `code: BACKEND_UNAVAILABLE` when the backend is down; the Vite dev proxy
 * answers with an empty or non-JSON 5xx. Both mean "backend not running".
 * A real backend error (JSON with a message) is passed through unchanged.
 */
function responseError(res: Response, json: any | null, fallback: string): ApiError {
  const backendDown =
    json?.code === 'BACKEND_UNAVAILABLE' ||
    (res.status >= 500 && !json?.message) ||
    ([502, 504].includes(res.status) && json === null);
  if (backendDown) return new ApiError(BACKEND_UNAVAILABLE_MESSAGE, res.status, 'BACKEND_UNAVAILABLE');
  const msg = Array.isArray(json?.message) ? json.message.join(', ') : json?.message;
  return new ApiError(msg || fallback, res.status);
}

// ── Core request helper ────────────────────────────────────────────────────
type HttpMethod = 'GET' | 'POST' | 'PATCH' | 'DELETE';

async function request<T>(
  method: HttpMethod,
  path: string,
  body?: unknown,
  params?: Record<string, string | number | undefined>,
): Promise<T> {
  const qs = params
    ? '?' +
      Object.entries(params)
        .filter(([, v]) => v !== undefined && v !== '')
        .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
        .join('&')
    : '';

  const token = tokenStorage.get();

  const res = await send(`${BASE_URL}${path}${qs}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });

  const json = await readJson(res);

  if (!res.ok) throw responseError(res, json, 'Something went wrong');
  if (json === null) throw new ApiError('Unexpected response from the server. Please try again.', res.status);

  return json.data ?? json;
}

// ── Multipart request (for file uploads) ──────────────────────────────────
async function requestMultipart<T>(
  path: string,
  formData: FormData,
): Promise<T> {
  const token = tokenStorage.get();
  const res = await send(`${BASE_URL}${path}`, {
    method: 'POST',
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      // Do NOT set Content-Type — browser sets multipart boundary automatically
    },
    body: formData,
  });

  const json = await readJson(res);
  if (!res.ok) throw responseError(res, json, 'Upload failed');
  if (json === null) throw new ApiError('Unexpected response from the server. Please try again.', res.status);
  return json.data ?? json;
}

// ── Typed error ────────────────────────────────────────────────────────────
function streamError(err: unknown, timeout: AbortSignal): Error {
  if (err instanceof ApiError) return err;
  if (timeout.aborted) return new ApiError('No answer after 4 minutes. The AI service may be overloaded; please try again.', 504);
  if ((err as Error)?.name === 'AbortError') return new ApiError('Request cancelled.', 499);
  return new ApiError(BACKEND_UNAVAILABLE_MESSAGE, 0, 'BACKEND_UNAVAILABLE');
}

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
    /** 'BACKEND_UNAVAILABLE' when the API server could not be reached. */
    public readonly code?: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// AUTH
// ─────────────────────────────────────────────────────────────────────────────
export interface UserProfile {
  id: string;
  email: string;
  name: string;
  role: 'admin' | 'viewer';
  createdAt: string;
}

export interface AuthResult {
  accessToken: string;
  user: UserProfile;
}

export const authApi = {
  login: (email: string, password: string) =>
    request<AuthResult>('POST', '/auth/login', { email, password }),

  register: (email: string, password: string, name: string) =>
    request<AuthResult>('POST', '/auth/register', { email, password, name }),

  me: () => request<UserProfile>('GET', '/auth/me'),

  /** Exchange a Google Identity Services ID token for a DocLens session. */
  google: (credential: string) =>
    request<AuthResult>('POST', '/auth/google', { credential }),

  /** Trade the one-time code from the Google redirect (#/login?google_code=…) for a session. */
  googleExchange: (code: string) =>
    request<AuthResult>('POST', '/auth/google/exchange', { code }),

  /** Full-page URL that starts the server-side Google redirect flow. */
  googleStartUrl: () => `${BASE_URL}/auth/google/start`,

  /**
   * Public sign-in options; googleClientId is null when Google sign-in is off.
   * googleRedirect is true when the server-side redirect flow is configured.
   */
  config: () => request<{ googleClientId: string | null; googleRedirect?: boolean }>('GET', '/auth/config'),

  updateProfile: (payload: { name?: string; password?: string; currentPassword?: string }) =>
    request<UserProfile>('PATCH', '/auth/me', payload),
};

// ─────────────────────────────────────────────────────────────────────────────
// WORKSPACES
// ─────────────────────────────────────────────────────────────────────────────
export interface Workspace {
  id: string;
  name: string;
  description?: string;
  userId: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateWorkspacePayload {
  name: string;
  description?: string;
}

export const workspacesApi = {
  list: () => request<Workspace[]>('GET', '/workspaces'),
  get: (id: string) => request<Workspace>('GET', `/workspaces/${id}`),
  create: (payload: CreateWorkspacePayload) =>
    request<Workspace>('POST', '/workspaces', payload),
  update: (id: string, payload: Partial<CreateWorkspacePayload>) =>
    request<Workspace>('PATCH', `/workspaces/${id}`, payload),
  remove: (id: string) => request<{ id: string }>('DELETE', `/workspaces/${id}`),
};

// ─────────────────────────────────────────────────────────────────────────────
// COLLECTIONS
// ─────────────────────────────────────────────────────────────────────────────
export interface Collection {
  id: string;
  name: string;
  description?: string;
  workspaceId: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateCollectionPayload {
  name: string;
  description?: string;
  workspaceId: string;
}

export const collectionsApi = {
  list: (workspaceId: string) =>
    request<Collection[]>('GET', '/collections', undefined, { workspaceId }),
  get: (id: string) => request<Collection>('GET', `/collections/${id}`),
  create: (payload: CreateCollectionPayload) =>
    request<Collection>('POST', '/collections', payload),
  update: (id: string, payload: Partial<Omit<CreateCollectionPayload, 'workspaceId'>>) =>
    request<Collection>('PATCH', `/collections/${id}`, payload),
  remove: (id: string) => request<{ id: string }>('DELETE', `/collections/${id}`),
};

// ─────────────────────────────────────────────────────────────────────────────
// DOCUMENTS
// ─────────────────────────────────────────────────────────────────────────────
export type DocumentStatus =
  | 'PENDING'
  | 'UPLOADED'
  | 'EXTRACTING'
  | 'CHUNKING'
  | 'EMBEDDING'
  | 'INDEXING'
  | 'READY'
  | 'COMPLETED'
  | 'FAILED';

export interface Document {
  id: string;
  title: string;
  filename: string;
  fileUrl: string;
  mimeType: string;
  fileSize: number;
  pageCount?: number;
  status: DocumentStatus;
  errorMessage?: string;
  collectionId: string;
  createdAt: string;
  updatedAt: string;
  metadata?: {
    citationsCount?: number;
    authors?: string[];
    year?: number | null;
    [key: string]: any;
  };
}

export const documentsApi = {
  list: (collectionId: string) =>
    request<Document[]>('GET', '/documents', undefined, { collectionId }),

  get: (id: string) => request<Document>('GET', `/documents/${id}`),

  /**
   * Upload a PDF. With `onProgress`, uses XMLHttpRequest so the caller gets
   * upload percentages (fetch has no upload progress events).
   */
  upload: (file: File, collectionId: string, onProgress?: (percent: number) => void) => {
    const form = new FormData();
    form.append('file', file);
    form.append('collectionId', collectionId);
    if (!onProgress) return requestMultipart<Document>('/documents/upload', form);
    return new Promise<Document>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', `${BASE_URL}/documents/upload`);
      const token = tokenStorage.get();
      if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);
      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable) onProgress(Math.round((event.loaded / event.total) * 100));
      };
      xhr.onload = () => {
        let json: any = {};
        try { json = JSON.parse(xhr.responseText || '{}'); } catch { /* non-JSON error page */ }
        if (xhr.status >= 200 && xhr.status < 300) return resolve((json.data ?? json) as Document);
        const msg = Array.isArray(json.message) ? json.message.join(', ') : json.message;
        if (json.code === 'BACKEND_UNAVAILABLE' || (xhr.status >= 500 && !msg)) {
          return reject(new ApiError(BACKEND_UNAVAILABLE_MESSAGE, xhr.status, 'BACKEND_UNAVAILABLE'));
        }
        reject(new ApiError(msg || (xhr.status === 413 ? 'This file is too large.' : 'Upload failed'), xhr.status));
      };
      xhr.onerror = () => reject(new ApiError(BACKEND_UNAVAILABLE_MESSAGE, 0, 'BACKEND_UNAVAILABLE'));
      xhr.send(form);
    });
  },

  /** Run processing again for a FAILED paper (same file, same collection). */
  reprocess: (id: string) =>
    request<Document>('POST', `/documents/${id}/reprocess`),

  // Download — fetches as blob and triggers browser save dialog
  download: async (id: string, filename: string) => {
    const token = tokenStorage.get();
    const res = await fetch(`${BASE_URL}/documents/${id}/download`, {
      headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    });
    if (!res.ok) throw new ApiError('Download failed', res.status);
    const blob = await res.blob();
    const url  = URL.createObjectURL(blob);
    const a    = Object.assign(document.createElement('a'), { href: url, download: filename });
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 1000);
  },

  remove: (id: string) => request<{ id: string }>('DELETE', `/documents/${id}`),

  workspaceOverview: () =>
    request<{
      stats: Record<string, number>;
      recentPapers: Document[];
      recentChats: { id: string; title?: string; scopeId: string; updatedAt: string; latestQuestion?: string }[];
      literatureReviews: LiteratureReview[];
      comparisons: PaperComparison[];
      readingProgress: ReadingProgress[];
    }>('GET', '/documents/workspace/overview'),

  getProgress: (id: string) =>
    request<ReadingProgress>('GET', `/documents/${id}/progress`),

  updateProgress: (id: string, payload: Partial<ReadingProgress>) =>
    request<ReadingProgress>('PATCH', `/documents/${id}/progress`, payload),
};

// ─────────────────────────────────────────────────────────────────────────────
// AI QUERY  (Phase 2 — connects automatically when FastAPI service is live)
// ─────────────────────────────────────────────────────────────────────────────
export interface QueryMessage {
  id?: string;
  role: 'user' | 'assistant';
  content: string;
  citations?: {
    documentId: string;
    documentTitle: string;
    chunk: string;
    score: number;
    pageNumber?: number;
    chunkIndex?: number;
    retrievalPath?: string[];
  }[];
  timestamp: string;
  session_id?: string;
  model_used?: string;
  /** True when the papers did not contain enough evidence; the answer may then have no citations. */
  insufficient_evidence?: boolean;
  confidence?: number;
  claims?: { claimText: string; verified: boolean; supportedBy: string[] }[];
  /** AI pipeline stage durations reported by the AI service. */
  timings_ms?: Record<string, number>;
  /** True when a retried request returned the already stored answer. */
  replayed?: boolean;
}

export interface QueryPayload {
  question: string;
  collectionId: string;
  topK?: number;
  sessionId?: string;
  retrievalMode?: 'vector';
  documentIds?: string[];
  /** Same id on a retry → the backend returns the first answer instead of asking again. */
  clientRequestId?: string;
}

/** Longest a chat answer may take before the browser gives up (backend gives up at 180 s). */
export const ASK_TIMEOUT_MS = 240_000;

export interface ChatSession {
  id: string;
  title?: string;
  scopeType: string;
  scopeId: string;
  createdAt: string;
  updatedAt: string;
  latestMessage?: string;
  citationCount?: number;
}

export interface CitationRef {
  chunkId?: string;
  documentId: string;
  documentTitle: string;
  pageNumber?: number;
  chunkIndex?: number;
  chunk: string;
  score: number;
  retrievalPath?: string[];
}

export interface PaperComparison {
  id?: string;
  title: string;
  question?: string;
  documentIds: string[];
  documentTitles?: string[];
  narrative: string;
  methods: string[];
  datasets: string[];
  strengths: string[];
  weaknesses: string[];
  findings?: string[];
  futureWork?: string[];
  sections?: Record<string, { text: string; citations: CitationRef[] }[]>;
  citations: CitationRef[];
  createdAt?: string;
  result?: PaperComparison;
}

export interface LiteratureReview {
  id: string;
  title: string;
  topic?: string;
  documentIds: string[];
  documentTitles?: string[];
  sections: Record<string, { heading: string; content: string; citations: CitationRef[] }>;
  citations?: CitationRef[];
  markdown: string;
  createdAt: string;
  status?: string;
}

export interface ResearchGap {
  title: string;
  gapType: string;
  description: string;
  rationale: string;
  suggestedResearchQuestions: string[];
  suggestedApproach: string;
  confidence: number;
  grounded: boolean;
  relatedDocuments: { documentId: string; title: string }[];
  citations: CitationRef[];
}

export interface ResearchGapAnalysis {
  topic?: string;
  summary: string;
  consensus: string[];
  contradictions: {
    topic: string;
    positions: { paperTitle: string; documentId?: string; stance: string }[];
    possibleExplanation: string;
  }[];
  gaps: ResearchGap[];
  coverage: string;
  citations: CitationRef[];
  documentIds: string[];
  method: 'llm' | 'extractive' | string;
  insufficientEvidence: boolean;
}

export interface ReadingProgress {
  id?: string;
  documentId: string;
  userId?: string;
  status: 'UNREAD' | 'READING' | 'COMPLETED' | string;
  progress: number;
  lastReadPage?: number | null;
  notes?: string | null;
  updatedAt?: string;
}

export interface ResearchNote {
  id: string;
  title: string;
  content: string;
  scopeType: string;
  scopeId: string;
  collectionId?: string;
  documentId?: string;
  createdAt: string;
  updatedAt: string;
}

export const queryApi = {
  ask: (payload: QueryPayload) =>
    request<QueryMessage>('POST', '/query/ask', payload),

  /**
   * Same as `ask`, but over Server-Sent Events: `onStage` receives progress
   * ("retrieving", "generating", ...). Abort `signal` to cancel; the backend
   * then stops and stores nothing. Times out after ASK_TIMEOUT_MS.
   */
  askStream: async (
    payload: QueryPayload,
    onStage: (stage: string) => void,
    signal?: AbortSignal,
  ): Promise<QueryMessage> => {
    const token = tokenStorage.get();
    const timeout = AbortSignal.timeout(ASK_TIMEOUT_MS);
    const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
    let res: Response;
    try {
      res = await fetch(`${BASE_URL}/query/ask/stream`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'text/event-stream',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(payload),
        signal: combined,
      });
    } catch (err) {
      throw streamError(err, timeout);
    }
    if (!res.ok || !res.body) {
      const json = await res.json().catch(() => ({}));
      throw new ApiError(json.message ?? 'The research query failed.', res.status);
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let boundary: number;
        while ((boundary = buffer.indexOf('\n\n')) >= 0) {
          const frame = buffer.slice(0, boundary);
          buffer = buffer.slice(boundary + 2);
          const event = /^event: (.*)$/m.exec(frame)?.[1];
          const data = /^data: (.*)$/m.exec(frame)?.[1];
          if (!event || data === undefined) continue; // keep-alive comment
          const parsed = JSON.parse(data);
          if (event === 'stage') onStage(parsed.stage);
          else if (event === 'result') return parsed.data ?? parsed;
          else if (event === 'error') throw new ApiError(parsed.message ?? 'The research query failed.', parsed.statusCode ?? 500);
        }
      }
    } catch (err) {
      throw streamError(err, timeout);
    } finally {
      reader.cancel().catch(() => undefined);
    }
    throw new ApiError('The connection closed before an answer arrived. Please try again.', 502);
  },

  sessions: (collectionId?: string) =>
    request<ChatSession[]>('GET', '/query/sessions', undefined, collectionId ? { collectionId } : undefined),

  session: (id: string) =>
    request<{ id: string; messages: QueryMessage[] }>('GET', `/query/sessions/${id}`),

  summarise: (documentId: string) =>
    request<{ summary: string; citations: CitationRef[] }>('POST', `/query/summarise`, { documentId }),

  search: (collectionId: string, q: string, topK = 5) =>
    request<{ results: { chunk: string; score: number; documentId: string; documentTitle: string; pageNumber?: number }[]; query: string; total: number }>(
      'POST', '/query/search', { collectionId, query: q, topK }),

  compare: (documentIds: string[], payload?: { collectionId?: string; question?: string; topK?: number }) =>
    request<PaperComparison>(
      'POST', '/query/compare', { documentIds, ...payload }),

  comparisons: (collectionId?: string) =>
    request<PaperComparison[]>('GET', '/query/comparisons', undefined, collectionId ? { collectionId } : undefined),

  generateLiteratureReview: (payload: { documentIds: string[]; collectionId?: string; topic?: string; title?: string }) =>
    request<LiteratureReview>('POST', '/query/literature-review', payload),

  literatureReviews: (collectionId?: string) =>
    request<LiteratureReview[]>('GET', '/query/literature-reviews', undefined, collectionId ? { collectionId } : undefined),

  literatureReview: (id: string) =>
    request<LiteratureReview>('GET', `/query/literature-reviews/${id}`),

  researchGaps: (payload: { documentIds?: string[]; collectionId?: string; topic?: string; maxGaps?: number }) =>
    request<ResearchGapAnalysis>('POST', '/query/research-gaps', payload),

  notes: (params?: { collectionId?: string; documentId?: string }) =>
    request<ResearchNote[]>('GET', '/query/notes', undefined, params),

  createNote: (payload: { title: string; content: string; collectionId?: string; documentId?: string; scopeType?: string; scopeId?: string }) =>
    request<ResearchNote>('POST', '/query/notes', payload),

  updateNote: (id: string, payload: { title?: string; content?: string }) =>
    request<ResearchNote>('PATCH', `/query/notes/${id}`, payload),

  deleteNote: (id: string) =>
    request<{ id: string }>('DELETE', `/query/notes/${id}`),

  exportLiteratureReviewUrl: (id: string, format: 'markdown' | 'pdf' = 'markdown') =>
    `${BASE_URL}/query/literature-reviews/${id}/export?format=${format}`,

  exportLiteratureReview: async (id: string, format: 'markdown' | 'pdf' = 'markdown', title = 'doclens-review') => {
    const token = tokenStorage.get();
    const res = await fetch(`${BASE_URL}/query/literature-reviews/${id}/export?format=${format}`, {
      headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    });
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      throw new ApiError(body?.message || `Export failed (HTTP ${res.status})`, res.status);
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const filename = `${title.replace(/[^a-z0-9-_]+/gi, '-').replace(/^-+|-+$/g, '') || 'doclens-review'}.${format === 'pdf' ? 'pdf' : 'md'}`;
    const a = Object.assign(document.createElement('a'), { href: url, download: filename });
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 1000);
    return filename;
  },

  pipelineStatus: (documentId: string) =>
    request<{ stage: string; progress_pct: number; error?: string }>('GET', `/query/status/${documentId}`),

  analytics: (timeZone?: string) => request<{ papersUploaded: number; collectionsCreated: number; queriesAsked: number; literatureReviews: number; queriesByDay?: Array<{ date: string; count: number }> }>('GET', `/query/analytics${timeZone ? `?tz=${encodeURIComponent(timeZone)}` : ''}`),
};


