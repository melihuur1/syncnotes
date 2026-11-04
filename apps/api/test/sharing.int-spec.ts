import { INestApplication } from '@nestjs/common';
import {
  COLLAB_TICKET_AUDIENCE,
  COLLAB_TICKET_ISSUER,
  type CollabTicketClaims,
} from '@syncnotes/shared';
import jwt from 'jsonwebtoken';
import { PrismaService } from '../src/prisma/prisma.service';
import { AccessEventRecorder, createTestApp, resetDatabase, TestClient } from './utils';

describe('Sharing, roles & collaboration tickets (integration)', () => {
  let app: INestApplication;
  let recorder: AccessEventRecorder;
  let owner: TestClient;
  let editor: TestClient;
  let viewer: TestClient;
  let stranger: TestClient;
  let noteId: string;

  beforeAll(async () => {
    app = await createTestApp();
    recorder = await AccessEventRecorder.start();
  });
  beforeEach(async () => {
    await resetDatabase(app);
    owner = await TestClient.registered(app, 'Owner');
    editor = await TestClient.registered(app, 'Editor');
    viewer = await TestClient.registered(app, 'Viewer');
    stranger = await TestClient.registered(app, 'Stranger');
    noteId = await owner.createNote();
    await owner.share(noteId, editor, 'EDITOR');
    await owner.share(noteId, viewer, 'VIEWER');
  });
  afterAll(async () => {
    await recorder.stop();
    await app.close();
  });

  it('lists members with their roles, owner first', async () => {
    const res = await viewer.get(`/api/notes/${noteId}/members`).expect(200);
    expect(res.body.map((m: { role: string }) => m.role)).toEqual(['OWNER', 'EDITOR', 'VIEWER']);
    const shared = await editor.get('/api/notes?scope=shared').expect(200);
    expect(shared.body).toEqual([expect.objectContaining({ id: noteId, role: 'EDITOR' })]);
  });

  it('enforces role hierarchy on the REST API', async () => {
    // Only the owner manages membership.
    await editor
      .post(`/api/notes/${noteId}/members`, { email: stranger.user.email, role: 'VIEWER' })
      .expect(403);
    await viewer.patch(`/api/notes/${noteId}/members/${editor.user.id}`, { role: 'VIEWER' }).expect(403);
    await editor.delete(`/api/notes/${noteId}/members/${viewer.user.id}`).expect(403);
    // Only the owner deletes.
    await viewer.delete(`/api/notes/${noteId}`).expect(403);
    await editor.delete(`/api/notes/${noteId}`).expect(403);
  });

  it('validates invitations', async () => {
    const url = `/api/notes/${noteId}/members`;
    await owner.post(url, { email: stranger.user.email, role: 'OWNER' }).expect(400);
    await owner.post(url, { email: 'ghost@example.com', role: 'EDITOR' }).expect(404);
    await owner.post(url, { email: owner.user.email, role: 'EDITOR' }).expect(400);
    await owner.post(url, { email: editor.user.email, role: 'VIEWER' }).expect(409);
    await owner.post(url, { email: stranger.user.email.toUpperCase(), role: 'VIEWER' }).expect(201);
  });

  it('protects the owner membership', async () => {
    await owner.patch(`/api/notes/${noteId}/members/${owner.user.id}`, { role: 'VIEWER' }).expect(400);
    await owner.delete(`/api/notes/${noteId}/members/${owner.user.id}`).expect(400);
    await owner.post(`/api/notes/${noteId}/leave`).expect(400);
  });

  it('enforces a single owner at the database level', async () => {
    const prisma = app.get(PrismaService).db;
    await expect(
      prisma.noteMember.update({
        where: { noteId_userId: { noteId, userId: editor.user.id } },
        data: { role: 'OWNER' },
      }),
    ).rejects.toThrow();
  });

  it('publishes role changes so live sessions are downgraded', async () => {
    await owner.patch(`/api/notes/${noteId}/members/${editor.user.id}`, { role: 'VIEWER' }).expect(200);
    await recorder.waitFor(
      (e) =>
        e.type === 'member.updated' &&
        e.noteId === noteId &&
        e.userId === editor.user.id &&
        e.role === 'VIEWER',
    );
    const ticket = await editor.post(`/api/notes/${noteId}/collab-ticket`).expect(200);
    expect(ticket.body.role).toEqual('VIEWER');
  });

  it('revokes access: membership removal is enforced and broadcast', async () => {
    await owner.delete(`/api/notes/${noteId}/members/${editor.user.id}`).expect(204);
    await recorder.waitFor(
      (e) => e.type === 'member.removed' && e.noteId === noteId && e.userId === editor.user.id,
    );
    await editor.get(`/api/notes/${noteId}`).expect(404);
    await editor.post(`/api/notes/${noteId}/collab-ticket`).expect(404);
  });

  it('lets non-owners leave a note', async () => {
    await viewer.post(`/api/notes/${noteId}/leave`).expect(204);
    await recorder.waitFor((e) => e.type === 'member.removed' && e.userId === viewer.user.id);
    await viewer.get(`/api/notes/${noteId}`).expect(404);
  });

  describe('collaboration tickets', () => {
    const secret = () => process.env.COLLAB_TICKET_SECRET!;

    it('are short-lived, audience-bound and scoped to one note', async () => {
      const res = await viewer.post(`/api/notes/${noteId}/collab-ticket`).expect(200);
      expect(res.body).toMatchObject({ role: 'VIEWER', expiresIn: 60 });

      const claims = jwt.verify(res.body.token, secret(), {
        audience: COLLAB_TICKET_AUDIENCE,
        issuer: COLLAB_TICKET_ISSUER,
        algorithms: ['HS256'],
      }) as CollabTicketClaims & { exp: number; iat: number; jti: string };
      expect(claims).toMatchObject({ sub: viewer.user.id, nid: noteId, name: 'Viewer' });
      expect(claims.exp - claims.iat).toBe(60);
      expect(claims.jti).toEqual(expect.any(String));
    });

    it('cannot be verified with the access-token secret', async () => {
      const res = await owner.post(`/api/notes/${noteId}/collab-ticket`).expect(200);
      expect(() => jwt.verify(res.body.token, process.env.JWT_ACCESS_SECRET!)).toThrow();
    });
  });

  describe('version history (read side)', () => {
    it('lists versions and serves the binary snapshot as base64', async () => {
      const prisma = app.get(PrismaService).db;
      const state = Uint8Array.from([1, 2, 3, 4]);
      const version = await prisma.noteVersion.create({
        data: { noteId, state, sizeBytes: state.byteLength, label: 'v1', createdById: editor.user.id },
      });

      const list = await viewer.get(`/api/notes/${noteId}/versions`).expect(200);
      expect(list.body).toEqual([
        expect.objectContaining({ id: version.id, label: 'v1', createdBy: { id: editor.user.id, name: 'Editor' } }),
      ]);
      expect(list.body[0].state).toBeUndefined();

      const detail = await viewer.get(`/api/notes/${noteId}/versions/${version.id}`).expect(200);
      expect(Buffer.from(detail.body.state, 'base64')).toEqual(Buffer.from(state));

      // A version id from another note is not reachable through this note.
      const otherNote = await stranger.createNote();
      await stranger.get(`/api/notes/${otherNote}/versions/${version.id}`).expect(404);
    });
  });
});
