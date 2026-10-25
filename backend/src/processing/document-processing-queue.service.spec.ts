// src/processing/document-processing-queue.service.spec.ts
// ─────────────────────────────────────────────────────────────────────────────
// Jobs run in-process, so a backend restart used to leave documents stuck in
// EXTRACTING/EMBEDDING forever. On startup, interrupted jobs are resumed (or
// failed with a clear message when they cannot be).
// ─────────────────────────────────────────────────────────────────────────────
import { DocumentProcessingQueueService } from './document-processing-queue.service';

function makeService(jobs: any[]) {
  const updates: { jobs: any[]; docs: any[] } = { jobs: [], docs: [] };
  const prisma: any = {
    processingJob: {
      findMany: jest.fn().mockResolvedValue(jobs),
      update: jest.fn(async (args) => { updates.jobs.push(args); return {}; }),
    },
    document: {
      update: jest.fn(async (args) => { updates.docs.push(args); return { id: args.where.id, collectionId: 'c1', ...args.data }; }),
    },
  };
  const aiProxy: any = {
    processDocument: jest.fn().mockResolvedValue({ status: 'completed' }),
    embedDocument: jest.fn().mockResolvedValue({ status: 'completed' }),
  };
  const events: any = { emitStatusChanged: jest.fn() };
  return { service: new DocumentProcessingQueueService(prisma, aiProxy, events), aiProxy, updates };
}

const flush = () => new Promise((resolve) => setImmediate(resolve));

describe('DocumentProcessingQueueService — restart recovery', () => {
  it('resumes a job interrupted mid-pipeline and finishes the document', async () => {
    const { service, aiProxy, updates } = makeService([{
      id: 'j1', documentId: 'd1', attempts: 1, document: { status: 'EXTRACTING' },
      payload: { absoluteFilePath: '/app/uploads/u/p.pdf', collectionId: 'c1' },
    }]);

    await service.onApplicationBootstrap();
    await flush(); await flush(); await flush();

    expect(aiProxy.processDocument).toHaveBeenCalledWith('d1', '/app/uploads/u/p.pdf', 'c1');
    expect(aiProxy.embedDocument).toHaveBeenCalledWith('d1');
    expect(updates.docs[updates.docs.length - 1].data.status).toBe('READY');
  });

  it('fails a job that was already interrupted too often instead of looping', async () => {
    const { service, aiProxy, updates } = makeService([{
      id: 'j2', documentId: 'd2', attempts: 3, document: { status: 'EMBEDDING' },
      payload: { absoluteFilePath: '/app/uploads/u/p.pdf', collectionId: 'c1' },
    }]);

    await service.onApplicationBootstrap();

    expect(aiProxy.processDocument).not.toHaveBeenCalled();
    expect(updates.docs[0].data.status).toBe('FAILED');
    expect(updates.docs[0].data.errorMessage).toMatch(/upload the paper again/);
  });

  it('only closes the job when its document already finished', async () => {
    const { service, aiProxy, updates } = makeService([{
      id: 'j3', documentId: 'd3', attempts: 1, document: { status: 'READY' },
      payload: { absoluteFilePath: '/x.pdf', collectionId: 'c1' },
    }]);

    await service.onApplicationBootstrap();

    expect(aiProxy.processDocument).not.toHaveBeenCalled();
    expect(updates.docs).toHaveLength(0);
    expect(updates.jobs[0].data.status).toBe('COMPLETED');
  });
});
