import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { existsSync } from 'fs';
import { join } from 'path';
import { Document, DocumentStatus, EntityType, RelationshipType } from '@prisma/client';
import { CollectionsService } from '../collections/collections.service';
import { EventsGateway } from '../gateway/events.gateway';
import { DocumentProcessingQueueService } from '../processing/document-processing-queue.service';
import { PrismaService } from '../prisma/prisma.service';
import { SemanticScholarService } from './semantic-scholar.service';

type AiChunkPayload = {
  chunk_id?: string;
  chunk_index?: number;
  page_number?: number;
  text?: string;
  content?: string;
  vector_id?: string;
  token_count?: number;
};

type AiEntityPayload = {
  name: string;
  type: string;
  mentions?: number;
  pages?: number[];
  confidence?: number;
};

type AiRelationshipPayload = {
  source: string;
  source_type?: string;
  target: string;
  target_type?: string;
  relation?: string;
  type?: string;
  confidence?: number;
};

type AiPersistPayload = {
  title?: string;
  page_count?: number;
  doi?: string;
  keywords?: string[];
  chunks?: AiChunkPayload[];
  entities?: AiEntityPayload[];
  relationships?: AiRelationshipPayload[];
  model_name?: string;
  embedding_dimensions?: number;
  vector_store?: string;
};

@Injectable()
export class DocumentsService {
  private readonly logger = new Logger(DocumentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly collectionsService: CollectionsService,
    private readonly events: EventsGateway,
    private readonly processingQueue: DocumentProcessingQueueService,
    private readonly semanticScholarService: SemanticScholarService,
  ) {}

  async create(file: Express.Multer.File, collectionId: string, userId: string): Promise<Document> {
    await this.collectionsService.findOne(collectionId, userId);
    if (!file) throw new BadRequestException('No file provided');

    const title = file.originalname.replace(/\.[^/.]+$/, '');
    const fileUrl = `uploads/${userId}/${file.filename}`;
    const document = await this.prisma.document.create({
      data: {
        title,
        filename: file.originalname,
        fileUrl,
        fileSize: file.size,
        collectionId,
        mimeType: file.mimetype,
        status: 'PENDING',
        processingProgress: 0,
      },
    });

    this.events.emitDocumentUploaded(collectionId, document);

    try {
      await this.processingQueue.enqueueDocument(document.id, document.fileUrl, collectionId);
      this.logger.log(`Queued AI processing for ${document.id}`);
    } catch (error: any) {
      const failed = await this.prisma.document.update({
        where: { id: document.id },
        data: {
          status: 'FAILED',
          errorMessage: `Could not enqueue AI processing: ${error.message}`,
        },
      });
      this.events.emitStatusChanged(collectionId, failed);
      throw new ServiceUnavailableException('Document uploaded, but AI processing queue is unavailable');
    }

    // Asynchronously fetch metadata from Semantic Scholar
    this.semanticScholarService.fetchPaperMetadata(title).then(async (metadata) => {
      if (metadata) {
        const doc = await this.prisma.document.findUnique({ where: { id: document.id } });
        if (doc) {
          const updatedDoc = await this.prisma.document.update({
            where: { id: document.id },
            data: {
              metadata: {
                ...(typeof doc.metadata === 'object' && doc.metadata ? doc.metadata : {}),
                citationsCount: metadata.citationCount,
                authors: metadata.authors,
                year: metadata.year,
              },
            },
          });
          this.events.emitStatusChanged(collectionId, updatedDoc);
        }
      }
    }).catch(e => this.logger.error(`Error in async semantic scholar fetch: ${e.message}`));

    return document;
  }

