import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  closeShared,
  connect,
  connected,
  createNote,
  createUser,
  db,
  type RunningCollab,
  startCollab,
  type TestClient,
  ticket,
  waitFor,
} from './harness';

describe('WebSocket handshake authorisation', () => {
  let collab: RunningCollab;
  const clients: TestClient[] = [];
  const open = (...args: Parameters<typeof connect>) => {
    const client = connect(...args);
    clients.push(client);
    return client;
  };

  beforeAll(async () => {
    collab = await startCollab();
  });
  afterEach(() => {
    clients.splice(0).forEach((c) => c.destroy());
  });
  afterAll(async () => {
    await collab.destroy();
    await closeShared();
  });

  it('accepts a valid ticket and syncs edits between members', async () => {
    const note = await createNote();
    const editor = await note.member('EDITOR');
    const a = await connected(open(collab, note.noteId, ticket(note.owner, note.noteId)));
    const b = await connected(open(collab, note.noteId, ticket(editor, note.noteId)));

    expect(a.provider.authorizedScope).toBe('read-write');
    a.type('hello from owner');
    await waitFor(() => b.text() === 'hello from owner');
  });

  it('marks viewers read-only during the handshake', async () => {
    const note = await createNote();
    const viewer = await note.member('VIEWER');
    const v = await connected(open(collab, note.noteId, ticket(viewer, note.noteId)));
    expect(v.provider.authorizedScope).toBe('readonly');
  });

  it.each([
    [
      'a forged signature',
      (u: { id: string; name: string }, n: string) => ticket(u, n, { secret: 'x'.repeat(40) }),
    ],
    [
      'an expired ticket',
      (u: { id: string; name: string }, n: string) => ticket(u, n, { expiresIn: -10 }),
    ],
    ['garbage', () => 'not-a-jwt'],
    ['an empty token', () => ''],
  ])('rejects %s', async (_label, makeToken) => {
    const note = await createNote();
    const client = open(collab, note.noteId, makeToken(note.owner, note.noteId));
    await waitFor(() => client.authFailures.length > 0);
    expect(client.authFailures[0]).toBe('invalid-ticket');
    expect(client.provider.isSynced).toBe(false);
  });

  it('rejects a ticket issued for a different note', async () => {
    const first = await createNote();
    const second = await createNote();
    const client = open(collab, second.noteId, ticket(first.owner, first.noteId));
    await waitFor(() => client.authFailures.length > 0);
    expect(client.authFailures[0]).toBe('invalid-ticket');
  });

  it('re-checks membership in Postgres instead of trusting the ticket', async () => {
    const note = await createNote();
    const editor = await note.member('EDITOR');
    const stillValidTicket = ticket(editor, note.noteId);
    await db().noteMember.delete({
      where: { noteId_userId: { noteId: note.noteId, userId: editor.id } },
    });

    const client = open(collab, note.noteId, stillValidTicket);
    await waitFor(() => client.authFailures.length > 0);
    expect(client.authFailures[0]).toBe('not-a-member');
  });

  it('rejects non-members holding a correctly signed ticket', async () => {
    const note = await createNote();
    const stranger = await createUser('Stranger');
    const client = open(collab, note.noteId, ticket(stranger, note.noteId));
    await waitFor(() => client.authFailures.length > 0);
    expect(client.authFailures[0]).toBe('not-a-member');
  });

  it('exposes a health endpoint', async () => {
    const res = await fetch(`http://127.0.0.1:${collab.port}/health`);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ status: 'ok', redis: 'up' });
  });
});
