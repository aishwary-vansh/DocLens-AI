import { Controller, Get } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Controller()
export class AppController {
  constructor(private readonly config: ConfigService) {}

  @Get()
  root() {
    return {
      success: true,
      data: {
        name: 'DocLens API',
        version: '1.0.0',
        status: 'healthy',
        environment: this.config.get('NODE_ENV') || 'development',
        timestamp: new Date().toISOString(),
        endpoints: {
          auth: '/api/v1/auth',
          workspaces: '/api/v1/workspaces',
          collections: '/api/v1/collections',
          documents: '/api/v1/documents',
          query: '/api/v1/query',
          graph: '/api/v1/graph',
          docs: '/api/docs',
        },
      },
    };
  }
}
