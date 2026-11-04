import { HocuspocusProvider } from '@hocuspocus/provider';
import { createPrismaClient, type PrismaClient } from '@syncnotes/db';
import {
  ACCESS_EVENTS_CHANNEL,
  type AccessEvent,
  COLLAB_TICKET_AUDIENCE,
  COLLAB_TICKET_ISSUER,
  type ClientStatelessMessage,
  type NoteRole,
  serializeAccessEvent,
  type ServerStatelessMessage,
} from '@syncnotes/shared';
import Redis from 'ioredis';
import jwt from 'jsonwebtoken';
import { randomUUID } from 'node:crypto';
import * as Y from 'yjs';
import { type CollabConfig, loadCollabConfig } from '../src/config';
import { createLogger, silentLogger } from '../src/logger';
import { type CollabServer, createCollabServer } from '../src/server';
import { extractPlainText } from '../src/ydoc';

// ---------------------------------------------------------------------------
// shared infrastructure
// ---------------------------------------------------------------------------

let prisma: PrismaClient | undefined;
export function db(): PrismaClient {
  prisma ??= createPrismaClient(process.env.DATABASE_URL!);
  return prisma;
}

let publisher: Redis | undefined;
/** Publishes an access event exactly like the API does. */
type WithoutAt<T> = T extends unknown ? Omit<T, 'at'> : never;
export async function publishAccessEvent(event: WithoutAt<AccessEvent>): Promise<void> {
  publisher ??= new Redis(process.env.REDIS_URL!);
  await publisher.publish(
    ACCESS_EVENTS_CHANNEL,
    serializeAccessEvent({ ...event, at: Date.now() } as AccessEvent),
  );
}

export async function closeShared(): Promise<void> {
  publisher?.disconnect();
  publisher = undefined;
  await prisma?.$disconnect();
  prisma = undefined;
}

// ---------------------------------------------------------------------------
// servers
// ---------------------------------------------------------------------------

export interface RunningCollab extends CollabServer {
  url: string;
  port: number;
}

/** Fast timings so TTL/debounce behaviour is observable within a test. */
export async function startCollab(
  overrides: Partial<Record<keyof CollabConfig, unknown>> = {},
): Promise<RunningCollab> {
  const config = loadCollabConfig({
    ...process.env,
    COLLAB_PORT: 0,
    INSTANCE_NAME: `test-${randomUUID().slice(0, 8)}`,
    STORE_DEBOUNCE_MS: 100,
    STORE_MAX_DEBOUNCE_MS: 500,
    PERMISSION_CACHE_TTL_MS: 300,
    PERMISSION_SWEEP_INTERVAL_MS: 300,
    ANTI_ENTROPY_INTERVAL_MS: 60_000,
    DEGRADED_RECONCILE_INTERVAL_MS: 300,
    AUTO_VERSION_INTERVAL_MINUTES: 0,
    ...overrides,
  });
  const logger = process.env.COLLAB_TEST_LOGS
    ? createLogger(config.INSTANCE_NAME, 'debug')
    : silentLogger;
  const collab = createCollabServer(config, { logger, prisma: db() });
  const port = await collab.listen();
  return { ...collab, port, url: `ws://127.0.0.1:${port}` };
}

// ---------------------------------------------------------------------------
// fixtures (written straight to Postgres — the API is tested separately)
// ---------------------------------------------------------------------------

export interface Fixture {
  noteId: string;
  owner: TestUser;
  member(role: Exclude<NoteRole, 'OWNER'>, name?: string): Promise<TestUser>;
}

export interface TestUser {
  id: string;
  name: string;
}

export async function createUser(name: string): Promise<TestUser> {
  const user = await db().user.create({
    data: { email: `${name.toLowerCase()}-${randomUUID()}@test.local`, name, passwordHash: 'x' },
    select: { id: true, name: true },
  });
  return user;
}

export async function createNote(): Promise<Fixture> {
  const owner = await createUser('Owner');
  const note = await db().note.create({ data: { createdById: owner.id } });
  await db().noteMember.create({ data: { noteId: note.id, userId: owner.id, role: 'OWNER' } });
  return {
    noteId: note.id,
    owner,
    async member(role, name = role === 'EDITOR' ? 'Editor' : 'Viewer') {
      const user = await createUser(name);
      await db().noteMember.create({ data: { noteId: note.id, userId: user.id, role } });
      return user;
    },
  };
}

