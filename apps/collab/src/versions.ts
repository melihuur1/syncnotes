import type { Prisma, PrismaClient } from '@syncnotes/db';
import type * as Y from 'yjs';
import { ORIGINS } from './context';
import { applyContentReplacement, encodeContentSnapshot } from './ydoc';

type Db = PrismaClient | Prisma.TransactionClient;
export type VersionKind = 'MANUAL' | 'AUTO' | 'RESTORE';

export class VersionNotFoundError extends Error {}

export interface SnapshotOptions {
  kind: VersionKind;
  label?: string | null;
  userId?: string | null;
}

/** Creates and restores version snapshots of a live document. */
export class VersionService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly autoKeep: number,
  ) {}

  async createSnapshot(
    noteId: string,
    document: Y.Doc,
    options: SnapshotOptions,
    db: Db = this.prisma,
  ) {
    const state = new Uint8Array(encodeContentSnapshot(document));
    const version = await db.noteVersion.create({
      data: {
        noteId,
        kind: options.kind,
        label: options.label?.trim().slice(0, 80) || null,
        state,
        sizeBytes: state.byteLength,
        createdById: options.userId ?? null,
      },
      select: { id: true, createdAt: true },
    });
    if (options.kind === 'AUTO') await this.pruneAuto(noteId, db);
    return version;
  }

  /**
   * Restores `versionId` into the live document.
   * The current content is snapshotted first (kind RESTORE) so a restore can itself be undone.
   */
  async restore(noteId: string, document: Y.Doc, versionId: string, userId: string): Promise<void> {
    const version = await this.prisma.noteVersion.findFirst({
      where: { id: versionId, noteId },
      select: { state: true, label: true, createdAt: true },
    });
    if (!version) throw new VersionNotFoundError(versionId);

    const name = version.label ?? version.createdAt.toISOString().slice(0, 16).replace('T', ' ');
    await this.createSnapshot(noteId, document, {
      kind: 'RESTORE',
      label: `Before restoring "${name}"`,
      userId,
    });
    applyContentReplacement(document, version.state, ORIGINS.restore(userId));
  }

  private async pruneAuto(noteId: string, db: Db): Promise<void> {
    const stale = await db.noteVersion.findMany({
      where: { noteId, kind: 'AUTO' },
      orderBy: { createdAt: 'desc' },
      skip: this.autoKeep,
      select: { id: true },
    });
    if (stale.length) {
      await db.noteVersion.deleteMany({ where: { id: { in: stale.map((v) => v.id) } } });
    }
  }
}
