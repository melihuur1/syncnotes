import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  closeShared,
  connect,
  connected,
  createNote,
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
  bodyText,
} from './harness';

describe('concurrent editing & read-only enforcement', () => {
  let collab: RunningCollab;
  const clients: TestClient[] = [];
  const open = (...args: Parameters<typeof connect>) => {
    const client = connect(...args);
    clients.push(client);
    return connected(client);
  };

  beforeAll(async () => {
    collab = await startCollab();
  });
  afterEach(() => clients.splice(0).forEach((c) => c.destroy()));
  afterAll(async () => {
    await collab.destroy();
    await closeShared();
  });

  it('loses no update when several users type into the same paragraph at once', async () => {
    const note = await createNote();
    const users = [note.owner, await note.member('EDITOR', 'A'), await note.member('EDITOR', 'B')];
    const [first, ...rest] = await Promise.all(users.map((u) => open(collab, note.noteId, ticket(u, note.noteId), u)));
    const all = [first!, ...rest];

    // Shared starting point: one paragraph everybody edits.
    first!.type('|');
    await waitFor(() => all.every((c) => c.text() === '|'));

    // Each client inserts 40 tagged characters at random positions, interleaved in real time.
    const tags = ['a', 'b', 'c'];
    const rounds = 40;
    await Promise.all(
      all.map(async (client, i) => {
        for (let n = 0; n < rounds; n++) {
          const text = firstParagraphText(client.doc);
          text.insert(Math.floor(Math.random() * (text.length + 1)), tags[i]!);
          if (n % 5 === 0) await sleep(Math.random() * 15);
        }
      }),
    );

    await waitFor(() => new Set(all.map((c) => c.text())).size === 1, { message: 'replicas did not converge' });
    const final = first!.text();
    for (const tag of tags) expect(final.split(tag).length - 1).toBe(rounds);
    expect(final).toHaveLength(rounds * tags.length + 1);

    // Server state and the persisted binary state agree with the clients.
    expect(bodyText(serverDoc(collab, note.noteId)!)).toBe(final);
    await flush(collab);
    expect(bodyText(await persistedDoc(note.noteId))).toBe(final);
  });

  it('propagates presence (awareness) between collaborators', async () => {
    const note = await createNote();
    const editor = await note.member('EDITOR', 'Grace');
    const a = await open(collab, note.noteId, ticket(note.owner, note.noteId), note.owner);
    await open(collab, note.noteId, ticket(editor, note.noteId), editor);
    await waitFor(() =>
      [...a.provider.awareness!.getStates().values()].some((s) => s.user?.name === 'Grace'),
    );
  });

  it('ignores document updates from a viewer — enforced by the server, not the UI', async () => {
    const note = await createNote();
    const viewer = await note.member('VIEWER');
    const owner = await open(collab, note.noteId, ticket(note.owner, note.noteId));
    const v = await open(collab, note.noteId, ticket(viewer, note.noteId));
    owner.type('original');
    await waitFor(() => v.text() === 'original');

    // A modified client would happily apply this locally and send it.
    v.type(' VANDALISM');
    await sleep(300);
    owner.type(' + owner edit'); // sentinel: proves the server kept processing messages
    await waitFor(() => v.text().includes('owner edit'));

    expect(owner.text()).toBe('original + owner edit');
    expect(bodyText(serverDoc(collab, note.noteId)!)).toBe('original + owner edit');
    await flush(collab);
    expect(bodyText(await persistedDoc(note.noteId))).not.toContain('VANDALISM');
  });
});
