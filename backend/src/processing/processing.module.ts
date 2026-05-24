import { Module } from '@nestjs/common';
import { AiProxyModule } from '../ai-proxy/ai-proxy.module';
import { DocumentProcessingQueueService } from './document-processing-queue.service';

@Module({
  imports: [AiProxyModule],
  providers: [DocumentProcessingQueueService],
  exports: [DocumentProcessingQueueService],
})
export class ProcessingModule {}
