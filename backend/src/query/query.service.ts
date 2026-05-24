import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { AiProxyService } from '../ai-proxy/ai-proxy.service';
import { PrismaService } from '../prisma/prisma.service';

type RetrievalMode = 'vector';

type Evidence = {
  chunkId: string;
  documentId: string;
  documentTitle: string;
  pageNumber?: number;
  chunkIndex: number;
  chunk: string;
  score: number;
};

type CitationDto = Evidence & {
  retrievalPath?: string[];
};

type ReviewSection = {
  heading: string;
  content: string;
  citations: CitationDto[];
};

const STOPWORDS = new Set([
  'about', 'after', 'again', 'also', 'among', 'and', 'are', 'been', 'being', 'between',
  'could', 'does', 'from', 'have', 'into', 'main', 'more', 'paper', 'papers', 'research',
  'show', 'that', 'the', 'their', 'there', 'these', 'this', 'those', 'used', 'using',
  'what', 'when', 'where', 'which', 'with', 'were',
]);

const REVIEW_BLUEPRINT: Array<{ key: string; heading: string; focus: string; keywords: string[] }> = [
  {
    key: 'introduction',
    heading: 'Introduction',
    focus: 'problem motivation contribution abstract introduction',
    keywords: ['problem', 'motivation', 'contribution', 'propose', 'introduce', 'study'],
  },
  {
    key: 'existingApproaches',
    heading: 'Existing Approaches',
    focus: 'existing prior related work baseline approach',
    keywords: ['existing', 'prior', 'related work', 'baseline', 'approach'],
  },
  {
    key: 'commonMethodologies',
    heading: 'Common Methodologies',
    focus: 'method methodology model architecture training algorithm',
    keywords: ['method', 'methodology', 'model', 'architecture', 'training', 'algorithm'],
  },
  {
    key: 'keyFindings',
    heading: 'Key Findings',
    focus: 'results findings performance evaluation improvement',
    keywords: ['result', 'finding', 'performance', 'evaluation', 'improve', 'outperform'],
  },
  {
    key: 'limitations',
    heading: 'Limitations',
    focus: 'limitations weakness challenge however',
    keywords: ['limitation', 'however', 'challenge', 'weakness', 'fail', 'cost'],
  },
  {
    key: 'researchGaps',
    heading: 'Research Gaps',
    focus: 'research gap open problem challenge missing future work',
    keywords: ['gap', 'open', 'challenge', 'missing', 'future work', 'unexplored'],
  },
  {
    key: 'futureDirections',
    heading: 'Future Directions',
    focus: 'future work future direction improve extend',
    keywords: ['future', 'future work', 'direction', 'extend', 'improve', 'next'],
  },
];

@Injectable()
export class QueryService {
  private readonly logger = new Logger(QueryService.name);

  constructor(
    private readonly ai: AiProxyService,
    private readonly prisma: PrismaService,
  ) {}

  async ask(
    question: string,
    collectionId: string,
    userId: string,
    sessionId?: string,
    topK = 5,
    retrievalMode: RetrievalMode = 'vector',
    documentIds?: string[],
  ) {
    if (!question?.trim()) throw new BadRequestException('Question is required');
    await this.assertCollectionAccess(collectionId, userId);

    const session = await this.resolveChatSession(userId, collectionId, sessionId, question);
    const evidence = await this.retrieveEvidence(question, collectionId, userId, topK, documentIds);
    if (!evidence.length) {
      throw new BadRequestException(
        'No citation-backed evidence was found. Upload indexed papers before asking this question.',
      );
    }

    const startedAt = Date.now();
    let answer = '';
    let citations = this.citationsFromEvidence(evidence);
    let modelUsed = 'extractive-citation-fallback';

    try {
      const raw: any = await this.ai.ask(
        question,
        collectionId,
        session.id,
        topK,
        'vector',
        documentIds,
      );
      const rawCitations = await this.normalizeAiCitations(raw.citations ?? [], evidence);
      citations = rawCitations.length ? rawCitations : citations;
      answer = String(raw.answer ?? raw.content ?? '').trim();
      modelUsed = raw.model_used ?? modelUsed;
    } catch (err: any) {
      this.logger.warn('AI ask failed; using citation-backed local answer: %s', err.message);
    }

    if (!answer) answer = this.composeAnswer(question, evidence);
    answer = this.ensureAnswerHasCitationRefs(answer, citations);

    const query = await this.persistQuery({
      sessionId: session.id,
      question,
      answer,
      modelUsed,
      processingMs: Date.now() - startedAt,
      retrievalMode,
      rawRequest: { topK, documentIds },
      citations,
    });

    return {
      id: query.id,
      role: 'assistant' as const,
      content: answer,
      citations,
      timestamp: new Date().toISOString(),
      latency_ms: Date.now() - startedAt,
      model_used: modelUsed,
      retrieval_mode: retrievalMode,
      session_id: session.id,
    };
  }

