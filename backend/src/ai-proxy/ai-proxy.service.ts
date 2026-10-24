// src/ai-proxy/ai-proxy.service.ts
import { Injectable, Logger, HttpException, HttpStatus } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';

// Node's built-in fetch (undici) gives up after 300 s without response headers,
// whatever AbortSignal timeout is set. /ingest and /embed answer only when the
// work is done (minutes on CPU), so calls allowed to run longer use node:http.
const FETCH_HEADERS_LIMIT_MS = 290_000;

@Injectable()
export class AiProxyService {
  private readonly logger = new Logger(AiProxyService.name);
  private readonly baseUrl: string;
  private readonly internalSecret?: string;

  constructor(private readonly config: ConfigService) {
    this.baseUrl = this.config.get<string>('AI_SERVICE_URL') || 'http://localhost:8000';
    const secret = (this.config.get<string>('INTERNAL_API_SECRET') || '').trim();
    this.internalSecret = secret && !secret.startsWith('REPLACE_WITH') ? secret : undefined;
  }

  /** Upper bound for one AI call. The AI service bounds Gemini at
   *  LLM_TIMEOUT_S x (1 + LLM_MAX_RETRIES); this sits above it and below nginx's 300 s. */
  private get timeoutMs() {
    return Number(this.config.get<string>('AI_REQUEST_TIMEOUT_MS') || 180_000);
  }

  /** Compare / literature review / gaps / review: per-paper retrieval under a rerank
   *  budget plus one long Gemini call (SYNTHESIS_LLM_TIMEOUT_S). Still below nginx's 300 s. */
  private get synthesisTimeoutMs() {
    return Number(this.config.get<string>('AI_SYNTHESIS_TIMEOUT_MS') || 280_000);
  }

  private headers() {
    return {
      'Content-Type': 'application/json',
      // The AI service rejects calls without this shared secret (when configured).
      ...(this.internalSecret ? { 'X-Internal-Secret': this.internalSecret } : {}),
    };
  }

  /** Abort on caller cancellation or after `timeoutMs`, whichever comes first. */
  private signalFor(timeoutMs: number, signal?: AbortSignal) {
    const timeout = AbortSignal.timeout(timeoutMs);
    return signal ? AbortSignal.any([signal, timeout]) : timeout;
  }

  private toHttpError(error: any, endpoint: string, signal?: AbortSignal): HttpException {
    // Keep the AI service's own status (400/500) instead of masking it as 503.
    if (error instanceof HttpException) return error;
    if (signal?.aborted) return new HttpException('Request cancelled', 499);
    if (error?.name === 'TimeoutError' || error?.name === 'AbortError') {
      this.logger.error(`AI Service timed out on ${endpoint}`);
      return new HttpException('The AI service did not answer in time. Please try again.', HttpStatus.GATEWAY_TIMEOUT);
    }
    this.logger.error(`Failed to connect to AI Service at ${this.baseUrl}${endpoint}: ${error?.message}`);
    return new HttpException('AI Service Unavailable', HttpStatus.SERVICE_UNAVAILABLE);
  }

  /** One JSON request over node:http(s): no 300 s header limit; `signal` bounds it. */
  private longRequest(endpoint: string, method: string, payload: unknown, signal: AbortSignal): Promise<any> {
    const url = new URL(`${this.baseUrl}${endpoint}`);
    const body = payload === undefined ? undefined : JSON.stringify(payload);
    const send = url.protocol === 'https:' ? httpsRequest : httpRequest;
    return new Promise((resolve, reject) => {
      const req = send(
        url,
        {
          method,
          signal,
          headers: { ...this.headers(), ...(body ? { 'Content-Length': Buffer.byteLength(body) } : {}) },
        },
        (res) => {
          const parts: Buffer[] = [];
          res.on('data', (part: Buffer) => parts.push(part));
          res.on('error', reject);
          res.on('end', () => {
            const text = Buffer.concat(parts).toString('utf8');
            const status = res.statusCode ?? 500;
            if (status < 200 || status >= 300) {
              this.logger.error(`AI Service Error (${status}): ${text}`);
              return reject(new HttpException(text, status));
            }
            try {
              resolve(text ? JSON.parse(text) : {});
            } catch (error) {
              reject(error);
            }
          });
        },
      );
      // An aborted node:http request rejects with AbortError; map the timeout
      // case to TimeoutError so toHttpError reports it as a 504.
      req.on('error', (error: any) =>
        reject(signal.aborted && signal.reason?.name === 'TimeoutError' ? signal.reason : error),
      );
      if (body) req.write(body);
      req.end();
    });
  }

