// src/ai-proxy/ai-proxy.module.ts
import { Module } from '@nestjs/common';
import { AiProxyService } from './ai-proxy.service';

@Module({
  providers: [AiProxyService],
  exports:   [AiProxyService],
})
export class AiProxyModule {}
