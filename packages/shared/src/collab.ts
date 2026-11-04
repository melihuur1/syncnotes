import type { NoteRole } from './roles';

/** `aud` claim of collaboration tickets — a ticket can never be replayed as an API access token. */
export const COLLAB_TICKET_AUDIENCE = 'syncnotes-collab';
export const COLLAB_TICKET_ISSUER = 'syncnotes-api';

/** Claims inside the short-lived, document-scoped ticket the API issues for the WebSocket handshake. */
export interface CollabTicketClaims {
  /** user id */
  sub: string;
  /** note id (== Hocuspocus document name) */
  nid: string;
  /** display name, used for presence */
  name: string;
}

/** Names of the shared types inside every note's Y.Doc. */
export const YDOC_FIELDS = {
  /** Y.XmlFragment bound to the Tiptap editor (Tiptap's default field name). */
  content: 'default',
  /** Y.Text holding the collaboratively edited title. */
  title: 'title',
} as const;

/** WebSocket close / stateless codes the collaboration server uses. */
export const COLLAB_CLOSE = {
  accessRevoked: { code: 4403, reason: 'access-revoked' },
  noteDeleted: { code: 4404, reason: 'note-deleted' },
} as const;

/** Client → server stateless messages (sent over the authenticated document connection). */
export type ClientStatelessMessage =
  { type: 'version.create'; label?: string } | { type: 'version.restore'; versionId: string };

/** Server → client stateless messages. */
export type ServerStatelessMessage =
  | { type: 'versions.changed' }
  | { type: 'version.restored'; versionId: string; by: string }
  | { type: 'access.changed'; role: NoteRole }
  | { type: 'access.revoked' }
  | { type: 'note.deleted' }
  | { type: 'error'; code: 'forbidden' | 'not-found' | 'invalid' | 'internal'; message: string };

export function parseStatelessMessage<T extends { type: string }>(payload: string): T | null {
  try {
    const value = JSON.parse(payload) as T;
    return value && typeof value === 'object' && typeof value.type === 'string' ? value : null;
  } catch {
    return null;
  }
}
