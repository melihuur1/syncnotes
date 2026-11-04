import { EventEmitter } from 'node:events';
import { ACCESS_EVENTS_CHANNEL, type AccessEvent, parseAccessEvent } from '@syncnotes/shared';
import Redis from 'ioredis';
import type { Logger } from './logger';

export interface AccessEventsSubscriberEvents {
  event: [AccessEvent];
  /** Connection (re-)established after having been down — events may have been missed. */
  recovered: [];
}

/**
 * Subscribes to membership changes published by the API.
 * ioredis re-subscribes automatically after reconnects; `recovered` tells listeners that the
 * stream had a gap so cached permissions must be dropped.
 */
export class AccessEventsSubscriber extends EventEmitter<AccessEventsSubscriberEvents> {
  private readonly client: Redis;
  private wasConnected = false;
  private down = false;

  constructor(redisUrl: string, private readonly logger: Logger) {
    super();
    this.client = new Redis(redisUrl, {
      maxRetriesPerRequest: null,
      retryStrategy: (times) => Math.min(times * 200, 1000),
    });
    this.client.on('ready', () => {
      if (this.wasConnected && this.down) {
        this.logger.info('access-events stream recovered');
        this.emit('recovered');
      }
      this.wasConnected = true;
      this.down = false;
    });
    this.client.on('close', () => {
      if (!this.down && this.wasConnected) this.logger.warn('access-events stream lost');
      this.down = true;
    });
    this.client.on('error', () => {
      /* connection errors are reported through 'close' */
    });
    this.client.on('message', (_channel, raw) => {
      const event = parseAccessEvent(raw);
      if (event) this.emit('event', event);
      else this.logger.warn('ignored malformed access event');
    });
    this.client.subscribe(ACCESS_EVENTS_CHANNEL).catch((err: Error) => {
      this.logger.warn('could not subscribe to access events (will retry on reconnect)', {
        error: err.message,
      });
    });
  }

  async close(): Promise<void> {
    this.client.disconnect();
  }
}
