// src/ai-proxy/ai-proxy.service.spec.ts
// ─────────────────────────────────────────────────────────────────────────────
// Long AI calls (/ingest, /embed) must not hit fetch's fixed 300 s header
// limit: they go over node:http, bounded only by their own timeout. A local
// HTTP server stands in for the AI service.
// ─────────────────────────────────────────────────────────────────────────────
import { HttpException } from '@nestjs/common';
import { createServer, IncomingMessage, Server, ServerResponse } from 'node:http';
import { AddressInfo } from 'node:net';
import { AiProxyService } from './ai-proxy.service';

type Handler = (req: IncomingMessage, res: ServerResponse, body: string) => void;

async function startServer(handler: Handler): Promise<{ server: Server; url: string }> {
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => handler(req, res, body));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return { server, url: `http://127.0.0.1:${port}` };
}

function makeProxy(url: string) {
  const values: Record<string, string> = { AI_SERVICE_URL: url, INTERNAL_API_SECRET: 'test-secret' };
  return new AiProxyService({ get: (key: string) => values[key] } as any);
}

describe('AiProxyService — long calls', () => {
  let server: Server | undefined;
  afterEach(async () => {
    server?.closeAllConnections();
    await new Promise((resolve) => server?.close(resolve));
    server = undefined;
  });

  it('sends /embed over node:http with the secret and returns the JSON body', async () => {
    let seen: { secret?: string; body?: string; path?: string } = {};
    const started = await startServer((req, res, body) => {
      seen = { secret: req.headers['x-internal-secret'] as string, body, path: req.url };
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'completed', chunks: 81 }));
    });
    server = started.server;

    const result = await makeProxy(started.url).embedDocument('doc-1');

    expect(result).toEqual({ status: 'completed', chunks: 81 });
    expect(seen).toEqual({ secret: 'test-secret', body: JSON.stringify({ documentId: 'doc-1' }), path: '/embed' });
  });

  it('keeps the AI service error status', async () => {
    const started = await startServer((_req, res) => {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end('{"detail":"bad path"}');
    });
    server = started.server;

    await expect(makeProxy(started.url).embedDocument('doc-1')).rejects.toMatchObject({ status: 400 });
  });

  it('reports its own timeout as 504, not as "service unavailable"', async () => {
    const started = await startServer(() => undefined); // never answers
    server = started.server;
    const proxy: any = makeProxy(started.url);

    const error = await proxy
      .longRequest('/embed', 'POST', {}, AbortSignal.timeout(100))
      .catch((e: unknown) => proxy.toHttpError(e, '/embed'));

    expect(error).toBeInstanceOf(HttpException);
    expect(error.getStatus()).toBe(504);
  });
});
