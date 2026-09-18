// src/documents/documents.module.ts
import { Module } from '@nestjs/common';
import { DocumentsService } from './documents.service';
import { DocumentsController } from './documents.controller';
import { CollectionsModule } from '../collections/collections.module';
import { AiProxyModule } from '../ai-proxy/ai-proxy.module';
import { ProcessingModule } from '../processing/processing.module';

@Module({
  imports:     [CollectionsModule, AiProxyModule, ProcessingModule],
  controllers: [DocumentsController],
  providers:   [DocumentsService],
  exports:     [DocumentsService],
})
export class DocumentsModule {}
