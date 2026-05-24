import {
  Body,
  Controller,
  Headers,
  Logger,
  Post,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DocumentStatus } from '../../generated/prisma';
import { DocumentsService } from '../documents/documents.service';
import { EventsGateway } from '../gateway/events.gateway';

type AiStatus =
  | 'UPLOADED'
  | 'EXTRACTING'
  | 'CHUNKING'
  | 'EMBEDDING'
  | 'INDEXING'
  | 'READY'
  | 'COMPLETED'
  | 'FAILED';

interface AiCallback {
  document_id: string;
  status: AiStatus;
  progress_pct?: number;
  error?: string;
  chunks?: any[] | number;
  entities?: any[] | number;
  relationships?: any[] | number;
  title?: string;
  page_count?: number;
  doi?: string;
  keywords?: string[];
  model_name?: string;
  embedding_dimensions?: number;
  vector_store?: string;
}

@Controller('internal')
export class InternalController {
  private readonly logger = new Logger(InternalController.name);

  constructor(
    private readonly config: ConfigService,
    private readonly events: EventsGateway,
    private readonly documents: DocumentsService,
  ) {}

  @Post('ai-callback')
  async handleAiCallback(
    @Body() body: AiCallback,
    @Headers('x-internal-secret') secret: string,
  ) {
    const expected = this.config.get<string>('INTERNAL_API_SECRET') ?? 'doclens-internal-secret';
    if (secret !== expected) throw new UnauthorizedException('Invalid internal secret');

    const { document_id, status, error, progress_pct } = body;
    this.logger.log(`AI callback: ${document_id} -> ${status}`);

    const nestStatus = this.mapStatus(status);

    try {
      if (status === 'READY' || status === 'COMPLETED') {
        await this.documents.persistAiOutputs(document_id, {
          title: body.title,
          page_count: body.page_count,
          doi: body.doi,
          keywords: body.keywords,
          chunks: Array.isArray(body.chunks) ? body.chunks : [],
          entities: Array.isArray(body.entities) ? body.entities : [],
          relationships: Array.isArray(body.relationships) ? body.relationships : [],
          model_name: body.model_name,
          embedding_dimensions: body.embedding_dimensions,
          vector_store: body.vector_store,
        });
      }

      const updated = await this.documents.updateStatus(
        document_id,
        nestStatus,
        error,
        progress_pct,
      );
      return { received: true, document_id, status: updated.status };
    } catch (err: any) {
      this.logger.warn(`Could not persist AI callback for ${document_id}: ${err.message}`);
      this.events.emitStatusChanged('', {
        id: document_id,
        status: nestStatus,
      } as any);
      return { received: true, document_id, status: nestStatus, warning: err.message };
    }
  }

  private mapStatus(aiStatus: AiStatus): DocumentStatus {
    const map: Record<AiStatus, DocumentStatus> = {
      UPLOADED: 'UPLOADED',
      EXTRACTING: 'EXTRACTING',
      CHUNKING: 'CHUNKING',
      EMBEDDING: 'EMBEDDING',
      INDEXING: 'INDEXING',
      READY: 'COMPLETED',
      COMPLETED: 'COMPLETED',
      FAILED: 'FAILED',
    };
    return map[aiStatus] ?? 'PENDING';
  }
}
