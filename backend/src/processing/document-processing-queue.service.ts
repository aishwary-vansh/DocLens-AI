import { Injectable, Logger } from '@nestjs/common';
import { AiProxyService } from '../ai-proxy/ai-proxy.service';
import { EventsGateway } from '../gateway/events.gateway';
import { PrismaService } from '../prisma/prisma.service';

interface ProcessDocumentJob {
  processingJobId: string;
  documentId: string;
  filePath: string;
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

  async enqueueDocument(documentId: string, filePath: string, collectionId: string) {
    const processingJob = await this.prisma.processingJob.create({
      data: {
        documentId,
        stage: 'UPLOADED',
        status: 'QUEUED',
        progress: 0,
        maxAttempts: 1,
        payload: { documentId, filePath, collectionId },
      },
    });

    void this.runJobDirect({
      processingJobId: processingJob.id,
      documentId,
      filePath,
      collectionId,
    });

    return processingJob;
  }

  private async runJobDirect(job: ProcessDocumentJob) {
    const { processingJobId, documentId, filePath, collectionId } = job;
    try {
      await this.prisma.processingJob.update({
        where: { id: processingJobId },
        data: {
          status: 'ACTIVE',
          stage: 'UPLOADED',
          progress: 5,
          startedAt: new Date(),
          lastHeartbeatAt: new Date(),
        },
      });
      const doc = await this.prisma.document.update({
        where: { id: documentId },
        data: { status: 'UPLOADED', processingProgress: 5, errorMessage: null },
      });
      this.events.emitStatusChanged(collectionId, doc);

      await this.aiProxy.processDocument(documentId, filePath, collectionId);

      await this.prisma.processingJob.update({
        where: { id: processingJobId },
        data: { progress: 15, lastHeartbeatAt: new Date() },
      });
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
