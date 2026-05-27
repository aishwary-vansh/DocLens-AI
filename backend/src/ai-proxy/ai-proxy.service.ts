// src/ai-proxy/ai-proxy.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { readFile } from 'fs/promises';
import { basename } from 'path';

// The public URL of this NestJS backend — used as the callback target
// that the AI service POSTs status updates to.  Must be set to the
// Render service URL (e.g. https://doclens-hu8f.onrender.com/api/v1/internal/ai-callback)
// so the AI service can reach it.  Falls back to localhost for local dev.

@Injectable()
export class AiProxyService {
  private readonly logger = new Logger(AiProxyService.name);
  private readonly base: string;
  private readonly internalSecret: string;

  /** The public URL this NestJS backend is reachable at (used as AI-service callback). */
  private readonly callbackUrl: string;

  constructor(private readonly config: ConfigService) {
    this.base = this.config.get<string>('AI_SERVICE_URL') ?? 'http://localhost:8000';
    this.internalSecret = this.config.get<string>('INTERNAL_API_SECRET') ?? 'doclens-internal-secret';
    // NESTJS_CALLBACK_URL must be set in the Render environment to the full
    // public URL, e.g. https://doclens-hu8f.onrender.com/api/v1/internal/ai-callback
    this.callbackUrl =
      this.config.get<string>('NESTJS_CALLBACK_URL') ??
      'http://localhost:3001/api/v1/internal/ai-callback';
  }

  // ── Ingest ──────────────────────────────────────────────────────────────

  /**
   * Read the PDF from the local NestJS filesystem and forward it to the
   * AI service as multipart/form-data.  This avoids the assumption that
   * both services share a filesystem — critical on Render where each
   * service has its own ephemeral disk.
   */
  async processDocument(documentId: string, filePath: string, collectionId: string) {
    let fileBytes: Buffer;
    try {
      fileBytes = await readFile(filePath);
    } catch (err: any) {
      throw new Error(`NestJS could not read uploaded file at ${filePath}: ${err.message}`);
    }

    const filename = basename(filePath);
    this.logger.log(
      `Forwarding ${filename} (${fileBytes.length} bytes) to AI service for document ${documentId}. ` +
      `Callback URL: ${this.callbackUrl}`,
    );
    return this.postMultipart('/ingest/process', fileBytes, filename, {
      document_id: documentId,
      collection_id: collectionId,
      // Tell the AI service where to POST status updates back to.
      // This overrides whatever NESTJS_CALLBACK_URL is set on the AI service container.
      callback_url: this.callbackUrl,
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

  /**
   * POST a PDF as multipart/form-data together with extra form fields.
   * The browser-native FormData is not available in Node — we build the
   * multipart body manually so that no extra dependency is needed.
   */
  private async postMultipart<T = unknown>(
    path: string,
    fileBytes: Buffer,
    filename: string,
    fields: Record<string, string>,
  ): Promise<T> {
    const url = `${this.base}${path}`;
    const boundary = `----DocLensBoundary${Date.now()}`;

    const parts: Buffer[] = [];

    // Regular form fields
    for (const [key, value] of Object.entries(fields)) {
      parts.push(
        Buffer.from(
          `--${boundary}\r\nContent-Disposition: form-data; name="${key}"\r\n\r\n${value}\r\n`,
        ),
      );
    }

    // File field
    parts.push(
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: application/pdf\r\n\r\n`,
      ),
    );
    parts.push(fileBytes);
    parts.push(Buffer.from(`\r\n--${boundary}--\r\n`));

    const body = Buffer.concat(parts);

    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          // Do NOT set Content-Length — Node.js fetch computes it automatically.
          // Setting it manually on a Buffer body causes "Content-Length header not allowed" errors.
          'Content-Type': `multipart/form-data; boundary=${boundary}`,
          'x-internal-secret': this.internalSecret,
        },
        body,
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`AI service error ${res.status}: ${text}`);
      }
      return res.json() as T;
    } catch (err: any) {
      this.logger.warn(`AI service multipart POST ${path} failed: ${err.message}`);
      throw err;
    }
  }

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
