import type {
  Extension,
  onLoadDocumentPayload,
  onStoreDocumentPayload,
} from '@hocuspocus/server';
import type { Prisma, PrismaClient } from '@syncnotes/db';
import * as Y from 'yjs';
import { ORIGINS } from '../context';
import type { Logger } from '../logger';
import type { VersionService } from '../versions';
import { excerptOf, extractPlainText, extractTitle } from '../ydoc';

/** Last `content_updated_at` this instance has seen per note (shared with the reconciler). */
export type SeenStateTracker = Map<string, number>;

export interface PersistenceOptions {
  prisma: PrismaClient;
  versions: VersionService;
  tracker: SeenStateTracker;
  logger: Logger;
  autoVersionIntervalMs: number;
}

/**
 * Stores each note's Yjs state as a binary update in `notes.ydoc_state`.
 *
 * Merge-on-write: inside a transaction holding the note's row lock we read the persisted state,
 * merge it *into the live document* and write back the union. Because Yjs merges are
 * commutative and idempotent:
 *  - two instances storing the same note can never overwrite each other's updates,
 *  - persistence does not depend on Redis (the Redis extension's lock is disabled),
 *  - while Redis is down, instances still converge through Postgres.
 */
export class PersistenceExtension implements Extension {
  extensionName = 'syncnotes-persistence';

  constructor(private readonly options: PersistenceOptions) {}

  async onLoadDocument({ documentName, document }: onLoadDocumentPayload): Promise<void> {
    const note = await this.options.prisma.note.findUnique({
      where: { id: documentName },
      select: { ydocState: true, contentUpdatedAt: true },
    });
    if (!note) throw new Error(`note ${documentName} not found`);
    if (note.ydocState) Y.applyUpdate(document, note.ydocState);
    this.options.tracker.set(documentName, note.contentUpdatedAt?.getTime() ?? 0);
  }

  async onStoreDocument({ documentName, document, lastContext }: onStoreDocumentPayload): Promise<void> {
    const { prisma, tracker, logger } = this.options;
    const started = Date.now();

    const result = await prisma.$transaction(
      async (tx) => {
        const rows = await tx.$queryRaw<
          Array<{ ydoc_state: Uint8Array | null; created_at: Date }>
        >`SELECT ydoc_state, created_at FROM notes WHERE id = ${documentName}::uuid FOR UPDATE`;
        const row = rows[0];
        if (!row) return null; // note was deleted while open

        if (row.ydoc_state) Y.applyUpdate(document, row.ydoc_state, ORIGINS.persistenceMerge);

        // Copy into a plain ArrayBuffer-backed array (what Prisma's Bytes type expects).
        const state = new Uint8Array(Y.encodeStateAsUpdate(document));
        const plainText = extractPlainText(document);
        const now = new Date();
        await tx.note.update({
          where: { id: documentName },
          data: {
            ydocState: state,
            title: extractTitle(document) || 'Untitled',
            plainText,
            excerpt: excerptOf(plainText),
            contentUpdatedAt: now,
          },
        });

        await this.maybeAutoVersion(tx, documentName, document, row.created_at, plainText, lastContext);
        return { bytes: state.byteLength, at: now.getTime() };
      },
      { timeout: 15_000 },
    );

    if (!result) {
      logger.info('skipped store for deleted note', { noteId: documentName });
      return;
    }
    tracker.set(documentName, result.at);
    logger.debug('stored document', { noteId: documentName, bytes: result.bytes, ms: Date.now() - started });
  }

  private async maybeAutoVersion(
    tx: Prisma.TransactionClient,
    noteId: string,
    document: Y.Doc,
    noteCreatedAt: Date,
    plainText: string,
    lastContext: unknown,
  ): Promise<void> {
    const interval = this.options.autoVersionIntervalMs;
    if (interval <= 0 || (!plainText && !extractTitle(document))) return;

    const latest = await tx.noteVersion.findFirst({
      where: { noteId },
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true },
    });
    const since = (latest?.createdAt ?? noteCreatedAt).getTime();
    if (Date.now() - since < interval) return;

    const userId =
      (lastContext as { user?: { id?: string } } | undefined)?.user?.id ??
      (lastContext as { userId?: string } | undefined)?.userId ??
      null;
    await this.options.versions.createSnapshot(noteId, document, { kind: 'AUTO', userId }, tx);
  }
}
