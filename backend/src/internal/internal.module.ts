// src/internal/internal.module.ts
import { Module } from '@nestjs/common';
import { InternalController } from './internal.controller';
import { DocumentsModule } from '../documents/documents.module';
import { GatewayModule } from '../gateway/gateway.module';

@Module({
  imports:     [DocumentsModule, GatewayModule],
  controllers: [InternalController],
})
export class InternalModule {}
