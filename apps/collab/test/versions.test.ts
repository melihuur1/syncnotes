import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  bodyText,
  closeShared,
  connect,
  connected,
  createNote,
  db,
  flush,
  type RunningCollab,
  sleep,
  startCollab,
  type TestClient,
  ticket,
  waitFor,
} from './harness';

describe('version history', () => {
  let collab: RunningCollab;
  const clients: TestClient[] = [];
  const open = (...args: Parameters<typeof connect>) => {
    const client = connect(...args);
    clients.push(client);
    return connected(client);
  };
  const versionsOf = (noteId: string) =>
    db().noteVersion.findMany({ where: { noteId }, orderBy: { createdAt: 'asc' } });

  beforeAll(async () => {
    collab = await startCollab();
  });
  afterEach(() => clients.splice(0).forEach((c) => c.destroy()));
  afterAll(async () => {
    await collab.destroy();
    await closeShared();
  });

  it('creates a manual snapshot and notifies every collaborator', async () => {
    const note = await createNote();
    const editor = await note.member('EDITOR');
    const owner = await open(collab, note.noteId, ticket(note.owner, note.noteId));
    const e = await open(collab, note.noteId, ticket(editor, note.noteId));
    owner.doc.getText('title').insert(0, 'Spec');
    owner.type('first draft');
    await waitFor(() => e.text() === 'first draft');

    e.send({ type: 'version.create', label: 'Draft 1' });
    await waitFor(() => owner.stateless.some((m) => m.type === 'versions.changed'));

    const [version] = await versionsOf(note.noteId);
    expect(version).toMatchObject({ kind: 'MANUAL', label: 'Draft 1', createdById: editor.id });
    expect(version!.sizeBytes).toBe(version!.state.byteLength);
  });

  it('restores a version as a forward edit that reaches all clients', async () => {
    const note = await createNote();
    const editor = await note.member('EDITOR');
    const owner = await open(collab, note.noteId, ticket(note.owner, note.noteId));
    const e = await open(collab, note.noteId, ticket(editor, note.noteId));
    owner.doc.getText('title').insert(0, 'Plan A');
    owner.type('version one');
    await waitFor(() => e.text() === 'version one');
    owner.send({ type: 'version.create', label: 'v1' });
    await waitFor(async () => (await versionsOf(note.noteId)).length === 1);

    owner.type(' -> later changes');
    owner.doc.getText('title').insert(6, ' (revised)');
    await waitFor(() => e.text() === 'version one -> later changes');

    const [v1] = await versionsOf(note.noteId);
    e.send({ type: 'version.restore', versionId: v1!.id });

    for (const client of [owner, e]) {
      await waitFor(() => client.text() === 'version one' && client.doc.getText('title').toString() === 'Plan A');
    }
    await waitFor(() => owner.stateless.some((m) => m.type === 'version.restored' && m.by === 'Editor'));

    // The pre-restore state was kept, so the restore itself can be undone.
    const versions = await versionsOf(note.noteId);
    expect(versions.map((v) => v.kind)).toEqual(['MANUAL', 'RESTORE']);
    expect(versions[1]!.label).toBe('Before restoring "v1"');

    // Editing continues normally after a restore and is persisted.
    e.type(' + after restore');
    await waitFor(() => owner.text() === 'version one + after restore');
    await flush(collab);
    const row = await db().note.findUniqueOrThrow({ where: { id: note.noteId } });
    expect(row.title).toBe('Plan A');
  });

  it('refuses version commands from viewers', async () => {
    const note = await createNote();
    const viewer = await note.member('VIEWER');
    const v = await open(collab, note.noteId, ticket(viewer, note.noteId));
    v.send({ type: 'version.create', label: 'nope' });
    await waitFor(() => v.stateless.some((m) => m.type === 'error' && m.code === 'forbidden'));
    expect(await versionsOf(note.noteId)).toHaveLength(0);
  });

  it('only restores versions that belong to the same note', async () => {
    const a = await createNote();
    const b = await createNote();
    const ownerA = await open(collab, a.noteId, ticket(a.owner, a.noteId));
    const ownerB = await open(collab, b.noteId, ticket(b.owner, b.noteId));
    ownerB.type('secret of B');
    ownerB.send({ type: 'version.create' });
    await waitFor(async () => (await versionsOf(b.noteId)).length === 1);
    const [versionOfB] = await versionsOf(b.noteId);

    ownerA.send({ type: 'version.restore', versionId: versionOfB!.id });
    await waitFor(() => ownerA.stateless.some((m) => m.type === 'error' && m.code === 'not-found'));
    ownerA.send({ type: 'version.restore', versionId: 'not-a-uuid' });
    await waitFor(() => ownerA.stateless.some((m) => m.type === 'error' && m.code === 'invalid'));
    expect(ownerA.text()).toBe('');
  });

  it('takes automatic snapshots on store when the interval has elapsed', async () => {
    const auto = await startCollab({ AUTO_VERSION_INTERVAL_MINUTES: 0.001 }); // 60ms
    try {
      const note = await createNote();
      const client = connect(auto, note.noteId, ticket(note.owner, note.noteId));
      clients.push(client);
      await connected(client);
      client.type('autosaved content');
      await sleep(200);
      await flush(auto);
      await waitFor(async () => (await versionsOf(note.noteId)).some((v) => v.kind === 'AUTO'));
      const [snapshot] = await versionsOf(note.noteId);
      const { applyUpdate, Doc } = await import('yjs');
      const doc = new Doc();
      applyUpdate(doc, snapshot!.state);
      expect(bodyText(doc)).toBe('autosaved content');
    } finally {
      await auto.destroy();
    }
  });
});
