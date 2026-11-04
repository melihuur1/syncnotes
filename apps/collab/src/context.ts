import type { Connection } from '@hocuspocus/server';
import type { NoteRole } from '@syncnotes/shared';

/** Per-connection context established in `onAuthenticate`. */
export interface CollabContext {
  user: { id: string; name: string };
  noteId: string;
  role: NoteRole;
}

export function contextOf(connection: Connection): CollabContext | undefined {
  const ctx = connection.context as Partial<CollabContext> | undefined;
  return ctx?.user && ctx.noteId ? (ctx as CollabContext) : undefined;
}

/** Transaction origins used for server-side writes to a live document. */
export const ORIGINS = {
  /** State merged in from Postgres while persisting — already stored, so skip store hooks. */
  persistenceMerge: {
    source: 'local',
    skipStoreHooks: true,
    context: { reason: 'persistence-merge' },
  },
  /** State pulled from Postgres by the degraded-mode reconciler. */
  reconcile: { source: 'local', skipStoreHooks: true, context: { reason: 'reconcile' } },
  /** Restoring a version is a real edit: it must be stored and broadcast. */
  restore: (userId: string) => ({ source: 'local', context: { reason: 'restore', userId } }),
} as const;
