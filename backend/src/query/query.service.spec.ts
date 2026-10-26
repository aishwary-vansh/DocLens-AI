// src/query/query.service.spec.ts
// ─────────────────────────────────────────────────────────────────────────────
// Regression tests for the RAG audit: citation traceability, honest fallbacks
// and cross-user isolation in QueryService. Prisma and the AI service are
// in-memory fakes; no database or network is used.
// ─────────────────────────────────────────────────────────────────────────────

import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { QueryService } from './query.service';

type Doc = { id: string; title: string; collectionId: string };

const collections = [
  { id: 'col-1', userId: 'user-1' },
  { id: 'col-2', userId: 'user-2' },
];
const documents: Doc[] = [
  { id: 'doc-1', title: 'Paper One', collectionId: 'col-1' },
  { id: 'doc-1b', title: 'Paper One B', collectionId: 'col-1' },
  { id: 'doc-2', title: 'Other User Paper', collectionId: 'col-2' },
];
const chunks = [
  { id: 'chunk-1', documentId: 'doc-1', chunkIndex: 0, pageNumber: 3, content: 'Paper One reports 81.2 Recall@10.' },
  { id: 'chunk-1b', documentId: 'doc-1b', chunkIndex: 0, pageNumber: 5, content: 'Paper One B uses only English data.' },
  { id: 'chunk-2', documentId: 'doc-2', chunkIndex: 0, pageNumber: 1, content: 'Secret content of another user.' },
];

const ownerOf = (collectionId: string) => collections.find((c) => c.id === collectionId)?.userId;
const docById = (id: string) => documents.find((d) => d.id === id);

function docMatches(doc: Doc | undefined, where: any = {}): boolean {
  if (!doc) return false;
  if (where.id?.in && !where.id.in.includes(doc.id)) return false;
  if (typeof where.id === 'string' && where.id !== doc.id) return false;
  if (where.collectionId && where.collectionId !== doc.collectionId) return false;
  const userId = where.collection?.workspace?.userId;
  if (userId && ownerOf(doc.collectionId) !== userId) return false;
  return true;
}

function makePrisma() {
  const queries: any[] = [];
  const citations: any[] = [];
  return {
    queries,
    citations,
    collection: {
      findFirst: async ({ where }: any) =>
        collections.find((c) => c.id === where.id && c.userId === where.workspace.userId) ?? null,
    },
    document: {
      count: async ({ where }: any) => documents.filter((d) => docMatches(d, where)).length,
      findMany: async ({ where }: any) => documents.filter((d) => docMatches(d, where)),
      findFirst: async ({ where }: any) => documents.find((d) => docMatches(d, where)) ?? null,
    },
    documentChunk: {
      findMany: async ({ where }: any) =>
        chunks
          .filter((c) => (!where.id?.in || where.id.in.includes(c.id)) && docMatches(docById(c.documentId), where.document))
          .map((c) => ({ ...c, document: docById(c.documentId) })),
    },
    chatSession: {
      findFirst: async () => null,
      create: async ({ data }: any) => ({ id: 'session-1', ...data }),
      update: async () => ({}),
    },
    query: {
      findMany: async () => [],
      findFirst: async ({ where }: any) => {
        const row = queries.find((q) => q.rawRequest?.clientRequestId === where.rawRequest.equals);
        return row ? { ...row, createdAt: new Date(), citations: [] } : null;
      },
      create: async ({ data }: any) => {
        const row = { id: `query-${queries.length + 1}`, ...data };
        queries.push(row);
        return row;
      },
    },
    citation: {
      create: async ({ data }: any) => {
        citations.push(data);
        return data;
      },
    },
    processingJob: { findFirst: async () => ({ stage: 'READY', progress: 100, status: 'COMPLETED' }) },
  };
}

function makeService(ai: Partial<Record<string, jest.Mock>>) {
  const prisma = makePrisma();
  const service = new QueryService(ai as any, prisma as any);
  return { service, prisma };
}

const aiCitation = (chunkId: string, sourceText = 'quoted passage') => ({ chunkId, sourceText, relevance: 0.9 });

