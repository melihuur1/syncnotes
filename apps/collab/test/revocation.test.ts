import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  closeShared,
  connect,
  connected,
  createNote,
  db,
  publishAccessEvent,
  type RunningCollab,
  serverDoc,
  sleep,
  startCollab,
  type TestClient,
  ticket,
  waitFor,
  bodyText,
} from './harness';

describe('access changes on live WebSocket sessions', () => {
  let collab: RunningCollab;
  const clients: TestClient[] = [];
  const open = (...args: Parameters<typeof connect>) => {
    const client = connect(...args);
    clients.push(client);
    return connected(client);
  };
  const serverText = (noteId: string) => bodyText(serverDoc(collab, noteId)!);

  beforeAll(async () => {
    // Automatic sweep disabled here so each mechanism (push, per-message TTL, sweep) is
    // exercised in isolation; the sweep test triggers it explicitly.
    collab = await startCollab({
      PERMISSION_CACHE_TTL_MS: 400,
      PERMISSION_SWEEP_INTERVAL_MS: 3_600_000,
    });
  });
  afterEach(() => clients.splice(0).forEach((c) => c.destroy()));
  afterAll(async () => {
    await collab.destroy();
    await closeShared();
  });

  it('closes the session immediately when the member is removed (push via Redis)', async () => {
    const note = await createNote();
    const editor = await note.member('EDITOR');
    const owner = await open(collab, note.noteId, ticket(note.owner, note.noteId));
    const e = await open(collab, note.noteId, ticket(editor, note.noteId));
    e.type('before');
    await waitFor(() => owner.text() === 'before');

    await db().noteMember.delete({
      where: { noteId_userId: { noteId: note.noteId, userId: editor.id } },
    });
    await publishAccessEvent({ type: 'member.removed', noteId: note.noteId, userId: editor.id });

    await waitFor(() => e.stateless.some((m) => m.type === 'access.revoked'), { timeout: 1000 });
    await waitFor(() => collab.accessControl.connectionsFor(note.noteId, editor.id).length === 0);

    e.type(' after-revocation');
    await sleep(400);
    expect(serverText(note.noteId)).toBe('before');
    expect(owner.text()).toBe('before');
  });

  it('enforces revocation within the cache TTL even when the Redis event is lost', async () => {
    const note = await createNote();
    const editor = await note.member('EDITOR');
    const owner = await open(collab, note.noteId, ticket(note.owner, note.noteId));
    const e = await open(collab, note.noteId, ticket(editor, note.noteId));
    e.type('ok');
    await waitFor(() => owner.text() === 'ok');

    // Membership removed in Postgres, but *no* event published.
    await db().noteMember.delete({
      where: { noteId_userId: { noteId: note.noteId, userId: editor.id } },
    });
    await sleep(500); // > PERMISSION_CACHE_TTL_MS

    e.type(' sneaky');
    await waitFor(() => e.stateless.some((m) => m.type === 'access.revoked'));
    expect(serverText(note.noteId)).toBe('ok');
    expect(owner.text()).toBe('ok');
  });

  it('cuts off a silent reader whose revocation event was lost (permission sweep)', async () => {
    const note = await createNote();
    const editor = await note.member('EDITOR');
    const owner = await open(collab, note.noteId, ticket(note.owner, note.noteId));
    const reader = await open(collab, note.noteId, ticket(editor, note.noteId));
    owner.type('before');
    await waitFor(() => reader.text() === 'before');

    // Revoked in Postgres, event lost. The reader never sends a message, so the per-message
    // check never runs for it — this is the gap the sweep exists for.
    await db().noteMember.delete({
      where: { noteId_userId: { noteId: note.noteId, userId: editor.id } },
    });
    await sleep(500); // > PERMISSION_CACHE_TTL_MS
    owner.type(' leaked');
    await waitFor(() => reader.text() === 'before leaked');

    expect(await collab.accessControl.sweep()).toBe(1);
    await waitFor(() => reader.stateless.some((m) => m.type === 'access.revoked'));
    expect(collab.accessControl.connectionsFor(note.noteId, editor.id)).toHaveLength(0);

    owner.type(' secret');
    await waitFor(() => owner.text() === 'before leaked secret');
    await sleep(300);
    expect(reader.text()).toBe('before leaked');
  });

  it('runs the permission sweep automatically on its interval', async () => {
    const sweeping = await startCollab({ PERMISSION_SWEEP_INTERVAL_MS: 250 });
    try {
      const note = await createNote();
      const editor = await note.member('EDITOR');
      const reader = connect(sweeping, note.noteId, ticket(editor, note.noteId));
      clients.push(reader);
      await connected(reader);
      await db().noteMember.delete({
        where: { noteId_userId: { noteId: note.noteId, userId: editor.id } },
      });
      await waitFor(() => reader.stateless.some((m) => m.type === 'access.revoked'), {
        timeout: 2000,
      });
    } finally {
      await sweeping.destroy();
    }
  });

  const setRole = async (noteId: string, userId: string, role: 'EDITOR' | 'VIEWER') => {
    await db().noteMember.update({ where: { noteId_userId: { noteId, userId } }, data: { role } });
    await publishAccessEvent({ type: 'member.updated', noteId, userId, role });
  };

  it('downgrades an editor to read-only in place (no reconnect)', async () => {
    const note = await createNote();
    const editor = await note.member('EDITOR');
    await open(collab, note.noteId, ticket(note.owner, note.noteId));
    const e = await open(collab, note.noteId, ticket(editor, note.noteId));

    await setRole(note.noteId, editor.id, 'VIEWER');
    await waitFor(() =>
      e.stateless.some((m) => m.type === 'access.changed' && m.role === 'VIEWER'),
    );

    e.type('ignored');
    await sleep(300);
    expect(serverText(note.noteId)).toBe('');
  });

  it('upgrades a viewer to editor in place (no reconnect)', async () => {
    const note = await createNote();
    const viewer = await note.member('VIEWER');
    const owner = await open(collab, note.noteId, ticket(note.owner, note.noteId));
    const v = await open(collab, note.noteId, ticket(viewer, note.noteId));

    await setRole(note.noteId, viewer.id, 'EDITOR');
    await waitFor(() =>
      v.stateless.some((m) => m.type === 'access.changed' && m.role === 'EDITOR'),
    );

    v.type('now I can edit');
    await waitFor(() => owner.text() === 'now I can edit');
  });

  it('keeps the document intact when a client keeps editing after its updates were rejected', async () => {
    // Yjs requires causal delivery: once the server drops a client's update, that client's later
    // updates reference structs the server never saw and are held back (never integrated).
    // The web client therefore discards its replica and resyncs whenever its role changes.
    const note = await createNote();
    const editor = await note.member('EDITOR');
    const owner = await open(collab, note.noteId, ticket(note.owner, note.noteId));
    const stale = await open(collab, note.noteId, ticket(editor, note.noteId));

    await setRole(note.noteId, editor.id, 'VIEWER');
    await waitFor(() => stale.stateless.some((m) => m.type === 'access.changed'));
    stale.type('rejected');
    await sleep(200);
    await setRole(note.noteId, editor.id, 'EDITOR');
    await waitFor(() =>
      stale.stateless.some((m) => m.type === 'access.changed' && m.role === 'EDITOR'),
    );

    stale.type(' + depends on rejected');
    await sleep(300);
    expect(serverText(note.noteId)).toBe('');

    // A fresh replica (what the web client creates on role change) edits normally.
    const fresh = await open(collab, note.noteId, ticket(editor, note.noteId));
    fresh.type('clean edit');
    await waitFor(() => owner.text() === 'clean edit');
    expect(serverText(note.noteId)).toBe('clean edit');
  });

  it('closes every session of a deleted note', async () => {
    const note = await createNote();
    const editor = await note.member('EDITOR');
    const owner = await open(collab, note.noteId, ticket(note.owner, note.noteId));
    const e = await open(collab, note.noteId, ticket(editor, note.noteId));

    await db().note.delete({ where: { id: note.noteId } });
    await publishAccessEvent({ type: 'note.deleted', noteId: note.noteId });

    for (const client of [owner, e]) {
      await waitFor(() => client.stateless.some((m) => m.type === 'note.deleted'));
    }
    await waitFor(() => collab.accessControl.connectionsFor(note.noteId).length === 0);
  });
});
