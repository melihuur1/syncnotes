import { INestApplication } from '@nestjs/common';
import { PrismaService } from '../src/prisma/prisma.service';
import { AccessEventRecorder, createTestApp, resetDatabase, TestClient } from './utils';

describe('Notes & folders (integration)', () => {
  let app: INestApplication;
  let recorder: AccessEventRecorder;

  beforeAll(async () => {
    app = await createTestApp();
    recorder = await AccessEventRecorder.start();
  });
  beforeEach(() => resetDatabase(app));
  afterAll(async () => {
    await recorder.stop();
    await app.close();
  });

  it('creates a note owned by the caller and lists it', async () => {
    const ada = await TestClient.registered(app, 'Ada');
    const noteId = await ada.createNote();

    const list = await ada.get('/api/notes').expect(200);
    expect(list.body).toHaveLength(1);
    expect(list.body[0]).toMatchObject({
      id: noteId,
      title: 'Untitled',
      role: 'OWNER',
      memberCount: 1,
      owner: { id: ada.user.id, name: 'Ada' },
    });

    const detail = await ada.get(`/api/notes/${noteId}`).expect(200);
    expect(detail.body.members).toEqual([
      expect.objectContaining({ userId: ada.user.id, role: 'OWNER' }),
    ]);
  });

  it('hides notes from non-members (404, not 403) and does not list them', async () => {
    const ada = await TestClient.registered(app, 'Ada');
    const eve = await TestClient.registered(app, 'Eve');
    const noteId = await ada.createNote();

    await eve.get(`/api/notes/${noteId}`).expect(404);
    await eve.delete(`/api/notes/${noteId}`).expect(404);
    await eve.post(`/api/notes/${noteId}/collab-ticket`).expect(404);
    await eve.get(`/api/notes/${noteId}/members`).expect(404);
    await eve.get(`/api/notes/${noteId}/versions`).expect(404);
    await eve.get('/api/notes/not-a-uuid').expect(404);
    expect((await eve.get('/api/notes').expect(200)).body).toEqual([]);
  });

  it('organises notes in personal folders', async () => {
    const ada = await TestClient.registered(app, 'Ada');
    const bob = await TestClient.registered(app, 'Bob');
    const noteId = await ada.createNote();
    await ada.createNote();

    const folder = (await ada.post('/api/folders', { name: 'Work' }).expect(201)).body;
    await ada.post('/api/folders', { name: 'Work' }).expect(409);
    await ada.patch(`/api/notes/${noteId}/folder`, { folderId: folder.id }).expect(200);

    const inFolder = await ada.get(`/api/notes?folderId=${folder.id}`).expect(200);
    expect(inFolder.body.map((n: { id: string }) => n.id)).toEqual([noteId]);
    const unfiled = await ada.get('/api/notes?folderId=none').expect(200);
    expect(unfiled.body).toHaveLength(1);

    const folders = await ada.get('/api/folders').expect(200);
    expect(folders.body).toEqual([expect.objectContaining({ name: 'Work', noteCount: 1 })]);

    // Shared note: Bob files it in *his* folder — Ada's placement is unaffected.
    await ada.share(noteId, bob, 'VIEWER');
    const bobFolder = (await bob.post('/api/folders', { name: 'From Ada' }).expect(201)).body;
    await bob.patch(`/api/notes/${noteId}/folder`, { folderId: bobFolder.id }).expect(200);
    expect((await ada.get(`/api/notes/${noteId}`).expect(200)).body.folderId).toEqual(folder.id);

    // Nobody can use someone else's folder.
    await bob.patch(`/api/notes/${noteId}/folder`, { folderId: folder.id }).expect(404);
    await bob.delete(`/api/folders/${folder.id}`).expect(404);

    // Deleting a folder un-files its notes instead of deleting them.
    await ada.delete(`/api/folders/${folder.id}`).expect(204);
    expect((await ada.get(`/api/notes/${noteId}`).expect(200)).body.folderId).toBeNull();
  });

  it('searches titles and content (case-insensitive)', async () => {
    const ada = await TestClient.registered(app, 'Ada');
    const a = await ada.createNote();
    const b = await ada.createNote();
    const prisma = app.get(PrismaService).db;
    await prisma.note.update({ where: { id: a }, data: { title: 'Sprint Planning' } });
    await prisma.note.update({ where: { id: b }, data: { plainText: 'the CRDT merge algorithm' } });

    const byTitle = await ada.get('/api/notes?q=sprint').expect(200);
    expect(byTitle.body.map((n: { id: string }) => n.id)).toEqual([a]);
    const byContent = await ada.get('/api/notes?q=crdt').expect(200);
    expect(byContent.body.map((n: { id: string }) => n.id)).toEqual([b]);
  });

  it('only the owner can delete; deletion is broadcast to collaboration servers', async () => {
    const ada = await TestClient.registered(app, 'Ada');
    const bob = await TestClient.registered(app, 'Bob');
    const noteId = await ada.createNote();
    await ada.share(noteId, bob, 'EDITOR');

    await bob.delete(`/api/notes/${noteId}`).expect(403);
    await ada.delete(`/api/notes/${noteId}`).expect(204);
    await ada.get(`/api/notes/${noteId}`).expect(404);

    await recorder.waitFor((e) => e.type === 'note.deleted' && e.noteId === noteId);
  });
});
