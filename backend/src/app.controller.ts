import { Controller, Get } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AiProxyService } from './ai-proxy/ai-proxy.service';

@Controller()
export class AppController {
  constructor(
    private readonly config: ConfigService,
    private readonly ai: AiProxyService,
  ) {}

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
          health: '/api/v1/health',
          docs: '/api/docs',
        },
      },
    };
  }

  /**
   * GET /health — public liveness of the API and of the AI service behind it.
   * The browser cannot reach the AI service directly (it is internal), so the
   * UI status lights use this instead. Never exposes errors or secrets.
   */
  @Get('health')
  async health() {
    let ai: { ok: boolean; modelsLoaded?: boolean } = { ok: false };
    try {
      const res: any = await this.ai.health();
      ai = { ok: true, modelsLoaded: res?.models_loaded ?? undefined };
    } catch {
      ai = { ok: false };
    }
    return { api: { ok: true }, ai, timestamp: new Date().toISOString() };
  }
}