  async findByCollection(collectionId: string, userId: string): Promise<Document[]> {
    await this.collectionsService.findOne(collectionId, userId);
    return this.prisma.document.findMany({
      where: { collectionId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(id: string, userId: string): Promise<Document> {
    const document = await this.prisma.document.findUnique({
      where: { id },
      include: { collection: { include: { workspace: true } } },
    });
    if (!document) throw new NotFoundException(`Document ${id} not found`);
    await this.collectionsService.findOne(document.collectionId, userId);
    return document;
  }

  async getFilePath(id: string, userId: string): Promise<string> {
    const document = await this.findOne(id, userId);
    const filePath = join(process.cwd(), document.fileUrl);
    if (!existsSync(filePath)) throw new NotFoundException('File not found on disk');
    return filePath;
  }

  async workspaceOverview(userId: string) {
    const [workspaces, collections, documents, chatSessions, literatureReviews, comparisons, progress] =
      await Promise.all([
        this.prisma.workspace.findMany({
          where: { userId },
          orderBy: { updatedAt: 'desc' },
        }),
        this.prisma.collection.findMany({
          where: { workspace: { userId } },
          orderBy: { updatedAt: 'desc' },
        }),
        this.prisma.document.findMany({
          where: { collection: { workspace: { userId } } },
          include: { collection: true },
          orderBy: { updatedAt: 'desc' },
          take: 25,
        }),
        this.prisma.chatSession.findMany({
          where: { userId },
          include: { queries: { orderBy: { createdAt: 'desc' }, take: 1 } },
          orderBy: { updatedAt: 'desc' },
          take: 10,
        }),
        this.prisma.literatureReview.findMany({
          where: { userId },
          orderBy: { createdAt: 'desc' },
          take: 10,
        }),
        this.prisma.paperComparison.findMany({
          where: { userId },
          orderBy: { createdAt: 'desc' },
          take: 10,
        }),
        this.prisma.readingProgress.findMany({
          where: { userId },
          include: { document: true },
          orderBy: { updatedAt: 'desc' },
          take: 20,
        }),
      ]);

    const ready = documents.filter((document) => ['READY', 'COMPLETED'].includes(document.status)).length;
    const processing = documents.filter((document) => !['READY', 'COMPLETED', 'FAILED'].includes(document.status)).length;

    return {
      stats: {
        workspaces: workspaces.length,
        collections: collections.length,
        papersUploaded: documents.length,
        papersReady: ready,
        papersProcessing: processing,
        literatureReviews: literatureReviews.length,
        comparisons: comparisons.length,
        readingProgress: progress.filter((item) => item.status !== 'UNREAD').length,
      },
      recentPapers: documents,
      recentChats: chatSessions.map((session) => ({
        id: session.id,
        title: session.title,
        scopeId: session.scopeId,
        updatedAt: session.updatedAt,
        latestQuestion: session.queries[0]?.question,
      })),
      literatureReviews,
      comparisons,
      readingProgress: progress,
    };
  }

  async getReadingProgress(documentId: string, userId: string) {
    await this.findOne(documentId, userId);
    const progress = await this.prisma.readingProgress.findUnique({
      where: { userId_documentId: { userId, documentId } },
    });
    return progress ?? {
      documentId,
      userId,
      status: 'UNREAD',
      progress: 0,
      lastReadPage: null,
      notes: null,
    };
  }

  async updateReadingProgress(
    documentId: string,
    userId: string,
    dto: { status?: string; progress?: number; lastReadPage?: number; notes?: string },
  ) {
    await this.findOne(documentId, userId);
    const progress = Math.max(0, Math.min(100, Number(dto.progress ?? 0)));
    const status = dto.status ?? (progress >= 100 ? 'COMPLETED' : progress > 0 ? 'READING' : 'UNREAD');

    return this.prisma.readingProgress.upsert({
      where: { userId_documentId: { userId, documentId } },
      create: {
        userId,
        documentId,
        status,
        progress,
        lastReadPage: dto.lastReadPage,
        notes: dto.notes,
      },
      update: {
        status,
        progress,
        lastReadPage: dto.lastReadPage,
        notes: dto.notes,
      },
    });
  }

  async updateStatus(
    id: string,
    status: DocumentStatus,
    errorMessage?: string,
    progress?: number,
  ): Promise<Document> {
    const existing = await this.prisma.document.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException(`Document ${id} not found`);

    const document = await this.prisma.document.update({
      where: { id },
      data: {
        status,
        errorMessage: errorMessage ?? null,
        processingProgress: progress ?? this.progressForStatus(status),
        aiProcessedAt: status === 'COMPLETED' || status === 'READY' ? new Date() : undefined,
      },
    });

    await this.updateLatestProcessingJob(id, status, errorMessage, progress);
    this.events.emitStatusChanged(document.collectionId, document);
    return document;
  }

  async persistAiOutputs(documentId: string, payload: AiPersistPayload) {
    const document = await this.prisma.document.findUnique({ where: { id: documentId } });
    if (!document) throw new NotFoundException(`Document ${documentId} not found`);

    await this.prisma.$transaction(async (tx) => {
      if (payload.title || payload.page_count) {
        await tx.document.update({
          where: { id: documentId },
          data: {
            title: payload.title || document.title,
            pageCount: payload.page_count ?? document.pageCount,
            metadata: {
              ...(typeof document.metadata === 'object' && document.metadata ? document.metadata : {}),
              aiModel: payload.model_name,
              vectorStore: payload.vector_store,
              doi: payload.doi,
              keywords: payload.keywords ?? [],
            },
          },
        });
      }

      for (const chunk of payload.chunks ?? []) {
        const chunkIndex = chunk.chunk_index ?? 0;
        const content = chunk.text ?? chunk.content ?? '';
        const saved = await tx.documentChunk.upsert({
          where: { documentId_chunkIndex: { documentId, chunkIndex } },
          create: {
            documentId,
            chunkIndex,
            content,
            pageNumber: chunk.page_number,
            vectorId: chunk.vector_id,
            tokenCount: chunk.token_count,
            contentHash: this.simpleHash(content),
          },
          update: {
            content,
            pageNumber: chunk.page_number,
            vectorId: chunk.vector_id,
            tokenCount: chunk.token_count,
            contentHash: this.simpleHash(content),
          },
        });

        if (chunk.vector_id) {
          await tx.embeddingMetadata.upsert({
            where: { chunkId: saved.id },
            create: {
              chunkId: saved.id,
              documentId,
              collectionId: document.collectionId,
              modelName: payload.model_name ?? 'all-MiniLM-L6-v2',
              dimensions: payload.embedding_dimensions ?? 384,
              vectorStore: payload.vector_store ?? 'faiss',
              vectorId: chunk.vector_id,
            },
            update: {
              modelName: payload.model_name ?? 'all-MiniLM-L6-v2',
              dimensions: payload.embedding_dimensions ?? 384,
              vectorStore: payload.vector_store ?? 'faiss',
              vectorId: chunk.vector_id,
            },
          });
        }
      }

      const entityMap = new Map<string, string>();
      for (const entity of payload.entities ?? []) {
        const type = this.entityType(entity.type);
        if (!type || !entity.name?.trim()) continue;
        const normalizedName = this.normalizeEntityName(entity.name);
        const saved = await tx.entity.upsert({
          where: {
            collectionId_normalizedName_type: {
              collectionId: document.collectionId,
              normalizedName,
              type,
            },
          },
          create: {
            name: entity.name,
            normalizedName,
            type,
            collectionId: document.collectionId,
          },
          update: { name: entity.name },
        });
        entityMap.set(`${type}:${normalizedName}`, saved.id);

        await tx.documentEntity.upsert({
          where: { documentId_entityId: { documentId, entityId: saved.id } },
          create: {
            documentId,
            entityId: saved.id,
            mentionCount: entity.mentions ?? 1,
            pages: entity.pages ?? [],
            confidence: entity.confidence ?? 1,
          },
          update: {
            mentionCount: entity.mentions ?? 1,
            pages: entity.pages ?? [],
            confidence: entity.confidence ?? 1,
          },
        });
      }

      await tx.relationship.deleteMany({ where: { documentId } });
      for (const relationship of payload.relationships ?? []) {
        const type = this.relationshipType(relationship.relation ?? relationship.type);
        if (!type) continue;

        const sourceType = this.entityType(relationship.source_type ?? '');
        const targetType = this.entityType(relationship.target_type ?? '');
        if (!sourceType || !targetType) continue;

        const sourceKey = `${sourceType}:${this.normalizeEntityName(relationship.source)}`;
        const targetKey = `${targetType}:${this.normalizeEntityName(relationship.target)}`;
        const sourceEntityId = entityMap.get(sourceKey);
        const targetEntityId = entityMap.get(targetKey);
        if (!sourceEntityId || !targetEntityId) continue;

        await tx.relationship.create({
          data: {
            type,
            collectionId: document.collectionId,
            documentId,
            sourceEntityId,
            targetEntityId,
            confidence: relationship.confidence ?? 1,
          },
        });
      }
    });
  }

  async remove(id: string, userId: string): Promise<{ id: string }> {
    const document = await this.findOne(id, userId);
    await this.prisma.document.delete({ where: { id } });
    this.events.emitDocumentDeleted(document.collectionId, id);
    return { id };
  }

  private async updateLatestProcessingJob(
    documentId: string,
    status: DocumentStatus,
    errorMessage?: string,
    progress?: number,
  ) {
    const job = await this.prisma.processingJob.findFirst({
      where: { documentId },
      orderBy: { createdAt: 'desc' },
    });
    if (!job) return;

    const terminal = status === 'COMPLETED' || status === 'READY' || status === 'FAILED';
    await this.prisma.processingJob.update({
      where: { id: job.id },
      data: {
        status: status === 'FAILED' ? 'FAILED' : terminal ? 'COMPLETED' : 'ACTIVE',
        stage: this.processingStage(status),
        progress: progress ?? this.progressForStatus(status),
        errorMessage: errorMessage ?? null,
        completedAt: status === 'COMPLETED' || status === 'READY' ? new Date() : undefined,
        failedAt: status === 'FAILED' ? new Date() : undefined,
        lastHeartbeatAt: new Date(),
      },
    });
  }

  private progressForStatus(status: DocumentStatus): number {
    const progress: Record<string, number> = {
      PENDING: 0,
      UPLOADED: 5,
      EXTRACTING: 20,
      CHUNKING: 40,
      EMBEDDING: 65,
      INDEXING: 85,
      READY: 100,
      COMPLETED: 100,
      FAILED: 0,
    };
    return progress[status] ?? 0;
  }

  private processingStage(status: DocumentStatus) {
    if (status === 'COMPLETED') return 'READY';
    if (status === 'INDEXING') return 'INDEXING';
    if (status === 'FAILED') return 'FAILED';
    return status as any;
  }

  private normalizeEntityName(name: string): string {
    const alias: Record<string, string> = {
      llm: 'large language model',
      llms: 'large language model',
      rag: 'retrieval augmented generation',
    };
    const normalized = name.trim().toLowerCase().replace(/\s+/g, ' ');
    return alias[normalized] ?? normalized;
  }

  private entityType(type: string): EntityType | null {
    const normalized = type.toUpperCase();
    return Object.values(EntityType).includes(normalized as EntityType)
      ? (normalized as EntityType)
      : null;
  }

  private relationshipType(type?: string): RelationshipType | null {
    const normalized = (type ?? 'RELATED_TO').toUpperCase();
    return Object.values(RelationshipType).includes(normalized as RelationshipType)
      ? (normalized as RelationshipType)
      : 'RELATED_TO';
  }

  private simpleHash(value: string): string {
    let hash = 0;
    for (let i = 0; i < value.length; i += 1) {
      hash = (hash << 5) - hash + value.charCodeAt(i);
      hash |= 0;
    }
    return Math.abs(hash).toString(16);
  }
}