  /** Connection refused/reset before any response: safe to retry a read-only call. */
  private isConnectionError(error: any) {
    const code = error?.cause?.code ?? error?.code;
    return ['ECONNREFUSED', 'ECONNRESET', 'EAI_AGAIN', 'UND_ERR_SOCKET'].includes(code);
  }

  private async request(
    endpoint: string,
    method: string,
    payload?: any,
    opts: { timeoutMs?: number; retry?: boolean; signal?: AbortSignal } = {},
  ) {
    // Bounded retry: one extra attempt, only for connection errors, only for
    // calls that write nothing (ingest/embed opt out).
    const attempts = opts.retry === false ? 1 : 2;
    const timeoutMs = opts.timeoutMs ?? this.timeoutMs;
    if (timeoutMs > FETCH_HEADERS_LIMIT_MS) {
      try {
        return await this.longRequest(endpoint, method, payload, this.signalFor(timeoutMs, opts.signal));
      } catch (error) {
        throw this.toHttpError(error, endpoint, opts.signal);
      }
    }
    for (let attempt = 1; ; attempt++) {
      try {
        const response = await fetch(`${this.baseUrl}${endpoint}`, {
          method,
          headers: this.headers(),
          body: payload ? JSON.stringify(payload) : undefined,
          signal: this.signalFor(timeoutMs, opts.signal),
        });

        if (!response.ok) {
          const errorText = await response.text();
          this.logger.error(`AI Service Error (${response.status}): ${errorText}`);
          throw new HttpException(errorText, response.status);
        }

        return await response.json();
      } catch (error) {
        if (attempt < attempts && this.isConnectionError(error) && !opts.signal?.aborted) {
          this.logger.warn(`AI Service connection failed on ${endpoint}; retrying once`);
          await new Promise((resolve) => setTimeout(resolve, 500));
          continue;
        }
        throw this.toHttpError(error, endpoint, opts.signal);
      }
    }
  }

