import { Inject, Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ACCESS_EVENTS_CHANNEL, AccessEvent, serializeAccessEvent } from '@syncnotes/shared';
import Redis from 'ioredis';
import { APP_CONFIG, AppConfig } from '../config/env';

type DistributiveOmit<T, K extends keyof never> = T extends unknown ? Omit<T, K> : never;
export type AccessEventInput = DistributiveOmit<AccessEvent, 'at'>;

/**
 * Publishes membership changes so every collaboration-server instance can enforce them on
 * already-open WebSocket sessions.
 *
 * Postgres is the source of truth; this is a *latency optimisation*. If Redis is unavailable
 * the publish is dropped after a short timeout (the HTTP request still succeeds) and the
 * collaboration server falls back to its TTL-bounded permission re-check.
 */
@Injectable()
export class AccessEventsPublisher implements OnModuleDestroy {
  private readonly logger = new Logger(AccessEventsPublisher.name);
  private readonly redis: Redis;
  private static readonly PUBLISH_TIMEOUT_MS = 1000;

  constructor(@Inject(APP_CONFIG) config: AppConfig) {
    this.redis = new Redis(config.REDIS_URL, {
      lazyConnect: false,
      maxRetriesPerRequest: 2,
      enableOfflineQueue: true,
    });
    this.redis.on('error', (err) => this.logger.warn(`Redis error: ${err.message}`));
  }

  /** Resolves `true` when the event reached Redis, `false` otherwise. Never throws. */
  async publish(event: AccessEventInput): Promise<boolean> {
    const payload = serializeAccessEvent({ ...event, at: Date.now() } as AccessEvent);
    let timer: NodeJS.Timeout | undefined;
    try {
      await Promise.race([
        this.redis.publish(ACCESS_EVENTS_CHANNEL, payload),
        new Promise((_, reject) => {
          timer = setTimeout(
            () => reject(new Error('publish timed out')),
            AccessEventsPublisher.PUBLISH_TIMEOUT_MS,
          );
        }),
      ]);
      return true;
    } catch (err) {
      this.logger.warn(
        `Could not publish ${event.type} for note ${event.noteId}: ${(err as Error).message}. ` +
          'Collaboration servers will converge via their permission re-check TTL.',
      );
      return false;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  async ping(): Promise<boolean> {
    try {
      return (await this.redis.ping()) === 'PONG';
    } catch {
      return false;
    }
  }

  async onModuleDestroy(): Promise<void> {
    this.redis.disconnect();
  }
}
