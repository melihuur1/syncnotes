import type {
  beforeHandleMessagePayload,
  Connection,
  Extension,
  Hocuspocus,
  onAuthenticatePayload,
  onConfigurePayload,
} from '@hocuspocus/server';
import {
  type AccessEvent,
  canEdit,
  COLLAB_CLOSE,
  type NoteRole,
  type ServerStatelessMessage,
} from '@syncnotes/shared';
import type { AccessEventsSubscriber } from '../access-events';
import { type CollabContext, contextOf } from '../context';
import type { Logger } from '../logger';
import type { PermissionService } from '../permissions';
import { TicketError, verifyTicket } from '../ticket';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Error shape Hocuspocus understands: `reason` is sent to the client, `code` closes the doc. */
class CollabAccessError extends Error {
  constructor(
    readonly reason: string,
    readonly code: number = COLLAB_CLOSE.accessRevoked.code,
  ) {
    super(reason);
  }
}

function send(connection: Connection, message: ServerStatelessMessage): void {
  connection.sendStateless(JSON.stringify(message));
}

export interface AccessControlOptions {
  permissions: PermissionService;
  ticketSecret: string;
  accessEvents: AccessEventsSubscriber;
  logger: Logger;
  sweepIntervalMs: number;
}

/**
 * Authorisation for the collaboration WebSocket — *never* trusts the client:
 *
 * - handshake: verifies the API-issued ticket, then reads the role from Postgres
 * - viewers get a read-only connection: Hocuspocus drops their sync updates server-side
 * - every inbound message re-checks the (TTL-cached) role, so revocation is enforced even if
 *   the push event below is lost
 * - membership events from the API are applied to live connections immediately:
 *   removed → document connection closed; role changed → read-only flag flipped in place
 */
export class AccessControlExtension implements Extension {
  extensionName = 'syncnotes-access-control';
  private instance?: Hocuspocus;
  private sweepTimer?: NodeJS.Timeout;
  private sweeping = false;

  constructor(private readonly options: AccessControlOptions) {}

  async onConfigure({ instance }: onConfigurePayload): Promise<void> {
    this.instance = instance;
    this.options.accessEvents.on('event', (event) => this.handleAccessEvent(event));
    this.options.accessEvents.on('recovered', () => {
      // Events published while we were disconnected are gone for good: re-check everyone now.
      this.options.permissions.invalidateAll();
      void this.sweep();
    });
    this.sweepTimer = setInterval(() => void this.sweep(), this.options.sweepIntervalMs);
    this.sweepTimer.unref();
  }

  async onDestroy(): Promise<void> {
    if (this.sweepTimer) clearInterval(this.sweepTimer);
  }

  /**
   * Re-authorises every open connection against Postgres (one query per open document).
   *
   * `beforeHandleMessage` only runs when a client *sends* something. A connection that stays
   * silent — a tampered client, or a normal one between awareness renewals — would otherwise
   * keep *receiving* updates after its access was revoked, whenever the Redis event is lost.
   * The sweep bounds that window to `sweepIntervalMs` for every connection.
   */
  async sweep(): Promise<number> {
    if (this.sweeping || !this.instance) return 0;
    this.sweeping = true;
    let closed = 0;
    try {
      for (const [noteId, document] of this.instance.documents) {
        const connections = document.getConnections();
        const userIds = [
          ...new Set(connections.map((c) => contextOf(c)?.user.id).filter(Boolean)),
        ] as string[];
        if (userIds.length === 0) continue;

        const roles = await this.options.permissions.refreshMany(noteId, userIds);
        for (const connection of connections) {
          const userId = contextOf(connection)?.user.id;
          if (!userId) continue;
          const role = roles.get(userId) ?? null;
          if (role) {
            this.applyRole(connection, role);
          } else {
            send(connection, { type: 'access.revoked' });
            connection.close(COLLAB_CLOSE.accessRevoked);
            closed++;
          }
        }
      }
      if (closed) this.options.logger.info('permission sweep closed connections', { closed });
    } catch (err) {
      // Postgres unavailable: keep current permissions (same policy as the per-message check).
      this.options.logger.warn('permission sweep failed', { error: (err as Error).message });
    } finally {
      this.sweeping = false;
    }
    return closed;
  }

  async onAuthenticate({
    token,
    documentName,
    connectionConfig,
  }: onAuthenticatePayload): Promise<CollabContext> {
    if (!UUID_RE.test(documentName)) throw new CollabAccessError('invalid-document');

    let claims;
    try {
      claims = verifyTicket(token, this.options.ticketSecret, documentName);
    } catch (err) {
      this.options.logger.info('rejected collaboration handshake', {
        documentName,
        reason: err instanceof TicketError ? err.message : 'unknown',
      });
      throw new CollabAccessError('invalid-ticket');
    }

    const role = await this.options.permissions.getRole(claims.sub, documentName, { fresh: true });
    if (!role) throw new CollabAccessError('not-a-member');

    connectionConfig.readOnly = !canEdit(role);
    return { user: { id: claims.sub, name: claims.name }, noteId: documentName, role };
  }

  async beforeHandleMessage({
    connection,
    documentName,
  }: beforeHandleMessagePayload): Promise<void> {
    const ctx = contextOf(connection);
    if (!ctx) throw new CollabAccessError('unauthenticated');

    const role = await this.options.permissions.getRole(ctx.user.id, documentName);
    if (!role) {
      send(connection, { type: 'access.revoked' });
      throw new CollabAccessError(COLLAB_CLOSE.accessRevoked.reason);
    }
    this.applyRole(connection, role);
  }

  /** Exposed for tests and for the stateless handler. */
  connectionsFor(noteId: string, userId?: string): Connection[] {
    const document = this.instance?.documents.get(noteId);
    if (!document) return [];
    return document
      .getConnections()
      .filter((c) => (userId ? contextOf(c)?.user.id === userId : true));
  }

  private handleAccessEvent(event: AccessEvent): void {
    const { permissions, logger } = this.options;
    switch (event.type) {
      case 'member.removed': {
        permissions.set(event.userId, event.noteId, null);
        for (const connection of this.connectionsFor(event.noteId, event.userId)) {
          send(connection, { type: 'access.revoked' });
          connection.close(COLLAB_CLOSE.accessRevoked);
        }
        logger.info('access revoked', { noteId: event.noteId, userId: event.userId });
        break;
      }
      case 'member.updated': {
        permissions.set(event.userId, event.noteId, event.role);
        for (const connection of this.connectionsFor(event.noteId, event.userId)) {
          this.applyRole(connection, event.role);
        }
        logger.info('role changed', {
          noteId: event.noteId,
          userId: event.userId,
          role: event.role,
        });
        break;
      }
      case 'note.deleted': {
        permissions.invalidate(event.noteId);
        for (const connection of this.connectionsFor(event.noteId)) {
          send(connection, { type: 'note.deleted' });
          connection.close(COLLAB_CLOSE.noteDeleted);
        }
        logger.info('note deleted', { noteId: event.noteId });
        break;
      }
    }
  }

  /** Flip read-only in place (Hocuspocus checks it on every sync message). */
  private applyRole(connection: Connection, role: NoteRole): void {
    const ctx = contextOf(connection);
    const readOnly = !canEdit(role);
    if (connection.readOnly === readOnly && ctx?.role === role) return;
    connection.readOnly = readOnly;
    if (ctx) ctx.role = role;
    send(connection, { type: 'access.changed', role });
  }
}