  /**
   * POST /ask/stream and relay its Server-Sent Events: `onStage` gets each
   * pipeline stage; resolves with the final result, rejects on an `error` event.
   */
  async askStream(
    payload: Record<string, any>,
    onStage: (stage: string) => void,
    signal?: AbortSignal,
  ): Promise<any> {
    const endpoint = '/ask/stream';
    const combined = this.signalFor(this.timeoutMs, signal);
    try {
      const response = await fetch(`${this.baseUrl}${endpoint}`, {
        method: 'POST',
        headers: this.headers(),
        body: JSON.stringify(payload),
        signal: combined,
      });
      if (!response.ok || !response.body) {
        const errorText = await response.text();
        throw new HttpException(errorText || 'AI stream failed', response.status || 502);
      }
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
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
          else if (event === 'result') {
            await reader.cancel().catch(() => undefined);
            return parsed;
          } else if (event === 'error') throw new HttpException(parsed.detail || 'AI answer failed', HttpStatus.BAD_GATEWAY);
        }
      }
      throw new HttpException('AI stream ended without a result', HttpStatus.BAD_GATEWAY);
    } catch (error) {
      throw this.toHttpError(error, endpoint, signal);
    }
  }

  // ── Ingest ──────────────────────────────────────────────────────────────

  async processDocument(documentId: string, filePath: string, collectionId: string) {
    this.logger.log(`Calling AI processing for document ${documentId}`);
    // Parsing + profiling a long PDF can take minutes on CPU; never retried (it writes chunks).
    return this.request('/ingest', 'POST', { documentId, filePath, collectionId }, { timeoutMs: 900_000, retry: false });
  }

  async embedDocument(documentId: string) {
    this.logger.log(`Embedding chunks for document ${documentId}`);
    return this.request('/embed', 'POST', { documentId }, { timeoutMs: 900_000, retry: false });
  }

  async getProcessingStatus(documentId: string) {
    return this.request(`/status/${documentId}`, 'GET');
  }

  // ── Search ──────────────────────────────────────────────────────────────

  async semanticSearch(query: string, collectionId: string, topK = 5, documentIds?: string[]) {
    return this.request('/search/semantic', 'POST', { query, collectionId, topK, documentIds });
  }

  async search(
    query: string,
    collectionId: string,
    topK = 5,
    retrievalMode: 'vector' = 'vector',
    documentIds?: string[],
  ) {
    return this.request('/search', 'POST', { query, collectionId, topK, documentIds });
  }

  async hybridSearch(query: string, collectionId: string, topK = 20, documentIds?: string[]) {
    return this.request('/search/hybrid', 'POST', { query, collectionId, topK, documentIds });
  }

  async chunkSearch(query: string, collectionId: string, topK = 8, documentIds?: string[]) {
    return this.request('/search/chunk', 'POST', { query, collectionId, topK, documentIds });
  }

  // ── Query / RAG ─────────────────────────────────────────────────────────

  async ask(
    question: string,
    collectionId: string,
    sessionId?: string,
    topK = 5,
    retrievalMode: 'vector' = 'vector',
    documentIds?: string[],
    history?: any[],
    signal?: AbortSignal,
  ) {
    return this.request('/ask', 'POST', { question, collectionId, sessionId, topK, documentIds, history }, { signal });
  }

  async summarise(documentId: string) {
    return this.request('/summarise', 'POST', { documentId });
  }

  async reviewDocument(documentId: string) {
    return this.request('/review', 'POST', { documentId }, { timeoutMs: this.synthesisTimeoutMs });
  }

  async generateLiteratureReview(collectionId?: string, documentIds?: string[], topic?: string) {
    return this.request('/literature-review', 'POST', { collectionId, documentIds, topic }, { timeoutMs: this.synthesisTimeoutMs });
  }

  async compareDocuments(documentIds: string[], collectionId?: string, question?: string, topK = 12) {
    return this.request('/compare', 'POST', { documentIds, collectionId, question, topK }, { timeoutMs: this.synthesisTimeoutMs });
  }

  async researchGaps(collectionId?: string, documentIds?: string[], topic?: string, maxGaps = 8) {
    return this.request('/research-gaps', 'POST', { collectionId, documentIds, topic, maxGaps }, { timeoutMs: this.synthesisTimeoutMs });
  }

  // ── Graph ───────────────────────────────────────────────────────────────

  async getEntities(collectionId: string, type?: string, limit = 60) {
    return this.request('/graph/entities', 'POST', { collectionId, type, limit });
  }

  async expandEntity(entityName: string, collectionId: string, depth = 2) {
    return this.request('/graph/expand', 'POST', { entityName, collectionId, depth });
  }

  async getInsights(collectionId: string) {
    return this.request('/graph/insights', 'POST', { collectionId });
  }

  async discoverEntities(query: string, collectionId: string, limit = 20) {
    return this.request('/graph/discover', 'POST', { query, collectionId, limit });
  }

  // ── Health ──────────────────────────────────────────────────────────────

  async health() {
    // Short timeout: status lights poll this; a hung AI service must not hold requests open.
    return this.request('/health', 'GET', undefined, { timeoutMs: 5_000, retry: false });
  }
}
