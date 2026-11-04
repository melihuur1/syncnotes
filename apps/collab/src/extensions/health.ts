import type { Extension, onRequestPayload } from '@hocuspocus/server';

/** `GET /health` on the collaboration port (used by Docker health checks and the load balancer). */
export class HealthExtension implements Extension {
  extensionName = 'syncnotes-health';

  constructor(
    private readonly deps: {
      instanceName: string;
      isRedisHealthy: () => boolean;
      startedAt: number;
    },
  ) {}

  async onRequest({ request, response, instance }: onRequestPayload): Promise<void> {
    if (!request.url?.startsWith('/health')) return;
    const redis = this.deps.isRedisHealthy();
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(
      JSON.stringify({
        status: 'ok',
        instance: this.deps.instanceName,
        redis: redis ? 'up' : 'degraded',
        documents: instance.getDocumentsCount(),
        connections: instance.getConnectionsCount(),
        uptimeSeconds: Math.round((Date.now() - this.deps.startedAt) / 1000),
      }),
    );
    // Rejecting with a falsy value tells Hocuspocus the request has been handled.
    throw null;
  }
}
