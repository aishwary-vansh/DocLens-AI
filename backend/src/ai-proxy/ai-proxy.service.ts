// src/ai-proxy/ai-proxy.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class AiProxyService {
  private readonly logger = new Logger(AiProxyService.name);
  private readonly base: string;
  private readonly internalSecret: string;

  constructor(private readonly config: ConfigService) {
    this.base = this.config.get<string>('AI_SERVICE_URL') ?? 'http://localhost:8000';
    this.internalSecret = this.config.get<string>('INTERNAL_API_SECRET') ?? 'doclens-internal-secret';
  }

  // ── Ingest ──────────────────────────────────────────────────────────────

  async processDocument(documentId: string, filePath: string, collectionId: string) {
    return this.post('/ingest/process', {
      document_id: documentId,
      file_path: filePath,
      collection_id: collectionId,
    });
  }

  async getProcessingStatus(documentId: string) {
    return this.get(`/ingest/status/${documentId}`);
  }

  // ── Search ──────────────────────────────────────────────────────────────

  async semanticSearch(query: string, collectionId: string, topK = 5, documentIds?: string[]) {
    return this.post('/search', {
      query,
      collection_id: collectionId,
      top_k: topK,
      retrieval_mode: 'vector',
      document_ids: documentIds,
    });
  }

  async search(
    query: string,
    collectionId: string,
    topK = 5,
    retrievalMode: 'vector' = 'vector',
    documentIds?: string[],
  ) {
    return this.post('/search', {
      query,
      collection_id: collectionId,
      top_k: topK,
      retrieval_mode: retrievalMode,
      document_ids: documentIds,
    });
  }

  async chunkSearch(query: string, collectionId: string, topK = 8, documentIds?: string[]) {
    return this.post('/search', {
      query,
      collection_id: collectionId,
      top_k: topK,
      retrieval_mode: 'vector',
      document_ids: documentIds,
    });
  }

  // ── Query / RAG ─────────────────────────────────────────────────────────

  async ask(
    question: string,
    collectionId: string,
    sessionId?: string,
    topK = 5,
    retrievalMode: 'vector' = 'vector',
    documentIds?: string[],
  ) {
    return this.post('/query/ask', {
      question,
      collection_id: collectionId,
      session_id: sessionId,
      top_k: topK,
      retrieval_mode: retrievalMode,
      document_ids: documentIds,
    });
  }

  async summarise(documentId: string) {
    return this.post('/query/summarise', { document_id: documentId });
  }

  async compareDocuments(documentIds: string[], collectionId?: string, question?: string, topK = 12) {
    return this.post('/query/compare', {
      document_ids: documentIds,
      collection_id: collectionId,
      question,
      top_k: topK,
    });
  }

  // ── Graph ───────────────────────────────────────────────────────────────

  async getEntities(collectionId: string, type?: string, limit = 60) {
    const typeParam = type ? `&type=${encodeURIComponent(type)}` : '';
    return this.get(`/graph/entities?collection_id=${encodeURIComponent(collectionId)}&limit=${limit}${typeParam}`);
  }

  async expandEntity(entityName: string, collectionId: string, depth = 2) {
    return this.post('/graph/expand', {
      entity_name:   entityName,
      collection_id: collectionId,
      depth,
    });
  }

  async getInsights(collectionId: string) {
    return this.get(`/graph/insights?collection_id=${encodeURIComponent(collectionId)}`);
  }

  async discoverEntities(query: string, collectionId: string, limit = 20) {
    return this.get(
      `/graph/discover?collection_id=${encodeURIComponent(collectionId)}&query=${encodeURIComponent(query)}&limit=${limit}`,
    );
  }

  // ── Health ──────────────────────────────────────────────────────────────

  async health() {
    return this.get('/health');
  }

  // ── HTTP helpers ────────────────────────────────────────────────────────

  private async post<T = unknown>(path: string, body: unknown): Promise<T> {
    const url = `${this.base}${path}`;
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-internal-secret': this.internalSecret,
        },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`AI service error ${res.status}: ${text}`);
      }
      return res.json() as T;
    } catch (err: any) {
      this.logger.warn(`AI service POST ${path} failed: ${err.message}`);
      throw err;
    }
  }

  private async get<T = unknown>(path: string): Promise<T> {
    const url = `${this.base}${path}`;
    try {
      const res = await fetch(url, {
        headers: { 'x-internal-secret': this.internalSecret },
      });
      if (!res.ok) throw new Error(`AI service error ${res.status}`);
      return res.json() as T;
    } catch (err: any) {
      this.logger.warn(`AI service GET ${path} failed: ${err.message}`);
      throw err;
    }
  }
}
