import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ACCESS_EVENTS_CHANNEL, AccessEvent, parseAccessEvent } from '@syncnotes/shared';
import Redis from 'ioredis';
import request from 'supertest';
import TestAgent from 'supertest/lib/agent';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { CSRF_HEADER } from '../src/common/cookies';
import { PrismaService } from '../src/prisma/prisma.service';

export const PASSWORD = 'correct-horse-battery';

export async function createTestApp(): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication({ logger: ['error'] });
  configureApp(app);
  await app.init();
  return app;
}

export async function resetDatabase(app: INestApplication): Promise<void> {
  const prisma = app.get(PrismaService).db;
  await prisma.$executeRawUnsafe(
    'TRUNCATE TABLE note_versions, note_members, notes, folders, sessions, users CASCADE',
  );
}

/** A browser-like client: keeps cookies and sends the double-submit CSRF header. */
export class TestClient {
  user!: { id: string; email: string; name: string };

  private constructor(
    readonly agent: TestAgent,
    readonly csrf: string,
  ) {}

  static async create(app: INestApplication): Promise<TestClient> {
    const agent = request.agent(app.getHttpServer());
    const res = await agent.get('/api/auth/csrf').expect(200);
    return new TestClient(agent, res.body.csrfToken as string);
  }

  /** Creates a client and registers a fresh account. */
  static async registered(app: INestApplication, name: string): Promise<TestClient> {
    const client = await TestClient.create(app);
    const email = `${name.toLowerCase()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
    const res = await client.post('/api/auth/register', { email, name, password: PASSWORD });
    if (res.status !== 201)
      throw new Error(`register failed: ${res.status} ${JSON.stringify(res.body)}`);
    client.user = res.body.user;
    return client;
  }

  get(url: string) {
    return this.agent.get(url);
  }

  post(url: string, body?: object) {
    return this.agent
      .post(url)
      .set(CSRF_HEADER, this.csrf)
      .send(body ?? {});
  }

  patch(url: string, body?: object) {
    return this.agent
      .patch(url)
      .set(CSRF_HEADER, this.csrf)
      .send(body ?? {});
  }

  delete(url: string) {
    return this.agent.delete(url).set(CSRF_HEADER, this.csrf);
  }

  async createNote(): Promise<string> {
    const res = await this.post('/api/notes').expect(201);
    return res.body.id as string;
  }

  async share(noteId: string, member: TestClient, role: 'EDITOR' | 'VIEWER'): Promise<void> {
    await this.post(`/api/notes/${noteId}/members`, { email: member.user.email, role }).expect(201);
  }
}

/** Extracts `name=value` for a cookie from a supertest response. */
export function getSetCookie(res: request.Response, name: string): string | undefined {
  const header = res.headers['set-cookie'] as unknown as string[] | undefined;
  return header?.find((c) => c.startsWith(`${name}=`));
}

export function cookieValue(setCookie: string | undefined): string | undefined {
  return setCookie?.split(';')[0]?.split('=').slice(1).join('=');
}

/** Subscribes to the access-events channel and records everything published. */
export class AccessEventRecorder {
  readonly events: AccessEvent[] = [];
  private constructor(private readonly redis: Redis) {}

  static async start(): Promise<AccessEventRecorder> {
    const redis = new Redis(process.env.REDIS_URL!);
    const recorder = new AccessEventRecorder(redis);
    redis.on('message', (_channel, message) => {
      const event = parseAccessEvent(message);
      if (event) recorder.events.push(event);
    });
    await redis.subscribe(ACCESS_EVENTS_CHANNEL);
    return recorder;
  }

  async waitFor(predicate: (e: AccessEvent) => boolean, timeoutMs = 3000): Promise<AccessEvent> {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      const match = this.events.find(predicate);
      if (match) return match;
      await new Promise((r) => setTimeout(r, 25));
    }
    throw new Error(`access event not received within ${timeoutMs}ms`);
  }

  async stop(): Promise<void> {
    this.redis.disconnect();
  }
}
