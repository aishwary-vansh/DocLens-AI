import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';

import { EventsGateway } from '../gateway/events.gateway';
import { PrismaService } from '../prisma/prisma.service';
import { AiProxyService } from '../ai-proxy/ai-proxy.service';
import { join } from 'path';

interface ProcessDocumentJob {
  processingJobId: string;
  documentId: string;
  /** Absolute path to the PDF on the NestJS container's local filesystem. */
  absoluteFilePath: string;
  collectionId: string;
}

/** A job interrupted more often than this is failed instead of resumed again. */
const MAX_RESUME_ATTEMPTS = 3;

@Injectable()
export class DocumentProcessingQueueService implements OnApplicationBootstrap {
  private readonly logger = new Logger(DocumentProcessingQueueService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly aiProxy: AiProxyService,
    private readonly events: EventsGateway,
  ) {}

  /**
   * @param documentId  DB document id
   * @param fileUrl     Relative URL stored in DB, e.g. "uploads/<userId>/<filename>"
   * @param collectionId
   */
  async enqueueDocument(documentId: string, fileUrl: string, collectionId: string) {
    // Resolve to an absolute path on the shared uploads volume. In Docker,
    // both backend and ai-service mount this volume at /app/uploads.
    const absoluteFilePath = join(process.cwd(), fileUrl);

    const processingJob = await this.prisma.processingJob.create({
      data: {
        documentId,
        stage: 'UPLOADED',
        status: 'QUEUED',
        progress: 0,
        maxAttempts: 1,
        payload: { documentId, absoluteFilePath, collectionId },
      },
    });

    void this.runJobDirect({
      processingJobId: processingJob.id,
      documentId,
      absoluteFilePath,
      collectionId,
    });

    return processingJob;
  }

  /**
   * Jobs run in this process, so a backend restart (redeploy, crash, `docker
   * compose up`) leaves them QUEUED/ACTIVE with the document stuck mid-pipeline.
   * On startup, resume each one: AI ingest reuses unchanged chunk ids and embed
   * only fills missing vectors, so re-running them is safe.
   */
  async onApplicationBootstrap() {
    const orphaned = await this.prisma.processingJob.findMany({
      where: { status: { in: ['QUEUED', 'ACTIVE'] } },
      orderBy: { createdAt: 'asc' },
      include: { document: { select: { status: true } } },
    }).catch((err) => {
      this.logger.warn(`Could not look for interrupted processing jobs: ${err.message}`);
      return [];
    });
    for (const job of orphaned) {
      // A document that already finished (or was failed by hand) only needs its job closed.
      if (['READY', 'COMPLETED', 'FAILED'].includes(job.document?.status ?? '')) {
        await this.prisma.processingJob.update({
          where: { id: job.id },
          data: { status: job.document?.status === 'FAILED' ? 'FAILED' : 'COMPLETED' },
        }).catch(() => {});
        continue;
      }
      const payload = (job.payload ?? {}) as Partial<ProcessDocumentJob>;
      if (!payload.absoluteFilePath || !payload.collectionId || job.attempts >= MAX_RESUME_ATTEMPTS) {
        const reason = 'Processing was interrupted by a server restart. Please upload the paper again.';
        await this.prisma.processingJob.update({
          where: { id: job.id },
          data: { status: 'FAILED', errorMessage: reason, failedAt: new Date() },
        }).catch(() => {});
        await this.prisma.document.update({
          where: { id: job.documentId },
          data: { status: 'FAILED', processingProgress: 0, errorMessage: reason },
        }).catch(() => null);
        continue;
      }
      this.logger.log(`Resuming interrupted processing for ${job.documentId} (attempt ${job.attempts + 1})`);
      void this.runJobDirect({
        processingJobId: job.id,
        documentId: job.documentId,
        absoluteFilePath: payload.absoluteFilePath,
        collectionId: payload.collectionId,
      });
    }
  }

  private async runJobDirect(job: ProcessDocumentJob) {
    const { processingJobId, documentId, absoluteFilePath, collectionId } = job;
    try {
      await this.prisma.processingJob.update({
        where: { id: processingJobId },
        data: {
          status: 'ACTIVE',
          stage: 'EXTRACTING',
          progress: 20,
          attempts: { increment: 1 },
          startedAt: new Date(),
          lastHeartbeatAt: new Date(),
        },
      });
      const extractingDoc = await this.prisma.document.update({
        where: { id: documentId },
        data: { status: 'EXTRACTING', processingProgress: 20, errorMessage: null },
      });
      this.events.emitStatusChanged(collectionId, extractingDoc);

      const extraction = await this.aiProxy.processDocument(documentId, absoluteFilePath, collectionId);
      if (extraction?.status && extraction.status !== 'completed') {
        throw new Error(extraction.message || `AI ingestion returned status ${extraction.status}`);
      }

      await this.prisma.processingJob.update({
        where: { id: processingJobId },
        data: { stage: 'EMBEDDING', progress: 70, lastHeartbeatAt: new Date() },
      });
      const embeddingDoc = await this.prisma.document.update({
        where: { id: documentId },
        data: { status: 'EMBEDDING', processingProgress: 70 },
      });
      this.events.emitStatusChanged(collectionId, embeddingDoc);

      const embedding = await this.aiProxy.embedDocument(documentId);
      if (embedding?.status && embedding.status !== 'completed') {
        throw new Error(embedding.message || `Embedding returned status ${embedding.status}`);
      }

      await this.prisma.processingJob.update({
        where: { id: processingJobId },
        data: {
          status: 'COMPLETED',
          stage: 'READY',
          progress: 100,
          startedAt: new Date(),
          completedAt: new Date(),
          lastHeartbeatAt: new Date(),
        },
      });
      const doc = await this.prisma.document.update({
        where: { id: documentId },
        data: { status: 'READY', processingProgress: 100, errorMessage: null, aiProcessedAt: new Date() },
      });
      this.events.emitStatusChanged(collectionId, doc);
    } catch (err: any) {
      this.logger.error(`Document processing failed for ${documentId}: ${err.message}`);
      const doc = await this.prisma.document.update({
        where: { id: documentId },
        data: { status: 'FAILED', processingProgress: 0, errorMessage: err.message },
      }).catch(() => null);
      if (doc) this.events.emitStatusChanged(doc.collectionId, doc);
      await this.prisma.processingJob.update({
        where: { id: processingJobId },
        data: { status: 'FAILED', errorMessage: err.message, failedAt: new Date() },
      }).catch(() => {});
    }
  }
}
