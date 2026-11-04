import type { Connection, Extension, onStatelessPayload } from '@hocuspocus/server';
import {
  canEdit,
  type ClientStatelessMessage,
  parseStatelessMessage,
  type ServerStatelessMessage,
} from '@syncnotes/shared';
import { contextOf } from '../context';
import type { Logger } from '../logger';
import type { PermissionService } from '../permissions';
import { VersionNotFoundError, type VersionService } from '../versions';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function reply(connection: Connection, message: ServerStatelessMessage): void {
  connection.sendStateless(JSON.stringify(message));
}

/**
 * Handles version commands sent over the (already authenticated) document connection.
 * The live Y.Doc only exists here, so snapshots are exact and restores are applied as normal
 * CRDT edits that every replica receives.
 */
export class VersionsHandlerExtension implements Extension {
  extensionName = 'syncnotes-versions';

  constructor(
    private readonly deps: { versions: VersionService; permissions: PermissionService; logger: Logger },
  ) {}

  async onStateless({ connection, document, documentName, payload }: onStatelessPayload): Promise<void> {
    const message = parseStatelessMessage<ClientStatelessMessage>(payload);
    if (!message || (message.type !== 'version.create' && message.type !== 'version.restore')) return;

    const ctx = contextOf(connection);
    if (!ctx) return;
    // Mutating commands always use a fresh role (no cache).
    const role = await this.deps.permissions.getRole(ctx.user.id, documentName, { fresh: true });
    if (!canEdit(role)) {
      reply(connection, { type: 'error', code: 'forbidden', message: 'Only editors can manage versions' });
      return;
    }

    try {
      if (message.type === 'version.create') {
        await this.deps.versions.createSnapshot(documentName, document, {
          kind: 'MANUAL',
          label: typeof message.label === 'string' ? message.label : null,
          userId: ctx.user.id,
        });
        document.broadcastStateless(JSON.stringify({ type: 'versions.changed' } satisfies ServerStatelessMessage));
        return;
      }

      if (typeof message.versionId !== 'string' || !UUID_RE.test(message.versionId)) {
        reply(connection, { type: 'error', code: 'invalid', message: 'Invalid version id' });
        return;
      }
      await this.deps.versions.restore(documentName, document, message.versionId, ctx.user.id);
      document.broadcastStateless(
        JSON.stringify({
          type: 'version.restored',
          versionId: message.versionId,
          by: ctx.user.name,
        } satisfies ServerStatelessMessage),
      );
      document.broadcastStateless(JSON.stringify({ type: 'versions.changed' } satisfies ServerStatelessMessage));
      this.deps.logger.info('version restored', { noteId: documentName, versionId: message.versionId });
    } catch (err) {
      if (err instanceof VersionNotFoundError) {
        reply(connection, { type: 'error', code: 'not-found', message: 'Version not found' });
        return;
      }
      this.deps.logger.error('version command failed', { noteId: documentName, error: (err as Error).message });
      reply(connection, { type: 'error', code: 'internal', message: 'Could not complete the version command' });
    }
  }
}
