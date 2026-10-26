// src/documents/documents.service.spec.ts
// Unit tests for retrying failed papers (reprocess) and deleting a paper with its PDF.

import { ConflictException, NotFoundException } from '@nestjs/common';
import { existsSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { DocumentsService } from './documents.service';

const UPLOAD_DIR = join(process.cwd(), 'uploads', '__spec__');

function makeService(document: any) {
  const prisma = {
    document: {
      findUnique: jest.fn().mockResolvedValue(document),
      update: jest.fn().mockImplementation(({ data }) => Promise.resolve({ ...document, ...data })),
      delete: jest.fn().mockResolvedValue(document),
    },
  };
  const collections = { findOne: jest.fn().mockResolvedValue({ id: document?.collectionId }) };
  const events = { emitStatusChanged: jest.fn(), emitDocumentDeleted: jest.fn() };
  const queue = { enqueueDocument: jest.fn().mockResolvedValue(undefined) };
  const service = new DocumentsService(prisma as any, collections as any, events as any, queue as any);
  return { service, prisma, collections, events, queue };
}

function storedPdf(name: string) {
  mkdirSync(UPLOAD_DIR, { recursive: true });
  writeFileSync(join(UPLOAD_DIR, name), '%PDF-1.4 test');
  return `uploads/__spec__/${name}`;
}

describe('DocumentsService', () => {
  afterAll(() => rmSync(UPLOAD_DIR, { recursive: true, force: true }));

  describe('reprocess', () => {
    it('re-queues a FAILED paper and resets its status', async () => {
      const fileUrl = storedPdf('failed.pdf');
      const doc = { id: 'd1', collectionId: 'c1', status: 'FAILED', fileUrl, errorMessage: 'boom' };
      const { service, prisma, events, queue } = makeService(doc);

      const result = await service.reprocess('d1', 'u1');

      expect(prisma.document.update).toHaveBeenCalledWith({
        where: { id: 'd1' },
        data: { status: 'PENDING', processingProgress: 0, errorMessage: null },
      });
      expect(result.status).toBe('PENDING');
      expect(events.emitStatusChanged).toHaveBeenCalledWith('c1', expect.objectContaining({ status: 'PENDING' }));
      expect(queue.enqueueDocument).toHaveBeenCalledWith('d1', fileUrl, 'c1');
    });

    it('refuses a paper that is already READY', async () => {
      const { service, queue } = makeService({ id: 'd2', collectionId: 'c1', status: 'READY', fileUrl: storedPdf('ready.pdf') });
      await expect(service.reprocess('d2', 'u1')).rejects.toBeInstanceOf(ConflictException);
      expect(queue.enqueueDocument).not.toHaveBeenCalled();
    });

    it('reports a missing PDF instead of queueing it', async () => {
      const { service, queue } = makeService({ id: 'd3', collectionId: 'c1', status: 'FAILED', fileUrl: 'uploads/__spec__/missing.pdf' });
      await expect(service.reprocess('d3', 'u1')).rejects.toBeInstanceOf(NotFoundException);
      expect(queue.enqueueDocument).not.toHaveBeenCalled();
    });

    it("checks ownership through the paper's collection", async () => {
      const { service, collections } = makeService({ id: 'd4', collectionId: 'c9', status: 'FAILED', fileUrl: storedPdf('owner.pdf') });
      collections.findOne.mockRejectedValueOnce(new NotFoundException('Collection not found'));
      await expect(service.reprocess('d4', 'intruder')).rejects.toBeInstanceOf(NotFoundException);
      expect(collections.findOne).toHaveBeenCalledWith('c9', 'intruder');
    });
  });

  describe('remove', () => {
    it('deletes the row and the stored PDF', async () => {
      const fileUrl = storedPdf('delete-me.pdf');
      const { service, prisma, events } = makeService({ id: 'd5', collectionId: 'c1', status: 'READY', fileUrl });

      await expect(service.remove('d5', 'u1')).resolves.toEqual({ id: 'd5' });

      expect(prisma.document.delete).toHaveBeenCalledWith({ where: { id: 'd5' } });
      expect(events.emitDocumentDeleted).toHaveBeenCalledWith('c1', 'd5');
      expect(existsSync(join(process.cwd(), fileUrl))).toBe(false);
    });

    it('still succeeds when the PDF is already gone', async () => {
      const { service } = makeService({ id: 'd6', collectionId: 'c1', status: 'READY', fileUrl: 'uploads/__spec__/gone.pdf' });
      await expect(service.remove('d6', 'u1')).resolves.toEqual({ id: 'd6' });
    });
  });
});
