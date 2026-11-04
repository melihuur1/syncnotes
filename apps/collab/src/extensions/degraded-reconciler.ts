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
  intervalMs: number;
  logger: Logger;
}

/**
 * While Redis is unavailable, instances cannot push updates to each other. This loop pulls
 * them through Postgres instead: every `intervalMs` it checks whether another instance has
 * persisted newer state for any open document and merges it into the live doc (which then
 * fans out to this instance's clients). Merging is idempotent, so overlap with Redis is safe.
 */
export class DegradedReconcilerExtension implements Extension {
  extensionName = 'syncnotes-degraded-reconciler';
  private timer?: NodeJS.Timeout;
  private instance?: Hocuspocus;
  private running = false;

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
    if (!force && this.options.isRedisHealthy()) return 0;
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
      if (merged) this.options.logger.info('reconciled documents through postgres', { merged });
    } catch (err) {
      this.options.logger.warn('degraded reconcile failed', { error: (err as Error).message });
    } finally {
      this.running = false;
    }
    return merged;
  }
}
