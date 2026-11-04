import { afterAll, afterEach, describe, expect, it } from 'vitest';
import {
  bodyText,
  closeShared,
  connect,
  connected,
  createNote,
  db,
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
import { TcpProxy } from './tcp-proxy';

describe('horizontal scaling through Redis', () => {
  const servers: RunningCollab[] = [];
  const clients: TestClient[] = [];
  const proxies: TcpProxy[] = [];

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
    await Promise.all(proxies.splice(0).map((p) => p.stop()));
  });
  afterAll(() => closeShared());

  it('syncs a document opened on two different instances', async () => {
    const [a, b] = [await start(), await start()];
    const note = await createNote();
    const editor = await note.member('EDITOR', 'Linus');
    const onA = await open(a, note.noteId, ticket(note.owner, note.noteId), note.owner);
    const onB = await open(b, note.noteId, ticket(editor, note.noteId), editor);

    onA.type('from A');
    await waitFor(() => onB.text() === 'from A');
    onB.type(' / from B');
    await waitFor(() => onA.text() === 'from A / from B');

    // Presence crosses instances too.
    await waitFor(() =>
      [...onA.provider.awareness!.getStates().values()].some((s) => s.user?.name === 'Linus'),
    );
  });

  it('never loses updates when both instances persist the same note concurrently', async () => {
    const [a, b] = [await start(), await start()];
    const note = await createNote();
    const editor = await note.member('EDITOR');
    const onA = await open(a, note.noteId, ticket(note.owner, note.noteId));
    const onB = await open(b, note.noteId, ticket(editor, note.noteId));
    onA.type('|');
    await waitFor(() => onB.text() === '|');

    for (let i = 0; i < 20; i++) {
      onA.type('a');
      onB.type('b');
      if (i % 4 === 0) await sleep(30);
    }
    const count = (t: string, c: string) => t.split(c).length - 1;
    await waitFor(
      () =>
        onA.text() === onB.text() && count(onA.text(), 'a') === 20 && count(onA.text(), 'b') === 20,
    );
    await Promise.all([flush(a), flush(b)]);
    expect(bodyText(await persistedDoc(note.noteId))).toBe(onA.text());
  });

  describe('Redis outage', () => {
    async function outageSetup() {
      const proxy = TcpProxy.fromRedisUrl(process.env.REDIS_URL!);
      await proxy.start();
      proxies.push(proxy);
      const opts = { REDIS_URL: proxy.url };
      const a = await start(opts);
      const b = await start(opts);
      await waitFor(() => a.redis.isHealthy() && b.redis.isHealthy());
      const note = await createNote();
      const e1 = await note.member('EDITOR', 'E1');
      const e2 = await note.member('EDITOR', 'E2');
      const a1 = await open(a, note.noteId, async () => ticket(note.owner, note.noteId));
      const a2 = await open(a, note.noteId, async () => ticket(e1, note.noteId));
      const b1 = await open(b, note.noteId, async () => ticket(e2, note.noteId));
      a1.type('base');
      await waitFor(() => b1.text() === 'base' && a2.text() === 'base');
      return { proxy, a, b, note, a1, a2, b1 };
    }

    it('keeps same-instance collaboration and persistence working while Redis is down', async () => {
      const { proxy, a, note, a1, a2 } = await outageSetup();

      await proxy.cut();
      await waitFor(() => !a.redis.isHealthy(), { message: 'instance did not notice the outage' });
      const health = (await (await fetch(`http://127.0.0.1:${a.port}/health`)).json()) as {
        redis: string;
      };
      expect(health.redis).toBe('degraded');

      // Real-time collaboration on the same instance is unaffected.
      a1.type(' +a1');
      await waitFor(() => a2.text() === 'base +a1', { timeout: 1000 });

      // ...and edits are persisted although the Redis lock is unavailable.
      await flush(a);
      expect(bodyText(await persistedDoc(note.noteId))).toContain('+a1');

      // A document can even be opened for the first time during the outage.
      const other = await createNote();
      const fresh = await open(a, other.noteId, ticket(other.owner, other.noteId));
      expect(fresh.provider.isSynced).toBe(true);
    });

    it('converges across instances through Postgres during the outage, then resumes real-time sync', async () => {
      const { proxy, a, b, note, a1, b1 } = await outageSetup();

      await proxy.cut();
      await waitFor(() => !a.redis.isHealthy() && !b.redis.isHealthy());

      a1.type(' [A during outage]');
      b1.type(' [B during outage]');

      // Degraded mode: stores merge through Postgres, the reconciler pulls them into other instances.
      await waitFor(
        () => a1.text().includes('[B during outage]') && b1.text().includes('[A during outage]'),
        { timeout: 8000, message: 'instances did not converge through Postgres' },
      );
      expect(a1.text()).toBe(b1.text());

      await proxy.restore();
      await waitFor(() => a.redis.isHealthy() && b.redis.isHealthy(), { timeout: 8000 });

      // Back to real-time fan-out (well below the store debounce + reconcile interval).
      const sent = Date.now();
      a1.type(' [after recovery]');
      await waitFor(() => b1.text().includes('[after recovery]'), { timeout: 2000 });
      expect(Date.now() - sent).toBeLessThan(1000);

      await Promise.all([flush(a), flush(b)]);
      const persisted = bodyText(await persistedDoc(note.noteId));
      for (const fragment of [
        'base',
        '[A during outage]',
        '[B during outage]',
        '[after recovery]',
      ]) {
        expect(persisted).toContain(fragment);
      }
      expect(bodyText(serverDoc(a, note.noteId)!)).toBe(bodyText(serverDoc(b, note.noteId)!));
    });

    it('converges during an asymmetric partition (only one instance lost Redis) via anti-entropy', async () => {
      const proxy = TcpProxy.fromRedisUrl(process.env.REDIS_URL!);
      await proxy.start();
      proxies.push(proxy);
      const a = await start({ ANTI_ENTROPY_INTERVAL_MS: 800 }); // direct Redis connection
      const b = await start({ REDIS_URL: proxy.url, ANTI_ENTROPY_INTERVAL_MS: 800 });
      await waitFor(() => a.redis.isHealthy() && b.redis.isHealthy());
      const note = await createNote();
      const editor = await note.member('EDITOR');
      const onA = await open(a, note.noteId, async () => ticket(note.owner, note.noteId));
      const onB = await open(b, note.noteId, async () => ticket(editor, note.noteId));
      onA.type('base');
      await waitFor(() => onB.text() === 'base');

      await proxy.cut();
      await waitFor(() => !b.redis.isHealthy());
      expect(a.redis.isHealthy()).toBe(true); // A sees no problem at all

      // A's user is idle, so A never stores and never merges — only anti-entropy can help.
      onB.type(' [from isolated B]');
      await waitFor(() => onA.text().includes('[from isolated B]'), {
        timeout: 8000,
        message: 'healthy instance never picked up edits of the isolated one',
      });
      onA.type(' [from A]');
      await waitFor(() => onB.text().includes('[from A]'), { timeout: 8000 });
      expect(onA.text()).toBe(onB.text());
    });

    it('re-opens a document that was closed during the outage and syncs it in real time after recovery', async () => {
      const { proxy, a, b, note, a1, a2, b1 } = await outageSetup();
      await proxy.cut();
      await waitFor(() => !a.redis.isHealthy() && !b.redis.isHealthy());

      // Everyone on instance A leaves → A stores and unloads the document while Redis is down.
      a1.destroy();
      a2.destroy();
      await waitFor(() => !a.server.hocuspocus.documents.has(note.noteId), { timeout: 8000 });

      await proxy.restore();
      await waitFor(() => a.redis.isHealthy() && b.redis.isHealthy(), { timeout: 8000 });

      const back = await open(a, note.noteId, async () => ticket(note.owner, note.noteId));
      await waitFor(() => back.text() === b1.text());
      const sent = Date.now();
      back.type(' [after reopen]');
      await waitFor(() => b1.text().includes('[after reopen]'), { timeout: 2000 });
      expect(Date.now() - sent).toBeLessThan(1000);
      b1.type(' [reply]');
      await waitFor(() => back.text().includes('[reply]'), { timeout: 2000 });
    });

    it('still revokes access during the outage (TTL fallback, no Redis event)', async () => {
      const { proxy, a, note, a1, a2 } = await outageSetup();
      await proxy.cut();
      await waitFor(() => !a.redis.isHealthy());

      // The API could not publish the event — only Postgres knows.
      const e1 = (
        await db().noteMember.findMany({
          where: { noteId: note.noteId, role: 'EDITOR' },
          include: { user: true },
        })
      ).find((m) => m.user.name === 'E1')!;
      await db().noteMember.delete({
        where: { noteId_userId: { noteId: note.noteId, userId: e1.userId } },
      });
      await sleep(400); // > PERMISSION_CACHE_TTL_MS (300ms in tests)

      a2.type(' revoked-edit');
      await waitFor(() => a2.stateless.some((m) => m.type === 'access.revoked'));
      await sleep(200);
      expect(a1.text()).toBe('base');
    });
  });
});