export function ticket(
  user: TestUser,
  noteId: string,
  options: { secret?: string; expiresIn?: number } = {},
): string {
  return jwt.sign(
    { sub: user.id, nid: noteId, name: user.name },
    options.secret ?? process.env.COLLAB_TICKET_SECRET!,
    {
      algorithm: 'HS256',
      audience: COLLAB_TICKET_AUDIENCE,
      issuer: COLLAB_TICKET_ISSUER,
      expiresIn: options.expiresIn ?? 60,
    },
  );
}

// ---------------------------------------------------------------------------
// clients
// ---------------------------------------------------------------------------

export interface TestClient {
  doc: Y.Doc;
  provider: HocuspocusProvider;
  stateless: ServerStatelessMessage[];
  authFailures: string[];
  /** plain text of the editor body */
  text(): string;
  /** append text to the first paragraph (created if missing) */
  type(text: string, index?: number): void;
  send(message: ClientStatelessMessage): void;
  destroy(): void;
}

export function bodyText(doc: Y.Doc): string {
  return extractPlainText(doc);
}

export function firstParagraphText(doc: Y.Doc): Y.XmlText {
  const body = doc.getXmlFragment('default');
  let paragraph = body.get(0) as Y.XmlElement | undefined;
  if (!paragraph) {
    paragraph = new Y.XmlElement('paragraph');
    paragraph.insert(0, [new Y.XmlText()]);
    body.insert(0, [paragraph]);
  }
  return paragraph.get(0) as Y.XmlText;
}

export function connect(
  server: { url: string },
  noteId: string,
  token: string | (() => Promise<string>),
  user?: TestUser,
): TestClient {
  const doc = new Y.Doc();
  const stateless: ServerStatelessMessage[] = [];
  const authFailures: string[] = [];
  const provider = new HocuspocusProvider({
    url: server.url,
    name: noteId,
    document: doc,
    token,
    onStateless: ({ payload }) => stateless.push(JSON.parse(payload) as ServerStatelessMessage),
    onAuthenticationFailed: ({ reason }) => authFailures.push(reason),
  });
  if (user) provider.setAwarenessField('user', { id: user.id, name: user.name });
  return {
    doc,
    provider,
    stateless,
    authFailures,
    text: () => bodyText(doc),
    type(text, index) {
      const t = firstParagraphText(doc);
      t.insert(index ?? t.length, text);
    },
    send: (message) => provider.sendStateless(JSON.stringify(message)),
    destroy: () => provider.destroy(),
  };
}

export async function connected(client: TestClient): Promise<TestClient> {
  await waitFor(() => client.provider.isSynced || client.authFailures.length > 0, {
    message: 'client did not sync',
  });
  return client;
}

// ---------------------------------------------------------------------------
// utilities
// ---------------------------------------------------------------------------

export async function waitFor(
  condition: () => boolean | Promise<boolean>,
  { timeout = 5000, interval = 20, message = 'condition not met' } = {},
): Promise<void> {
  const started = Date.now();
  while (true) {
    if (await condition()) return;
    if (Date.now() - started > timeout) throw new Error(`${message} (after ${timeout}ms)`);
    await sleep(interval);
  }
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Decodes the persisted Yjs state of a note. */
export async function persistedDoc(noteId: string): Promise<Y.Doc> {
  const note = await db().note.findUniqueOrThrow({
    where: { id: noteId },
    select: { ydocState: true },
  });
  const doc = new Y.Doc();
  if (note.ydocState) Y.applyUpdate(doc, note.ydocState);
  return doc;
}

export function serverDoc(collab: CollabServer, noteId: string): Y.Doc | undefined {
  return collab.server.hocuspocus.documents.get(noteId);
}

/** Persist everything pending on a server right now. */
export async function flush(collab: CollabServer): Promise<void> {
  collab.server.hocuspocus.flushPendingStores();
  await sleep(150);
}
