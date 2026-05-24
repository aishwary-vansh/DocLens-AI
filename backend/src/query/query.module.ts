// src/query/query.module.ts
import { Module } from '@nestjs/common';
import { QueryController } from './query.controller';
import { QueryService } from './query.service';
import { AiProxyModule } from '../ai-proxy/ai-proxy.module';

@Module({
  imports:     [AiProxyModule],
  controllers: [QueryController],
  providers:   [QueryService],
  exports:     [QueryService],
})
export class QueryModule {}
