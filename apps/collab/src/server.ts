import { Server } from '@hocuspocus/server';
import { createPrismaClient, type PrismaClient } from '@syncnotes/db';
import { AccessEventsSubscriber } from './access-events';
import type { CollabConfig } from './config';
import { AccessControlExtension } from './extensions/access-control';
import { DegradedReconcilerExtension } from './extensions/degraded-reconciler';
import { HealthExtension } from './extensions/health';
import { PersistenceExtension, type SeenStateTracker } from './extensions/persistence';
import { ResilientRedisExtension } from './extensions/resilient-redis';
import { VersionsHandlerExtension } from './extensions/versions-handler';
import { createLogger, type Logger } from './logger';
import { PermissionService } from './permissions';
import { VersionService } from './versions';

export interface CollabServer {
  server: Server;
  config: CollabConfig;
  prisma: PrismaClient;
  permissions: PermissionService;
  redis: ResilientRedisExtension;
  reconciler: DegradedReconcilerExtension;
  accessControl: AccessControlExtension;
  listen(): Promise<number>;
  destroy(): Promise<void>;
}

export interface CreateCollabServerOptions {
  logger?: Logger;
  /** Share a Prisma client (tests); otherwise one is created and owned by the server. */
  prisma?: PrismaClient;
}

/**
 * Composition root of the collaboration server. Extension order matters for hooks that run in
 * sequence (Hocuspocus sorts by `priority`, then by registration order):
 * access control → persistence → versions → redis fan-out → degraded reconciler → health.
 */
export function createCollabServer(
  config: CollabConfig,
  options: CreateCollabServerOptions = {},
): CollabServer {
  const logger =
    options.logger ??
    createLogger(config.INSTANCE_NAME, config.NODE_ENV === 'production' ? 'info' : 'debug');
  const ownsPrisma = !options.prisma;
  const prisma = options.prisma ?? createPrismaClient(config.DATABASE_URL);

  const permissions = new PermissionService(prisma, config.PERMISSION_CACHE_TTL_MS);
  const versions = new VersionService(prisma, config.AUTO_VERSION_KEEP);
  const tracker: SeenStateTracker = new Map();
  const accessEvents = new AccessEventsSubscriber(config.REDIS_URL, logger);

  const redis = new ResilientRedisExtension({
    redisUrl: config.REDIS_URL,
    identifier: config.INSTANCE_NAME,
    logger,
  });
  const accessControl = new AccessControlExtension({
    permissions,
    ticketSecret: config.COLLAB_TICKET_SECRET,
    accessEvents,
    logger,
  });
  const reconciler = new DegradedReconcilerExtension({
    prisma,
    tracker,
    isRedisHealthy: () => redis.isHealthy(),
    intervalMs: config.DEGRADED_RECONCILE_INTERVAL_MS,
    logger,
  });

  const server = new Server({
    name: config.INSTANCE_NAME,
    port: config.COLLAB_PORT,
    quiet: true,
    stopOnSignals: false,
    debounce: config.STORE_DEBOUNCE_MS,
    maxDebounce: config.STORE_MAX_DEBOUNCE_MS,
    unloadImmediately: false,
    websocketOptions: { maxPayload: config.MAX_MESSAGE_BYTES },
    extensions: [
      accessControl,
      new PersistenceExtension({
        prisma,
        versions,
        tracker,
        logger,
        autoVersionIntervalMs: config.AUTO_VERSION_INTERVAL_MINUTES * 60_000,
      }),
      new VersionsHandlerExtension({ versions, permissions, logger }),
      redis,
      reconciler,
      new HealthExtension({
        instanceName: config.INSTANCE_NAME,
        isRedisHealthy: () => redis.isHealthy(),
        startedAt: Date.now(),
      }),
    ],
  });

  let destroyed = false;
  return {
    server,
    config,
    prisma,
    permissions,
    redis,
    reconciler,
    accessControl,
    async listen() {
      await server.listen(config.COLLAB_PORT);
      const port = server.address.port;
      logger.info('collaboration server listening', { port });
      return port;
    },
    async destroy() {
      if (destroyed) return;
      destroyed = true;
      // Persist pending changes before shutting down (graceful restart / deploy).
      server.hocuspocus.flushPendingStores();
      await server.destroy();
      await accessEvents.close();
      if (ownsPrisma) await prisma.$disconnect();
    },
  };
}