describe('QueryService.ask — citation traceability', () => {
  it('keeps AI citation order and renumbers markers when a citation is dropped', async () => {
    const ai = {
      ask: jest.fn().mockResolvedValue({
        answer: 'Missing source claim [1]. Recall is 81.2 [2]. English only [3].',
        citations: [aiCitation('chunk-deleted'), aiCitation('chunk-1'), aiCitation('chunk-1b')],
        insufficient_evidence: false,
        confidence: 0.8,
      }),
      search: jest.fn(),
    };
    const { service, prisma } = makeService(ai);

    const res: any = await service.ask('What recall?', 'col-1', 'user-1');

    expect(res.citations.map((c: any) => c.chunkId)).toEqual(['chunk-1', 'chunk-1b']);
    expect(res.content).toContain('Recall is 81.2 [1].');
    expect(res.content).toContain('English only [2].');
    expect(res.content).not.toContain('[3]');
    expect(prisma.citations.map((c) => c.chunkId)).toEqual(['chunk-1', 'chunk-1b']);
    expect(ai.search).not.toHaveBeenCalled(); // no redundant pre-retrieval
  });

  it('drops citations to another user’s chunk and never substitutes other evidence', async () => {
    const ai = {
      ask: jest.fn().mockResolvedValue({
        answer: 'Leaked fact [1].',
        citations: [aiCitation('chunk-2')],
        insufficient_evidence: false,
      }),
      search: jest.fn(),
    };
    const { service } = makeService(ai);

    const res: any = await service.ask('q', 'col-1', 'user-1');

    expect(res.citations).toEqual([]);
    expect(res.insufficient_evidence).toBe(true);
    expect(res.content).toBe('Leaked fact .');
    expect(JSON.stringify(res)).not.toContain('Secret content');
    expect(ai.search).not.toHaveBeenCalled();
  });

  it('persists an honest insufficient-evidence answer without inventing a [1] marker', async () => {
    const ai = {
      ask: jest.fn().mockResolvedValue({
        answer: 'The papers do not report this.',
        citations: [],
        insufficient_evidence: true,
      }),
    };
    const { service, prisma } = makeService(ai);

    const res: any = await service.ask('q', 'col-1', 'user-1');

    expect(res.content).toBe('The papers do not report this.');
    expect(res.insufficient_evidence).toBe(true);
    expect(prisma.queries).toHaveLength(1);
  });

  it('labels the extractive fallback and cites exactly the passages it shows', async () => {
    const ai = {
      ask: jest.fn().mockRejectedValue(new Error('AI down')),
      search: jest.fn().mockResolvedValue([
        { chunkId: 'chunk-1', documentId: 'doc-1', documentTitle: 'Paper One', pageNumber: 3, content: 'Paper One reports 81.2 Recall@10 as its main result.', score: 0.9 },
      ]),
    };
    const { service } = makeService(ai);

    const res: any = await service.ask('What is the result?', 'col-1', 'user-1');

    expect(res.model_used).toBe('extractive-citation-fallback');
    expect(res.content).toMatch(/AI answer service is unavailable/);
    expect(res.citations.map((c: any) => c.chunkId)).toEqual(['chunk-1']);
    expect(res.content).toContain('[1]');
    expect(res.content).not.toContain('[2]');
  });

  it('says when the fallback is caused by an exhausted Gemini quota', async () => {
    const ai = {
      ask: jest.fn().mockRejectedValue(new Error('429 ResourceExhausted: You exceeded your current quota')),
      search: jest.fn().mockResolvedValue([
        { chunkId: 'chunk-1', documentId: 'doc-1', documentTitle: 'Paper One', pageNumber: 3, content: 'Paper One reports 81.2 Recall@10 as its main result.', score: 0.9 },
      ]),
    };
    const { service } = makeService(ai);

    const res: any = await service.ask('What is the result?', 'col-1', 'user-1');

    expect(res.ai_failure).toBe('unavailable');
    expect(res.content).toMatch(/quota or API key/);
  });

  it('passes background and evidence-conflict labels through and stores them with the answer', async () => {
    const ai = {
      ask: jest.fn().mockResolvedValue({
        answer: 'Paper One reports 81.2 Recall@10 [1].',
        citations: [aiCitation('chunk-1')],
        evidence_conflict: true,
        background: 'Recall@10 is the share of relevant items in the top 10.',
      }),
    };
    const { service, prisma } = makeService(ai);

    const res: any = await service.ask('q', 'col-1', 'user-1');

    expect(res.evidence_conflict).toBe(true);
    expect(res.background).toBe('Recall@10 is the share of relevant items in the top 10.');
    expect(prisma.queries[0].rawRequest.answerMeta).toMatchObject({ evidenceConflict: true, background: res.background });
  });
});

