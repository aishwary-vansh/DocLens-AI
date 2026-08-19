// src/ai-proxy/ai-proxy.service.ts
import { Injectable, Logger, HttpException, HttpStatus } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class AiProxyService {
  private readonly logger = new Logger(AiProxyService.name);
  private readonly baseUrl: string;

  constructor(private readonly config: ConfigService) {
    this.baseUrl = this.config.get<string>('AI_SERVICE_URL') || 'http://localhost:8000';
  }

  private async request(endpoint: string, method: string, payload?: any) {
    try {
      const response = await fetch(`${this.baseUrl}${endpoint}`, {
        method,
        headers: {
          'Content-Type': 'application/json',
        },
        body: payload ? JSON.stringify(payload) : undefined,
      });

      if (!response.ok) {
        const errorText = await response.text();
        this.logger.error(`AI Service Error (${response.status}): ${errorText}`);
        throw new HttpException(errorText, response.status);
      }

      return await response.json();
    } catch (error) {
      this.logger.error(`Failed to connect to AI Service at ${this.baseUrl}${endpoint}: ${error.message}`);
      throw new HttpException('AI Service Unavailable', HttpStatus.SERVICE_UNAVAILABLE);
    }
  }

  // ── Ingest ──────────────────────────────────────────────────────────────

  async processDocument(documentId: string, filePath: string, collectionId: string) {
    this.logger.log(`Calling AI processing for document ${documentId}`);
    return this.request('/ingest', 'POST', { documentId, filePath, collectionId });
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
  ) {
    return this.request('/ask', 'POST', { question, collectionId, sessionId, topK, documentIds, history });
  }

  async summarise(documentId: string) {
    return this.request('/summarise', 'POST', { documentId });
  }

  async reviewDocument(documentId: string) {
    return this.request('/review', 'POST', { documentId });
  }

  async generateLiteratureReview(collectionId?: string, documentIds?: string[], topic?: string) {
    return this.request('/literature-review', 'POST', { collectionId, documentIds, topic });
  }

  async compareDocuments(documentIds: string[], collectionId?: string, question?: string, topK = 12) {
    return this.request('/compare', 'POST', { documentIds, collectionId, question, topK });
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
    return this.request('/health', 'GET');
  }
}
