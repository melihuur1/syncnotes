import type { PrismaClient } from '@syncnotes/db';
import type { NoteRole } from '@syncnotes/shared';

interface CacheEntry {
  role: NoteRole | null;
  fetchedAt: number;
}

/**
 * Resolves a user's role on a note with a short-lived cache.
 *
 * Revocation has two paths:
 * 1. push — the API publishes an access event over Redis and we `set`/`invalidate` immediately;
 * 2. pull — entries expire after `ttlMs`, so even if an event is lost (Redis down) a revoked
 *    user is cut off within `ttlMs` on their next message.
 *
 * If Postgres itself is unreachable we keep serving the last known role (availability over a
 * brief window), and refuse when nothing is known (fail closed).
 */
export class PermissionService {
  private readonly cache = new Map<string, CacheEntry>();
  private readonly inflight = new Map<string, Promise<NoteRole | null>>();

  constructor(
    private readonly prisma: PrismaClient,
    private readonly ttlMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  async getRole(
    userId: string,
    noteId: string,
    options: { fresh?: boolean } = {},
  ): Promise<NoteRole | null> {
    const key = this.key(userId, noteId);
    const cached = this.cache.get(key);
    if (!options.fresh && cached && this.now() - cached.fetchedAt < this.ttlMs) return cached.role;

    const pending = this.inflight.get(key);
    if (pending) return pending;

    const lookup = this.fetch(userId, noteId)
      .then((role) => {
        this.cache.set(key, { role, fetchedAt: this.now() });
        return role;
      })
      .catch((err: unknown) => {
        if (cached) return cached.role; // DB blip: keep last known permission
        throw err;
      })
      .finally(() => this.inflight.delete(key));
    this.inflight.set(key, lookup);
    return lookup;
  }

  /** Apply a pushed role change without a DB round-trip. */
  set(userId: string, noteId: string, role: NoteRole | null): void {
    this.cache.set(this.key(userId, noteId), { role, fetchedAt: this.now() });
  }

  invalidate(noteId: string, userId?: string): void {
    if (userId) {
      this.cache.delete(this.key(userId, noteId));
      return;
    }
    for (const key of this.cache.keys()) if (key.endsWith(`:${noteId}`)) this.cache.delete(key);
  }

  /** After a Redis outage we may have missed events: forget everything. */
  invalidateAll(): void {
    this.cache.clear();
  }

  private async fetch(userId: string, noteId: string): Promise<NoteRole | null> {
    const membership = await this.prisma.noteMember.findUnique({
      where: { noteId_userId: { noteId, userId } },
      select: { role: true },
    });
    return membership?.role ?? null;
  }

  private key(userId: string, noteId: string): string {
    return `${userId}:${noteId}`;
  }
}