describe('QueryService — cross-user isolation', () => {
  it('rejects document ids outside the caller’s collection before calling the AI service', async () => {
    const ai = { ask: jest.fn(), hybridSearch: jest.fn() };
    const { service } = makeService(ai);

    await expect(service.ask('q', 'col-1', 'user-1', undefined, 5, 'vector', ['doc-2'])).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    await expect(service.hybridSearch('q', 'col-1', 10, ['doc-2'], 'user-1')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(ai.ask).not.toHaveBeenCalled();
    expect(ai.hybridSearch).not.toHaveBeenCalled();
  });

  it('hides processing status of another user’s document', async () => {
    const { service } = makeService({});
    await expect(service.pipelineStatus('doc-2', 'user-1')).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.pipelineStatus('doc-1', 'user-1')).resolves.toMatchObject({ stage: 'READY' });
  });

  it('research gaps: drops out-of-scope citations, remaps markers, ungrounds gaps left without sources', async () => {
    const ai = {
      researchGaps: jest.fn().mockResolvedValue({
        summary: 'Both evaluate English only [1][2].',
        consensus: [],
        gaps: [
          { title: 'Foreign', description: 'x [1]', rationale: 'y [1]', grounded: true, citations: [aiCitation('chunk-2')] },
          { title: 'Real', description: 'English only [2]', rationale: 'stated [2]', grounded: true, citations: [aiCitation('chunk-1b')] },
        ],
        citations: [aiCitation('chunk-2'), aiCitation('chunk-1b')],
      }),
    };
    const { service } = makeService(ai);

    const res: any = await service.researchGaps({ documentIds: ['doc-1', 'doc-1b'], userId: 'user-1' });

    expect(ai.researchGaps).toHaveBeenCalledWith('col-1', ['doc-1', 'doc-1b'], undefined, undefined);
    expect(res.citations.map((c: any) => c.chunkId)).toEqual(['chunk-1b']);
    expect(res.summary).toBe('Both evaluate English only [1].');
    expect(res.gaps[0]).toMatchObject({ title: 'Foreign', grounded: false, citations: [] });
    expect(res.gaps[1].description).toBe('English only [1]');
    expect(res.gaps[1].grounded).toBe(true);
  });

  it('research gaps: rejects papers the caller does not own', async () => {
    const ai = { researchGaps: jest.fn() };
    const { service } = makeService(ai);
    await expect(service.researchGaps({ documentIds: ['doc-2'], userId: 'user-1' })).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(ai.researchGaps).not.toHaveBeenCalled();
  });
});

