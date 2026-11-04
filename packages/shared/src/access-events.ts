import type { NoteRole } from './roles';

/**
 * Redis pub/sub channel the API publishes membership changes to.
 * Every collaboration-server instance subscribes and enforces the change on
 * already-open WebSocket connections (close on revoke, downgrade to read-only, ...).
 */
export const ACCESS_EVENTS_CHANNEL = 'syncnotes:access-events';

export type AccessEvent =
  | { type: 'member.updated'; noteId: string; userId: string; role: NoteRole; at: number }
  | { type: 'member.removed'; noteId: string; userId: string; at: number }
  | { type: 'note.deleted'; noteId: string; at: number };

export function serializeAccessEvent(event: AccessEvent): string {
  return JSON.stringify(event);
}

export function parseAccessEvent(raw: string): AccessEvent | null {
  try {
    const value = JSON.parse(raw) as Partial<AccessEvent>;
    if (!value || typeof value !== 'object' || typeof value.noteId !== 'string') return null;
    switch (value.type) {
      case 'member.updated':
        return typeof value.userId === 'string' && typeof value.role === 'string'
          ? (value as AccessEvent)
          : null;
      case 'member.removed':
        return typeof value.userId === 'string' ? (value as AccessEvent) : null;
      case 'note.deleted':
        return value as AccessEvent;
      default:
        return null;
    }
  } catch {
    return null;
  }
}