  async listSessions(userId: string, collectionId?: string) {
    const sessions = await this.prisma.chatSession.findMany({
      where: {
        userId,
        ...(collectionId ? { scopeId: collectionId, scopeType: 'collection' } : {}),
      },
      include: {
        queries: {
          orderBy: { createdAt: 'desc' },
          take: 1,
          include: { citations: true },
        },
      },
      orderBy: { updatedAt: 'desc' },
      take: 50,
    });

    return sessions.map((session) => ({
      id: session.id,
      title: session.title,
      scopeType: session.scopeType,
      scopeId: session.scopeId,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
      latestMessage: session.queries[0]?.answer ?? session.queries[0]?.question ?? null,
      citationCount: session.queries[0]?.citations?.length ?? 0,
    }));
  }

  async getSession(sessionId: string, userId: string) {
    const session = await this.prisma.chatSession.findFirst({
      where: { id: sessionId, userId },
      include: {
        queries: {
          orderBy: { createdAt: 'asc' },
          include: {
            citations: {
              include: {
                chunk: {
                  include: { document: true },
                },
              },
            },
          },
        },
      },
    });
    if (!session) throw new NotFoundException('Chat session not found');

    return {
      id: session.id,
      title: session.title,
      scopeType: session.scopeType,
      scopeId: session.scopeId,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
      messages: session.queries.flatMap((query) => [
        {
          id: `${query.id}:question`,
          role: 'user',
          content: query.question,
          timestamp: query.createdAt,
          citations: [],
        },
        {
          id: query.id,
          role: 'assistant',
          content: query.answer ?? '',
          timestamp: query.createdAt,
          citations: query.citations.map((citation) => ({
            chunkId: citation.chunkId,
            documentId: citation.chunk.documentId,
            documentTitle: citation.documentTitle ?? citation.chunk.document.title,
            pageNumber: citation.pageNumber ?? citation.chunk.pageNumber,
            chunkIndex: citation.chunk.chunkIndex,
            chunk: citation.sourceText ?? citation.chunk.content.slice(0, 700),
            score: citation.relevance ?? 0,
            retrievalPath: ['postgres-chunks'],
          })),
        },
      ]),
    };
  }

  async search(
    query: string,
    collectionId: string,
    topK = 5,
    retrievalMode: RetrievalMode = 'vector',
    documentIds?: string[],
    userId?: string,
  ) {
    if (userId) await this.assertCollectionAccess(collectionId, userId);
    const evidence = await this.retrieveEvidence(query, collectionId, userId, topK, documentIds);
    return {
      results: evidence.map((item) => ({
        chunk: item.chunk,
        chunk_text: item.chunk,
        score: item.score,
        documentId: item.documentId,
        document_id: item.documentId,
        documentTitle: item.documentTitle,
        document_title: item.documentTitle,
        pageNumber: item.pageNumber,
        page_number: item.pageNumber,
        chunkIndex: item.chunkIndex,
        chunk_index: item.chunkIndex,
        chunkId: item.chunkId,
        retrievalPath: ['postgres-chunks'],
      })),
      query,
      total: evidence.length,
      retrieval_mode: retrievalMode,
    };
  }

