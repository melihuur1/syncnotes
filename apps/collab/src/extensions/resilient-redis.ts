import { Redis as HocuspocusRedis } from '@hocuspocus/extension-redis';
import type {
  afterLoadDocumentPayload,
  afterUnloadDocumentPayload,
  beforeBroadcastStatelessPayload,
  Hocuspocus,
  onAwarenessUpdatePayload,
  onChangePayload,
  onConfigurePayload,
} from '@hocuspocus/server';
import IORedis from 'ioredis';
import type { Logger } from '../logger';

const LOAD_TIMEOUT_MS = 3000;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout;
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`timed out after ${ms}ms`)), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}

export interface ResilientRedisOptions {
  redisUrl: string;
  identifier: string;
  logger: Logger;
}

/**
 * The official Hocuspocus Redis extension (cross-instance document + awareness fan-out),
 * hardened so that a Redis outage degrades the system instead of breaking it:
 *
 * 1. `lockTimeout: 0` — the extension's Redlock would *abort persistence* when Redis is down.
 *    Concurrent stores are serialised by a Postgres row lock + CRDT merge instead.
 * 2. Document loads never block on Redis: while it is unavailable, the subscription is deferred.
 * 3. Publishes are skipped while disconnected (no unbounded offline queue, no log flood).
 * 4. On reconnect every open document re-announces its state vector, so peers exchange exactly
 *    the updates they missed (one resync round instead of replaying a queue).
 *
 * Only public hook methods of the base class are used.
 */
export class ResilientRedisExtension extends HocuspocusRedis {
  private hp?: Hocuspocus;
  private readonly deferred = new Set<string>();
  private wasHealthy = false;
  private everHealthy = false;
  private degradedSince: number | null = null;
  private readonly log: Logger;

  constructor(options: ResilientRedisOptions) {
    const createClient = () =>
      new IORedis(options.redisUrl, {
        maxRetriesPerRequest: 2,
        retryStrategy: (times) => Math.min(times * 200, 1000),
      });
    super({
      identifier: options.identifier,
      prefix: 'syncnotes',
      lockTimeout: 0,
      createClient,
    });
    this.log = options.logger;

    for (const client of [this.pub, this.sub]) {
      client.on('ready', () => this.onClientStatusChange());
      client.on('close', () => this.onClientStatusChange());
      client.on('error', () => {
        /* surfaced through 'close' / isHealthy() */
      });
    }
  }

  isHealthy(): boolean {
    return this.pub.status === 'ready' && this.sub.status === 'ready';
  }

  get degradedForMs(): number {
    return this.degradedSince === null ? 0 : Date.now() - this.degradedSince;
  }

  override async onConfigure(data: onConfigurePayload): Promise<void> {
    this.hp = data.instance;
    await super.onConfigure(data);
  }

  override async afterLoadDocument(data: afterLoadDocumentPayload): Promise<void> {
    if (!this.isHealthy()) {
      this.deferred.add(data.documentName);
      this.log.warn('redis unavailable: document loaded in degraded mode', {
        noteId: data.documentName,
      });
      return;
    }
    try {
      await withTimeout(super.afterLoadDocument(data), LOAD_TIMEOUT_MS);
    } catch (err) {
      this.deferred.add(data.documentName);
      this.log.warn('redis subscription failed: document loaded in degraded mode', {
        noteId: data.documentName,
        error: (err as Error).message,
      });
    }
  }

  override async afterUnloadDocument(data: afterUnloadDocumentPayload): Promise<void> {
    this.deferred.delete(data.documentName);
    if (!this.isHealthy()) return;
    await super.afterUnloadDocument(data);
  }

  override async onChange(data: onChangePayload): Promise<void> {
    if (this.isHealthy()) await super.onChange(data);
  }

  override async onAwarenessUpdate(data: onAwarenessUpdatePayload): Promise<void> {
    if (this.isHealthy()) await super.onAwarenessUpdate(data);
  }

  override async beforeBroadcastStateless(data: beforeBroadcastStatelessPayload): Promise<number> {
    if (!this.isHealthy()) return 0;
    return super.beforeBroadcastStateless(data).catch((err: Error) => {
      this.log.warn('failed to relay stateless message', { error: err.message });
      return 0;
    });
  }

  private onClientStatusChange(): void {
    const healthy = this.isHealthy();
    if (healthy && !this.wasHealthy) {
      const outage = this.degradedForMs;
      this.wasHealthy = true;
      this.degradedSince = null;
      if (this.everHealthy)
        this.log.info('redis recovered: resynchronising open documents', { outageMs: outage });
      else if (outage > 0)
        this.log.info('redis connected after starting in degraded mode', { waitedMs: outage });
      this.everHealthy = true;
      if (outage > 0 || this.deferred.size > 0) void this.resyncOpenDocuments();
    } else if (!healthy && this.wasHealthy) {
      this.wasHealthy = false;
      this.degradedSince = Date.now();
      this.log.warn('redis connection lost: entering degraded mode');
    } else if (
      !healthy &&
      !this.everHealthy &&
      this.degradedSince === null &&
      this.pub.status !== 'connecting' &&
      this.pub.status !== 'wait'
    ) {
      // Booted while Redis is unreachable.
      this.degradedSince = Date.now();
    }
  }

  private async resyncOpenDocuments(): Promise<void> {
    if (!this.hp) return;
    for (const [documentName, document] of this.hp.documents) {
      try {
        if (this.deferred.has(documentName)) {
          this.deferred.delete(documentName);
          await withTimeout(
            super.afterLoadDocument({ documentName, document } as afterLoadDocumentPayload),
            LOAD_TIMEOUT_MS,
          );
        } else {
          // Publishes our state vector; peers answer with whatever we are missing.
          await super.onChange({
            documentName,
            document,
            transactionOrigin: { source: 'local' },
          } as onChangePayload);
        }
      } catch (err) {
        this.deferred.add(documentName);
        this.log.warn('resync failed, will retry on next recovery', {
          noteId: documentName,
          error: (err as Error).message,
        });
      }
    }
  }
}
