import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service';
import {
  cookieValue,
  createTestApp,
  getSetCookie,
  PASSWORD,
  resetDatabase,
  TestClient,
} from './utils';

describe('Auth (integration)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp();
  });
  beforeEach(() => resetDatabase(app));
  afterAll(() => app.close());

  describe('register', () => {
    it('creates the account and sets hardened auth cookies', async () => {
      const client = await TestClient.create(app);
      const res = await client
        .post('/api/auth/register', {
          email: '  Ada@Example.com ',
          name: 'Ada',
          password: PASSWORD,
        })
        .expect(201);

      expect(res.body.user).toEqual({
        id: expect.any(String),
        email: 'ada@example.com',
        name: 'Ada',
      });
      expect(JSON.stringify(res.body)).not.toContain('password');

      const access = getSetCookie(res, 'sn_access');
      const refresh = getSetCookie(res, 'sn_refresh');
      expect(access).toMatch(/HttpOnly/i);
      expect(access).toMatch(/SameSite=Lax/i);
      expect(refresh).toMatch(/HttpOnly/i);
      expect(refresh).toMatch(/SameSite=Strict/i);
      expect(refresh).toMatch(/Path=\/api\/auth/);

      // Only a hash of the refresh token is stored.
      const session = await app.get(PrismaService).db.session.findFirstOrThrow();
      expect(session.tokenHash).not.toEqual(cookieValue(refresh));
      expect(session.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    });

    it('rejects duplicate e-mails with 409', async () => {
      const first = await TestClient.registered(app, 'Ada');
      const client = await TestClient.create(app);
      await client
        .post('/api/auth/register', { email: first.user.email, name: 'Other', password: PASSWORD })
        .expect(409);
    });

    it('validates input and rejects unknown fields', async () => {
      const client = await TestClient.create(app);
      await client
        .post('/api/auth/register', { email: 'nope', name: 'A', password: PASSWORD })
        .expect(400);
      await client
        .post('/api/auth/register', { email: 'a@b.co', name: 'A', password: 'short' })
        .expect(400);
      await client
        .post('/api/auth/register', {
          email: 'a@b.co',
          name: 'A',
          password: PASSWORD,
          isAdmin: true,
        })
        .expect(400);
    });
  });

  describe('CSRF protection', () => {
    it('rejects state-changing requests without a matching token', async () => {
      const client = await TestClient.create(app);
      const body = { email: 'x@example.com', name: 'X', password: PASSWORD };
      await client.agent.post('/api/auth/register').send(body).expect(403);
      await client.agent
        .post('/api/auth/register')
        .set('x-csrf-token', 'a'.repeat(32))
        .send(body)
        .expect(403);
      await request(app.getHttpServer()).post('/api/auth/login').send(body).expect(403);
    });
  });

  describe('login', () => {
    it('returns the same generic error for unknown e-mail and wrong password', async () => {
      const ada = await TestClient.registered(app, 'Ada');
      const client = await TestClient.create(app);
      const wrongPassword = await client
        .post('/api/auth/login', { email: ada.user.email, password: 'wrong-password' })
        .expect(401);
      const unknownUser = await client
        .post('/api/auth/login', { email: 'ghost@example.com', password: 'wrong-password' })
        .expect(401);
      expect(wrongPassword.body.message).toEqual(unknownUser.body.message);
    });

    it('locks the account after repeated failures (even for the right password)', async () => {
      const ada = await TestClient.registered(app, 'Ada');
      const client = await TestClient.create(app);
      for (let i = 0; i < 5; i++) {
        await client
          .post('/api/auth/login', { email: ada.user.email, password: 'wrong' })
          .expect(401);
      }
      await client
        .post('/api/auth/login', { email: ada.user.email, password: PASSWORD })
        .expect(429);

      // Lock expires → login works again and the counter resets.
      await app.get(PrismaService).db.user.update({
        where: { id: ada.user.id },
        data: { lockedUntil: new Date(Date.now() - 1000) },
      });
      await client
        .post('/api/auth/login', { email: ada.user.email, password: PASSWORD })
        .expect(200);
    });
  });

  describe('session', () => {
    it('requires authentication for /me', async () => {
      await request(app.getHttpServer()).get('/api/auth/me').expect(401);
      const ada = await TestClient.registered(app, 'Ada');
      const me = await ada.get('/api/auth/me').expect(200);
      expect(me.body.id).toEqual(ada.user.id);
    });

    it('rotates refresh tokens on every use', async () => {
      const ada = await TestClient.registered(app, 'Ada');
      const first = await ada.post('/api/auth/refresh').expect(200);
      const second = await ada.post('/api/auth/refresh').expect(200);
      expect(cookieValue(getSetCookie(first, 'sn_refresh'))).not.toEqual(
        cookieValue(getSetCookie(second, 'sn_refresh')),
      );
      await ada.get('/api/auth/me').expect(200);
    });

    it('detects refresh-token reuse and revokes the whole session family', async () => {
      const ada = await TestClient.create(app);
      const reg = await ada
        .post('/api/auth/register', { email: 'ada@example.com', name: 'Ada', password: PASSWORD })
        .expect(201);
      const stolenRefresh = cookieValue(getSetCookie(reg, 'sn_refresh'))!;

      // Legitimate client rotates the token.
      await ada.post('/api/auth/refresh').expect(200);
      await ada.get('/api/auth/me').expect(200);

      // Move the rotation outside the benign-race grace window.
      const prisma = app.get(PrismaService).db;
      await prisma.session.updateMany({
        where: { rotatedAt: { not: null } },
        data: { rotatedAt: new Date(Date.now() - 60_000) },
      });

      // Attacker replays the old token → rejected, and the family is revoked.
      await request(app.getHttpServer())
        .post('/api/auth/refresh')
        .set('Cookie', [`sn_refresh=${stolenRefresh}`, `sn_csrf=${ada.csrf}`])
        .set('x-csrf-token', ada.csrf)
        .expect(401);

      // The legitimate client's still-unexpired access token is now rejected too.
      await ada.get('/api/auth/me').expect(401);
      expect(await prisma.session.count({ where: { revokedAt: null } })).toBe(0);
    });

    it('logout invalidates the access token immediately', async () => {
      const ada = await TestClient.registered(app, 'Ada');
      const login = await ada
        .post('/api/auth/login', { email: ada.user.email, password: PASSWORD })
        .expect(200);
      const accessToken = cookieValue(getSetCookie(login, 'sn_access'))!;

      const logout = await ada.post('/api/auth/logout').expect(204);
      expect(getSetCookie(logout, 'sn_access')).toMatch(/Expires=Thu, 01 Jan 1970/);

      await request(app.getHttpServer())
        .get('/api/auth/me')
        .set('Cookie', `sn_access=${accessToken}`)
        .expect(401);
    });
  });
});