  async summarise(documentId: string, userId?: string) {
    const document = await this.prisma.document.findFirst({
      where: {
        id: documentId,
        ...(userId ? { collection: { workspace: { userId } } } : {}),
      },
      include: {
        chunks: { orderBy: { chunkIndex: 'asc' }, take: 8 },
      },
    });
    if (!document) throw new NotFoundException('Document not found');
    if (!document.chunks.length) {
      throw new BadRequestException('This paper has no indexed chunks to summarize.');
    }

    const evidence = document.chunks.slice(0, 5).map((chunk, index) => ({
      chunkId: chunk.id,
      documentId: document.id,
      documentTitle: document.title,
      pageNumber: chunk.pageNumber,
      chunkIndex: chunk.chunkIndex,
      chunk: this.snippet(chunk.content, 700),
      score: Number((0.95 - index * 0.05).toFixed(2)),
    }));

    return {
      document_id: documentId,
      summary: this.ensureAnswerHasCitationRefs(this.composeAnswer('Summarize this paper', evidence), evidence),
      citations: this.citationsFromEvidence(evidence),
    };
  }

  async compare(
    documentIds: string[],
    collectionId: string | undefined,
    question: string | undefined,
    topK = 12,
    userId?: string,
  ) {
    if (!documentIds?.length || documentIds.length < 2) {
      throw new BadRequestException('Select at least two papers to compare.');
    }

    const documents = await this.getAccessibleDocuments(documentIds, userId);
    const resolvedCollectionId = collectionId ?? documents[0]?.collectionId;
    if (userId && resolvedCollectionId) await this.assertCollectionAccess(resolvedCollectionId, userId);

    const title = this.comparisonTitle(documents, question);
    let result: any;
    
    try {
      result = await this.ai.compareDocuments(documentIds, resolvedCollectionId, question, topK);
      if (result.citations) {
        result.citations = await this.normalizeAiCitations(result.citations, []);
      }
    } catch (e) {
      this.logger.warn(`AI compare failed, falling back to local: ${e}`);
      const evidence = await this.retrieveEvidenceForDocuments(
        documentIds,
        userId,
        question || 'methodology datasets strengths weaknesses findings limitations future work',
        topK,
      );
      if (!evidence.length) {
        throw new BadRequestException('No citation-backed chunks were found for the selected papers.');
      }
      const sections = {
        methods: this.sectionBullets(evidence, ['method', 'methodology', 'model', 'architecture', 'algorithm', 'training'], 5),
        datasets: this.sectionBullets(evidence, ['dataset', 'corpus', 'benchmark', 'data', 'samples'], 5),
        strengths: this.sectionBullets(evidence, ['outperform', 'improve', 'effective', 'robust', 'advantage', 'better'], 5),
        weaknesses: this.sectionBullets(evidence, ['limitation', 'however', 'challenge', 'weakness', 'cost', 'fail'], 5),
        findings: this.sectionBullets(evidence, ['finding', 'result', 'performance', 'show', 'demonstrate', 'evaluation'], 5),
        futureWork: this.sectionBullets(evidence, ['future', 'future work', 'extend', 'direction', 'open'], 5),
      };
      result = {
        methods: sections.methods.map((item) => item.text),
        datasets: sections.datasets.map((item) => item.text),
        strengths: sections.strengths.map((item) => item.text),
        weaknesses: sections.weaknesses.map((item) => item.text),
        findings: sections.findings.map((item) => item.text),
        futureWork: sections.futureWork.map((item) => item.text),
        narrative: this.ensureAnswerHasCitationRefs(
          `Compared ${documents.length} papers across methods, datasets, strengths, weaknesses, findings, and future work.`,
          this.citationsFromEvidence(evidence.slice(0, 5))
        ),
        sections,
        citations: this.citationsFromEvidence(evidence.slice(0, 5)),
      };
    }

    const finalResult = {
      title,
      question: question || 'Compare methodologies, datasets, strengths, weaknesses, findings, and future work.',
      documentIds,
      documentTitles: documents.map((document) => document.title),
      ...result,
    };

    let saved: any = null;
    if (userId) {
      saved = await this.prisma.paperComparison.create({
        data: {
          title,
          question: finalResult.question,
          documentIds,
          result: finalResult as any,
          markdown: finalResult.narrative || this.markdownForComparison(finalResult),
          userId,
          collectionId: resolvedCollectionId,
        },
      });
    }

    return {
      id: saved?.id,
      createdAt: saved?.createdAt,
      ...finalResult,
    };
  }

