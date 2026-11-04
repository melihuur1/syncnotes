import { afterAll, afterEach, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import {
  bodyText,
  closeShared,
  connect,
  connected,
  createNote,
  db,
  firstParagraphText,
  flush,
  persistedDoc,
  type RunningCollab,
  serverDoc,
  sleep,
  startCollab,
  type TestClient,
  ticket,
  waitFor,
} from './harness';

describe('persistence & offline editing', () => {
  const servers: RunningCollab[] = [];
  const clients: TestClient[] = [];
  const start = async (overrides = {}) => {
    const server = await startCollab(overrides);
    servers.push(server);
    return server;
  };
  const open = (...args: Parameters<typeof connect>) => {
    const client = connect(...args);
    clients.push(client);
    return connected(client);
  };

  afterEach(async () => {
    clients.splice(0).forEach((c) => c.destroy());
    await Promise.all(servers.splice(0).map((s) => s.destroy()));
  });
  afterAll(() => closeShared());

  it('stores the Yjs state as binary and derives title/excerpt for the REST API', async () => {
    const collab = await start();
    const note = await createNote();
    const client = await open(collab, note.noteId, ticket(note.owner, note.noteId));
    client.doc.getText('title').insert(0, 'Release checklist');
    client.type('Ship the CRDT persistence layer');
    await waitFor(() => bodyText(serverDoc(collab, note.noteId)!) !== '');
    await flush(collab);

    const row = await db().note.findUniqueOrThrow({ where: { id: note.noteId } });
    expect(row.ydocState).toBeInstanceOf(Uint8Array);
    expect(row.title).toBe('Release checklist');
    expect(row.excerpt).toBe('Ship the CRDT persistence layer');
    expect(row.plainText).toContain('CRDT');
    expect(bodyText(await persistedDoc(note.noteId))).toBe('Ship the CRDT persistence layer');
  });

  it('keeps content across a server restart', async () => {
    const first = await start();
    const note = await createNote();
    const writer = await open(first, note.noteId, ticket(note.owner, note.noteId));
    writer.type('survives restarts');
    await waitFor(() => bodyText(serverDoc(first, note.noteId)!) === 'survives restarts');
    writer.destroy();
    await first.destroy(); // graceful shutdown flushes pending stores

    const second = await start();
    const reader = await open(second, note.noteId, ticket(note.owner, note.noteId));
    await waitFor(() => reader.text() === 'survives restarts');
  });

  it('merges on write instead of overwriting state persisted by another instance', async () => {
    const collab = await start();
    const note = await createNote();
    const client = await open(collab, note.noteId, ticket(note.owner, note.noteId));
    client.type('live edit');
    await waitFor(() => bodyText(serverDoc(collab, note.noteId)!) === 'live edit');
    await flush(collab);

    // Another instance (diverged, e.g. during a Redis outage) persisted its own edit.
    const other = await persistedDoc(note.noteId);
    const p = new Y.XmlElement('paragraph');
    p.insert(0, [new Y.XmlText('edit from another instance')]);
    other.getXmlFragment('default').push([p]);
    await db().note.update({
      where: { id: note.noteId },
      data: { ydocState: new Uint8Array(Y.encodeStateAsUpdate(other)) },
    });

    // Next store on this instance must keep both — and pull the other edit into the live doc.
    client.type('!');
    await sleep(300);
    await flush(collab);

    const merged = bodyText(await persistedDoc(note.noteId));
    expect(merged).toContain('live edit!');
    expect(merged).toContain('edit from another instance');
    await waitFor(() => client.text().includes('edit from another instance'));
  });

  it('merges offline edits with concurrent online edits after reconnecting', async () => {
    const collab = await start();
    const note = await createNote();
    const editor = await note.member('EDITOR');
    const online = await open(collab, note.noteId, ticket(note.owner, note.noteId));
    // `token` as a function: every reconnect fetches a fresh ticket, like the web client.
    const offline = await open(collab, note.noteId, async () => ticket(editor, note.noteId));
    online.type('shared base');
    await waitFor(() => offline.text() === 'shared base');

    offline.provider.disconnect();
    await sleep(100);
    firstParagraphText(offline.doc).insert(0, '[offline] ');
    online.type(' [online]');
    await sleep(300);
    expect(online.text()).toBe('shared base [online]');
    expect(offline.text()).toBe('[offline] shared base');

    await offline.provider.connect();
    const expected = '[offline] shared base [online]';
    await waitFor(() => online.text() === expected && offline.text() === expected, {
      message: 'replicas did not converge after reconnect',
    });
    await flush(collab);
    expect(bodyText(await persistedDoc(note.noteId))).toBe(expected);
  });
});