describe('QueryService.ask — latency safeguards', () => {
  const okAnswer = {
    answer: 'Recall is 81.2 [1].',
    citations: [aiCitation('chunk-1')],
    insufficient_evidence: false,
    timings_ms: { retrieving: 900, generating: 4000 },
  };

  it('a retried clientRequestId reuses the running or stored answer: one AI call, one Query row', async () => {
    let release: (value: any) => void = () => undefined;
    const ai = { ask: jest.fn(() => new Promise((resolve) => (release = resolve))), search: jest.fn() };
    const { service, prisma } = makeService(ai);

    const first = service.ask('What recall?', 'col-1', 'user-1', undefined, 5, 'vector', undefined, { clientRequestId: 'req-12345678' });
    const duplicate = service.ask('What recall?', 'col-1', 'user-1', undefined, 5, 'vector', undefined, { clientRequestId: 'req-12345678' });
    while (!ai.ask.mock.calls.length) await new Promise((resolve) => setImmediate(resolve));
    release(okAnswer);
    const [a, b]: any[] = await Promise.all([first, duplicate]);
    const later: any = await service.ask('What recall?', 'col-1', 'user-1', undefined, 5, 'vector', undefined, { clientRequestId: 'req-12345678' });

    expect(ai.ask).toHaveBeenCalledTimes(1);
    expect(prisma.queries).toHaveLength(1);
    expect(b.id).toBe(a.id);
    expect(later.replayed).toBe(true);
    expect(later.id).toBe(a.id);
  });

  it('persists nothing when the client cancels', async () => {
    const controller = new AbortController();
    const ai = {
      ask: jest.fn(async () => {
        controller.abort();
        throw new Error('aborted');
      }),
      search: jest.fn(),
    };
    const { service, prisma } = makeService(ai);

    await expect(
      service.ask('q', 'col-1', 'user-1', undefined, 5, 'vector', undefined, { signal: controller.signal }),
    ).rejects.toMatchObject({ status: 499 });
    expect(prisma.queries).toHaveLength(0);
    expect(ai.search).not.toHaveBeenCalled();
  });

  it('after an AI timeout the fallback ranks locally instead of calling the slow AI search', async () => {
    const { HttpException, HttpStatus } = jest.requireActual('@nestjs/common');
    const ai = {
      ask: jest.fn().mockRejectedValue(new HttpException('timeout', HttpStatus.GATEWAY_TIMEOUT)),
      search: jest.fn(),
    };
    const { service } = makeService(ai);

    const res: any = await service.ask('Paper One recall', 'col-1', 'user-1');

    expect(ai.search).not.toHaveBeenCalled();
    expect(res.model_used).toBe('extractive-citation-fallback');
    expect(res.citations.length).toBeGreaterThan(0);
  });

  it('streams AI stages through onStage and returns the same aligned answer', async () => {
    const ai = {
      askStream: jest.fn(async (_payload: any, onStage: (s: string) => void) => {
        onStage('retrieving');
        onStage('generating');
        return okAnswer;
      }),
      ask: jest.fn(),
      search: jest.fn(),
    };
    const { service } = makeService(ai);
    const stages: string[] = [];

    const res: any = await service.ask('What recall?', 'col-1', 'user-1', undefined, 5, 'vector', undefined, {
      onStage: (s) => stages.push(s),
    });

    expect(stages).toEqual(['retrieving', 'generating']);
    expect(ai.ask).not.toHaveBeenCalled();
    expect(res.citations.map((c: any) => c.chunkId)).toEqual(['chunk-1']);
    expect(res.timings_ms).toEqual(okAnswer.timings_ms);
  });
});

describe('QueryService.getAnalytics', () => {
  function analyticsService(createdAt: Date[]) {
    const prisma = {
      document: { count: jest.fn().mockResolvedValue(3) },
      collection: { count: jest.fn().mockResolvedValue(1) },
      query: {
        count: jest.fn().mockResolvedValue(createdAt.length),
        findMany: jest.fn().mockResolvedValue(createdAt.map((d) => ({ createdAt: d }))),
      },
      literatureReview: { count: jest.fn().mockResolvedValue(0) },
    };
    return { service: new QueryService({} as any, prisma as any), prisma };
  }

  it('groups questions per day in the requested time zone', async () => {
    // 20:00 UTC on Oct 25 is already Oct 26 in India (UTC+5:30).
    const late = new Date('2026-10-25T20:00:00Z');
    const { service } = analyticsService([late, new Date('2026-10-26T04:00:00Z')]);
    const local = await service.getAnalytics('u1', 'Asia/Kolkata');
    expect(local.queriesByDay).toEqual([{ date: '2026-10-26', count: 2 }]);
    const utc = await service.getAnalytics('u1');
    expect(utc.queriesByDay).toEqual([
      { date: '2026-10-25', count: 1 },
      { date: '2026-10-26', count: 1 },
    ]);
  });

  it('falls back to UTC for an unknown time zone and scopes to the user', async () => {
    const { service, prisma } = analyticsService([new Date('2026-10-25T20:00:00Z')]);
    const result = await service.getAnalytics('u1', 'Not/AZone');
    expect(result.queriesByDay).toEqual([{ date: '2026-10-25', count: 1 }]);
    expect(prisma.query.findMany.mock.calls[0][0].where.chatSession).toEqual({ userId: 'u1' });
  });
});
