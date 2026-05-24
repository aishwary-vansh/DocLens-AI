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

  const res = await fetch(`${BASE_URL}${path}${qs}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });

  const json = await res.json();

  if (!res.ok) {
    const msg = Array.isArray(json.message)
      ? json.message.join(', ')
      : json.message ?? 'Something went wrong';
    throw new ApiError(msg, res.status);
  }

  return json.data ?? json;
}

// ── Multipart request (for file uploads) ──────────────────────────────────
async function requestMultipart<T>(
  path: string,
  formData: FormData,
): Promise<T> {
  const token = tokenStorage.get();
  const res = await fetch(`${BASE_URL}${path}`, {
    method: 'POST',
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      // Do NOT set Content-Type — browser sets multipart boundary automatically
    },
    body: formData,
  });

  const json = await res.json();
  if (!res.ok) {
    const msg = Array.isArray(json.message)
      ? json.message.join(', ')
      : json.message ?? 'Upload failed';
    throw new ApiError(msg, res.status);
  }
  return json.data ?? json;
}

// ── Typed error ────────────────────────────────────────────────────────────
export class ApiError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
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

  updateProfile: (payload: { name?: string; password?: string }) =>
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

  upload: (file: File, collectionId: string) => {
    const form = new FormData();
    form.append('file', file);
    form.append('collectionId', collectionId);
    return requestMultipart<Document>('/documents/upload', form);
  },

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
}

export interface QueryPayload {
  question: string;
  collectionId: string;
  topK?: number;
  sessionId?: string;
  retrievalMode?: 'vector';
  documentIds?: string[];
}

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
    if (!res.ok) throw new ApiError('Export failed', res.status);
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = Object.assign(document.createElement('a'), {
      href: url,
      download: `${title.replace(/[^a-z0-9-_]+/gi, '-').replace(/^-+|-+$/g, '') || 'doclens-review'}.${format === 'pdf' ? 'pdf' : 'md'}`,
    });
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 1000);
  },

  pipelineStatus: (documentId: string) =>
    request<{ stage: string; progress_pct: number; error?: string }>('GET', `/query/status/${documentId}`),

  analytics: () => request<{ papersUploaded: number; collectionsCreated: number; queriesAsked: number; literatureReviews: number }>('GET', '/query/analytics'),
};


