import { Injectable, Logger } from '@nestjs/common';

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

@Injectable()
export class DocumentProcessingQueueService {
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
    // Resolve to an absolute path on the NestJS container.
    // AiProxyService.processDocument() reads this file and streams the bytes
    // to the AI service — no shared filesystem required.
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

  private async runJobDirect(job: ProcessDocumentJob) {
    const { processingJobId, documentId, absoluteFilePath, collectionId } = job;
    try {
      // Actually send it to the AI Service for ingestion
      await this.aiProxy.processDocument(documentId, absoluteFilePath, collectionId);

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
        data: { status: 'COMPLETED', processingProgress: 100, errorMessage: null },
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
