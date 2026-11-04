import type { Extension, Hocuspocus, onConfigurePayload } from '@hocuspocus/server';
import type { PrismaClient } from '@syncnotes/db';
import * as Y from 'yjs';
import { ORIGINS } from '../context';
import type { Logger } from '../logger';
import type { SeenStateTracker } from './persistence';

export interface DegradedReconcilerOptions {
  prisma: PrismaClient;
  tracker: SeenStateTracker;
  isRedisHealthy: () => boolean;
  /** Pass interval while this instance's Redis link is down. */
  intervalMs: number;
  /** Pass interval while healthy (anti-entropy for asymmetric partitions). */
  antiEntropyIntervalMs: number;
  logger: Logger;
}

/**
 * Pulls document state through Postgres when Redis cannot be relied on.
 *
 * - **Degraded** (this instance lost Redis): a pass every `intervalMs`.
 * - **Anti-entropy** (this instance is healthy): a pass every `antiEntropyIntervalMs`. Redis
 *   health is a *local* observation — another instance may be cut off while we are not
 *   (asymmetric partition). Its edits still reach Postgres, and this slow pass brings them to
 *   our clients.
 *
 * Each pass checks whether any open document was persisted by someone else since we last saw
 * it and merges that state into the live doc (which then fans out to this instance's clients).
 * Yjs merges are idempotent, so overlapping with Redis delivery is harmless.
 */
export class DegradedReconcilerExtension implements Extension {
  extensionName = 'syncnotes-degraded-reconciler';
  private timer?: NodeJS.Timeout;
  private instance?: Hocuspocus;
  private running = false;
  private lastPassAt = 0;

  constructor(private readonly options: DegradedReconcilerOptions) {}

  async onConfigure({ instance }: onConfigurePayload): Promise<void> {
    this.instance = instance;
    this.timer = setInterval(() => void this.tick(), this.options.intervalMs);
    this.timer.unref();
  }

  async onDestroy(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
  }

  /** One reconciliation pass (public for tests). Returns the number of documents updated. */
  async tick(force = false): Promise<number> {
    if (this.running || !this.instance) return 0;
    const dueForAntiEntropy = Date.now() - this.lastPassAt >= this.options.antiEntropyIntervalMs;
    if (!force && this.options.isRedisHealthy() && !dueForAntiEntropy) return 0;
    this.lastPassAt = Date.now();
    const names = [...this.instance.documents.keys()];
    if (names.length === 0) return 0;

    this.running = true;
    let merged = 0;
    try {
      const rows = await this.options.prisma.note.findMany({
        where: { id: { in: names } },
        select: { id: true, contentUpdatedAt: true },
      });
      for (const row of rows) {
        const updatedAt = row.contentUpdatedAt?.getTime() ?? 0;
        if (updatedAt <= (this.options.tracker.get(row.id) ?? 0)) continue;

        const note = await this.options.prisma.note.findUnique({
          where: { id: row.id },
          select: { ydocState: true },
        });
        const document = this.instance.documents.get(row.id);
        if (note?.ydocState && document) {
          Y.applyUpdate(document, note.ydocState, ORIGINS.reconcile);
          merged++;
        }
        this.options.tracker.set(row.id, updatedAt);
      }
      if (merged) {
        this.options.logger.info('reconciled documents through postgres', {
          merged,
          mode: this.options.isRedisHealthy() ? 'anti-entropy' : 'degraded',
        });
      }
    } catch (err) {
      this.options.logger.warn('degraded reconcile failed', { error: (err as Error).message });
    } finally {
      this.running = false;
    }
    return merged;
  }
}