  async listComparisons(userId: string, collectionId?: string) {
    return this.prisma.paperComparison.findMany({
      where: { userId, ...(collectionId ? { collectionId } : {}) },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
  }

  async generateLiteratureReview(input: {
    documentIds: string[];
    collectionId?: string;
    topic?: string;
    title?: string;
    userId: string;
  }) {
    if (!input.documentIds?.length) throw new BadRequestException('Select papers for the literature review.');
    const documents = await this.getAccessibleDocuments(input.documentIds, input.userId);
    const collectionId = input.collectionId ?? documents[0]?.collectionId;
    if (collectionId) await this.assertCollectionAccess(collectionId, input.userId);

    const sections: Record<string, ReviewSection> = {};
    const allCitations: CitationDto[] = [];

    for (const spec of REVIEW_BLUEPRINT) {
      let content = '';
      let citations: CitationDto[] = [];
      const queryStr = `${input.topic || ''} ${spec.focus}`;

      try {
        const prompt = `Write a comprehensive literature review section titled "${spec.heading}" focusing on: ${spec.focus}. Synthesize the findings across the provided papers context. Do not dump chunks, explain the concepts clearly.`;
        const response: any = await this.ai.ask(prompt, collectionId, undefined, 7, 'vector', input.documentIds);
        content = response.answer;
        citations = await this.normalizeAiCitations(response.citations ?? [], []);
      } catch (e) {
        this.logger.warn(`AI summarize for ${spec.heading} failed, falling back: ${e}`);
        const evidence = await this.retrieveEvidenceForDocuments(input.documentIds, input.userId, queryStr, 7);
        const selected = this.preferKeywordEvidence(evidence, spec.keywords, 3);
        content = this.sectionParagraph(spec.heading, selected, spec.keywords);
        citations = this.citationsFromEvidence(selected);
      }

      if (!content.trim()) {
        content = `No sufficient information was found in the selected papers to synthesize the ${spec.heading} section.`;
      }

      allCitations.push(...citations);
      sections[spec.key] = {
        heading: spec.heading,
        content,
        citations,
      };
    }

    const title = input.title?.trim() || `${input.topic?.trim() || 'Research'} Literature Review`;
    const uniqueCitations = this.uniqueCitations(allCitations);
    const payload = {
      title,
      topic: input.topic,
      documentIds: input.documentIds,
      documentTitles: documents.map((document) => document.title),
      sections,
      citations: uniqueCitations,
    };
    const markdown = this.markdownForReview(payload);
    const saved = await this.prisma.literatureReview.create({
      data: {
        title,
        topic: input.topic,
        documentIds: input.documentIds,
        sections: sections as any,
        markdown,
        userId: input.userId,
        collectionId,
      },
    });

    return { id: saved.id, createdAt: saved.createdAt, ...payload, markdown };
  }

  async listLiteratureReviews(userId: string, collectionId?: string) {
    return this.prisma.literatureReview.findMany({
      where: { userId, ...(collectionId ? { collectionId } : {}) },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
  }

  async getLiteratureReview(id: string, userId: string) {
    const review = await this.prisma.literatureReview.findFirst({ where: { id, userId } });
    if (!review) throw new NotFoundException('Literature review not found');
    return review;
  }

  async listNotes(userId: string, collectionId?: string, documentId?: string) {
    return this.prisma.researchNote.findMany({
      where: {
        userId,
        ...(collectionId ? { collectionId } : {}),
        ...(documentId ? { documentId } : {}),
      },
      orderBy: { updatedAt: 'desc' },
      take: 100,
    });
  }

  async createNote(input: {
    userId: string;
    title: string;
    content: string;
    collectionId?: string;
    documentId?: string;
    scopeType?: string;
    scopeId?: string;
  }) {
    if (!input.title?.trim()) throw new BadRequestException('Note title is required');
    if (!input.content?.trim()) throw new BadRequestException('Note content is required');
    if (input.collectionId) await this.assertCollectionAccess(input.collectionId, input.userId);
    if (input.documentId) await this.getAccessibleDocuments([input.documentId], input.userId);

    const scopeType = input.scopeType ?? (input.documentId ? 'document' : 'collection');
    const scopeId = input.scopeId ?? input.documentId ?? input.collectionId;
    if (!scopeId) throw new BadRequestException('A note must be linked to a collection or document.');

    return this.prisma.researchNote.create({
      data: {
        userId: input.userId,
        title: input.title.trim(),
        content: input.content.trim(),
        collectionId: input.collectionId,
        documentId: input.documentId,
        scopeType,
        scopeId,
      },
    });
  }

  async updateNote(id: string, userId: string, input: { title?: string; content?: string }) {
    const note = await this.prisma.researchNote.findFirst({ where: { id, userId } });
    if (!note) throw new NotFoundException('Note not found');
    return this.prisma.researchNote.update({
      where: { id },
      data: {
        ...(input.title !== undefined ? { title: input.title.trim() } : {}),
        ...(input.content !== undefined ? { content: input.content.trim() } : {}),
      },
    });
  }

  async deleteNote(id: string, userId: string) {
    const note = await this.prisma.researchNote.findFirst({ where: { id, userId } });
    if (!note) throw new NotFoundException('Note not found');
    await this.prisma.researchNote.delete({ where: { id } });
    return { id };
  }

  async exportLiteratureReview(id: string, userId: string, format: 'markdown' | 'pdf' = 'markdown') {
    const review = await this.getLiteratureReview(id, userId);
    if (format === 'pdf') {
      return {
        filename: `${this.safeFilename(review.title)}.pdf`,
        contentType: 'application/pdf',
        body: this.renderSimplePdf(review.title, review.markdown),
      };
    }

    return {
      filename: `${this.safeFilename(review.title)}.md`,
      contentType: 'text/markdown; charset=utf-8',
      body: Buffer.from(review.markdown, 'utf8'),
    };
  }

  async pipelineStatus(documentId: string) {
    const job = await this.prisma.processingJob.findFirst({
      where: { documentId },
      orderBy: { createdAt: 'desc' },
    });
    if (job) {
      return {
        document_id: documentId,
        stage: job.stage,
        progress_pct: job.progress,
        error: job.errorMessage,
        status: job.status,
      };
    }

    try {
      return await this.ai.getProcessingStatus(documentId);
    } catch {
      return { document_id: documentId, stage: 'UNKNOWN', progress_pct: 0 };
    }
  }

  async getAnalytics(userId: string) {
    const papersUploaded = await this.prisma.document.count({
      where: { collection: { workspace: { userId } } },
    });
    const collectionsCreated = await this.prisma.collection.count({
      where: { workspace: { userId } },
    });
    const queriesAsked = await this.prisma.query.count({
      where: { chatSession: { userId } },
    });
    const literatureReviews = await this.prisma.literatureReview.count({
      where: { userId },
    });
    return {
      papersUploaded,
      collectionsCreated,
      queriesAsked,
      literatureReviews,
    };
  }

  private async assertCollectionAccess(collectionId: string, userId: string) {
    const collection = await this.prisma.collection.findFirst({
      where: { id: collectionId, workspace: { userId } },
    });
    if (!collection) throw new ForbiddenException('Collection not found or access denied');
    return collection;
  }

  private async getAccessibleDocuments(documentIds: string[], userId?: string) {
    const documents = await this.prisma.document.findMany({
      where: {
        id: { in: documentIds },
        ...(userId ? { collection: { workspace: { userId } } } : {}),
      },
      orderBy: { createdAt: 'asc' },
    });

    if (documents.length !== documentIds.length) {
      throw new ForbiddenException('One or more selected papers are not accessible.');
    }
    return documents;
  }

  private async retrieveEvidence(
    query: string,
    collectionId: string,
    userId?: string,
    topK = 5,
    documentIds?: string[],
  ): Promise<Evidence[]> {
    const chunks = await this.prisma.documentChunk.findMany({
      where: {
        content: { not: '' },
        document: {
          collectionId,
          ...(documentIds?.length ? { id: { in: documentIds } } : {}),
          ...(userId ? { collection: { workspace: { userId } } } : {}),
        },
      },
      include: { document: true },
      orderBy: { chunkIndex: 'asc' },
      take: 2000,
    });

    return this.rankChunks(query, chunks, topK);
  }

  private async retrieveEvidenceForDocuments(
    documentIds: string[],
    userId: string | undefined,
    query: string,
    topK = 12,
  ): Promise<Evidence[]> {
    const chunks = await this.prisma.documentChunk.findMany({
      where: {
        content: { not: '' },
        document: {
          id: { in: documentIds },
          ...(userId ? { collection: { workspace: { userId } } } : {}),
        },
      },
      include: { document: true },
      orderBy: { chunkIndex: 'asc' },
      take: 3000,
    });

    const ranked = this.rankChunks(query, chunks, topK * 2);
    const byDocument = new Map<string, Evidence[]>();
    for (const item of ranked) {
      const bucket = byDocument.get(item.documentId) ?? [];
      if (bucket.length < Math.max(2, Math.ceil(topK / documentIds.length))) bucket.push(item);
      byDocument.set(item.documentId, bucket);
    }
    return [...byDocument.values()].flat().slice(0, topK);
  }

  private rankChunks(query: string, chunks: any[], topK: number): Evidence[] {
    const terms = this.tokenize(query);
    const lowerQuery = query.toLowerCase();

    const isSummary = /summary|overview|contribution|motivation|objective/i.test(lowerQuery);
    const isMethod = /method|architecture|approach/i.test(lowerQuery);
    const isLimit = /limitation|future work/i.test(lowerQuery);

    const scored = chunks.map((chunk, index) => {
      const lower = chunk.content.toLowerCase();
      const matched = terms.filter((term) => lower.includes(term));
      const exactBoost = query.length > 8 && lower.includes(lowerQuery) ? 0.25 : 0;
      
      let heuristicBoost = 0;
      if (isSummary && (lower.includes('abstract') || lower.includes('introduction') || chunk.chunkIndex < 5)) {
        heuristicBoost += 0.3;
      }
      if (isMethod && (lower.includes('methodology') || lower.includes('model') || lower.includes('architecture'))) {
        heuristicBoost += 0.3;
      }
      if (isLimit && (lower.includes('conclusion') || lower.includes('discussion') || lower.includes('limitation') || lower.includes('future work'))) {
        heuristicBoost += 0.3;
      }

      const score = terms.length
        ? matched.length / Math.max(terms.length, 1) + exactBoost + heuristicBoost + Math.max(0, 0.08 - index * 0.00001)
        : 0.5 - index * 0.00001 + heuristicBoost;
      return {
        chunkId: chunk.id,
        documentId: chunk.documentId,
        documentTitle: chunk.document?.title ?? 'Untitled paper',
        pageNumber: chunk.pageNumber,
        chunkIndex: chunk.chunkIndex,
        chunk: this.snippet(chunk.content, 850),
        score: Number(Math.max(0.05, Math.min(0.99, score)).toFixed(4)),
      };
    });

    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, topK);
  }

  private tokenize(value: string): string[] {
    const terms = value
      .toLowerCase()
      .match(/[a-z][a-z0-9-]{2,}/g) ?? [];
    return [...new Set(terms.filter((term) => !STOPWORDS.has(term)))].slice(0, 24);
  }

  private composeAnswer(question: string, evidence: Evidence[]): string {
    const lower = question.toLowerCase();
    const keywords = lower.includes('dataset')
      ? ['dataset', 'data', 'corpus', 'benchmark']
      : lower.includes('method')
        ? ['method', 'methodology', 'model', 'architecture', 'training']
        : lower.includes('limit')
          ? ['limitation', 'however', 'challenge', 'future work']
          : lower.includes('future')
            ? ['future', 'future work', 'extend', 'direction']
            : ['contribution', 'propose', 'result', 'show', 'approach'];

    const bullets = this.sectionBullets(evidence, keywords, 3);
    if (!bullets.length) {
      return evidence
        .slice(0, 3)
        .map((item, index) => `Evidence ${index + 1}: ${this.bestSentence(item.chunk, keywords)} [${index + 1}]`)
        .join('\n');
    }

    return bullets.map((item, index) => `${item.text} [${index + 1}]`).join('\n');
  }

  private sectionBullets(evidence: Evidence[], keywords: string[], limit: number) {
    return this.preferKeywordEvidence(evidence, keywords, limit).map((item, index) => ({
      text: this.bestSentence(item.chunk, keywords),
      citations: [this.citationsFromEvidence([item])[0]],
      citationRef: index + 1,
    }));
  }

  private sectionParagraph(heading: string, evidence: Evidence[], keywords: string[]) {
    const sentences = evidence.slice(0, 3).map((item, index) => {
      const sentence = this.bestSentence(item.chunk, keywords);
      return `${sentence} [${index + 1}]`;
    });
    return `${heading}: ${sentences.join(' ')}`;
  }

  private preferKeywordEvidence(evidence: Evidence[], keywords: string[], limit: number) {
    const lowered = keywords.map((keyword) => keyword.toLowerCase());
    const preferred = evidence.filter((item) => {
      const text = item.chunk.toLowerCase();
      return lowered.some((keyword) => text.includes(keyword));
    });
    return (preferred.length ? preferred : evidence).slice(0, limit);
  }

  private bestSentence(text: string, keywords: string[]) {
    const sentences = text
      .replace(/\s+/g, ' ')
      .split(/(?<=[.!?])\s+/)
      .map((sentence) => sentence.trim())
      .filter((sentence) => sentence.length >= 40);
    const lowerKeywords = keywords.map((keyword) => keyword.toLowerCase());
    const selected = sentences.find((sentence) => {
      const lower = sentence.toLowerCase();
      return lowerKeywords.some((keyword) => lower.includes(keyword));
    }) ?? sentences[0] ?? text;
    return this.snippet(selected, 320);
  }

  private citationsFromEvidence(evidence: Evidence[]): CitationDto[] {
    return evidence.map((item) => ({
      ...item,
      retrievalPath: ['postgres-chunks'],
    }));
  }

  private async normalizeAiCitations(raw: any[], fallback: Evidence[]): Promise<CitationDto[]> {
    const citations: CitationDto[] = [];

    for (const citation of raw) {
      const documentId = citation.document_id ?? citation.documentId;
      const chunkIndex = citation.chunk_index ?? citation.chunkIndex;
      if (!documentId || chunkIndex === undefined) continue;

      const chunk = await this.prisma.documentChunk.findUnique({
        where: { documentId_chunkIndex: { documentId, chunkIndex } },
        include: { document: true },
      });
      if (!chunk) continue;

      citations.push({
        chunkId: chunk.id,
        documentId,
        documentTitle: citation.document_title ?? citation.documentTitle ?? chunk.document.title,
        pageNumber: citation.page_number ?? citation.pageNumber ?? chunk.pageNumber,
        chunkIndex,
        chunk: citation.chunk_text ?? citation.chunk ?? this.snippet(chunk.content, 850),
        score: Number(citation.score ?? 0.8),
        retrievalPath: citation.retrieval_path ?? citation.retrievalPath ?? ['vector'],
      });
    }

    return citations.length ? citations : this.citationsFromEvidence(fallback);
  }

  private ensureAnswerHasCitationRefs(answer: string, citations: CitationDto[] | Evidence[]) {
    if (!citations.length) return '';
    if (/\[\d+\]/.test(answer)) return answer;
    return `${answer.trim()} [1]`;
  }

  private async resolveChatSession(
    userId: string,
    collectionId: string,
    sessionId: string | undefined,
    question: string,
  ) {
    if (sessionId) {
      const existing = await this.prisma.chatSession.findFirst({
        where: { id: sessionId, userId },
      });
      if (existing) return existing;
    }

    return this.prisma.chatSession.create({
      data: {
        userId,
        scopeType: 'collection',
        scopeId: collectionId,
        title: question.slice(0, 80),
      },
    });
  }

  private async persistQuery(input: {
    sessionId: string;
    question: string;
    answer: string;
    modelUsed?: string;
    processingMs?: number;
    retrievalMode: string;
    rawRequest: unknown;
    citations: CitationDto[];
  }) {
    if (!input.citations.length) {
      throw new BadRequestException('Citation-backed answers require at least one source citation.');
    }

    const query = await this.prisma.query.create({
      data: {
        chatSessionId: input.sessionId,
        question: input.question,
        answer: input.answer,
        modelUsed: input.modelUsed,
        processingMs: input.processingMs,
        retrievalMode: input.retrievalMode,
        rawRequest: input.rawRequest as any,
      },
    });

    await this.prisma.chatSession.update({
      where: { id: input.sessionId },
      data: { updatedAt: new Date(), title: input.question.slice(0, 80) },
    });

    for (const citation of input.citations) {
      await this.prisma.citation.create({
        data: {
          queryId: query.id,
          chunkId: citation.chunkId,
          relevance: citation.score,
          pageNumber: citation.pageNumber,
          documentTitle: citation.documentTitle,
          sourceText: citation.chunk,
        },
      });
    }

    return query;
  }

  private uniqueCitations(citations: CitationDto[]) {
    const byChunk = new Map<string, CitationDto>();
    for (const citation of citations) byChunk.set(citation.chunkId, citation);
    return [...byChunk.values()];
  }

  private comparisonTitle(documents: any[], question?: string) {
    if (question?.trim()) return question.trim().slice(0, 120);
    const names = documents.map((document) => document.title).slice(0, 3);
    return `Comparison: ${names.join(' vs ')}`;
  }

  private markdownForComparison(result: any) {
    const lines = [`# ${result.title}`, '', result.narrative, ''];
    for (const [key, label] of [
      ['methods', 'Methods'],
      ['datasets', 'Datasets'],
      ['strengths', 'Strengths'],
      ['weaknesses', 'Weaknesses'],
      ['findings', 'Findings'],
      ['futureWork', 'Future Work'],
    ] as const) {
      lines.push(`## ${label}`);
      const items = result.sections?.[key] ?? [];
      if (!items.length) lines.push('- No citation-backed evidence found.');
      for (const item of items) lines.push(`- ${item.text}`);
      lines.push('');
    }
    lines.push('## Citations');
    for (const [index, citation] of result.citations.entries()) {
      lines.push(`${index + 1}. ${citation.documentTitle}, page ${citation.pageNumber ?? 'n/a'}: ${citation.chunk}`);
    }
    return lines.join('\n');
  }

  private markdownForReview(review: any) {
    const lines = [`# ${review.title}`, ''];
    if (review.topic) lines.push(`Topic: ${review.topic}`, '');
    for (const spec of REVIEW_BLUEPRINT) {
      const section = review.sections[spec.key];
      lines.push(`## ${section.heading}`, '', section.content, '');
    }
    lines.push('## Sources');
    for (const [index, citation] of review.citations.entries()) {
      lines.push(`${index + 1}. ${citation.documentTitle}, page ${citation.pageNumber ?? 'n/a'}: ${citation.chunk}`);
    }
    return lines.join('\n');
  }

  private snippet(value: string, limit: number) {
    const normalized = value.replace(/\s+/g, ' ').trim();
    if (normalized.length <= limit) return normalized;
    return `${normalized.slice(0, limit - 1).trim()}...`;
  }

  private safeFilename(value: string) {
    return value.replace(/[^a-z0-9-_]+/gi, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'doclens-review';
  }

  private renderSimplePdf(title: string, markdown: string): Buffer {
    const escapePdf = (value: string) => value.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
    const lines = markdown
      .replace(/^#+\s*/gm, '')
      .split('\n')
      .flatMap((line) => {
        const clean = line.trim();
        if (!clean) return [''];
        const chunks = clean.match(/.{1,92}(\s|$)/g);
        return chunks?.map((chunk) => chunk.trim()) ?? [clean];
      })
      .slice(0, 220);

    const contentLines = ['BT', '/F1 12 Tf', '50 780 Td', `(${escapePdf(title)}) Tj`, '0 -24 Td'];
    for (const line of lines) {
      if (!line) {
        contentLines.push('0 -12 Td');
      } else {
        contentLines.push(`(${escapePdf(line)}) Tj`, '0 -16 Td');
      }
    }
    contentLines.push('ET');
    const stream = contentLines.join('\n');

    const objects = [
      '1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj',
      '2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj',
      '3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >> endobj',
      '4 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj',
      `5 0 obj << /Length ${Buffer.byteLength(stream)} >> stream\n${stream}\nendstream endobj`,
    ];

    let body = '%PDF-1.4\n';
    const offsets = [0];
    for (const object of objects) {
      offsets.push(Buffer.byteLength(body));
      body += `${object}\n`;
    }
    const xrefOffset = Buffer.byteLength(body);
    body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
    for (let i = 1; i < offsets.length; i += 1) {
      body += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
    }
    body += `trailer << /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
    return Buffer.from(body, 'utf8');
  }
}
