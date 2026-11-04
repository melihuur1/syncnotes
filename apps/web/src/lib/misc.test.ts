import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { IndexeddbPersistence } from 'y-indexeddb';
import { colorForUser, initials, PRESENCE_COLORS } from './colors';
import { clearAllLocalReplicas, localReplicaName } from './offline-store';
import { timeAgo } from './time';

describe('presence colours', () => {
  it('are stable per user and drawn from the palette', () => {
    const a = colorForUser('8d3f1a2e-0000-4000-8000-000000000001');
    expect(colorForUser('8d3f1a2e-0000-4000-8000-000000000001')).toBe(a);
    expect(PRESENCE_COLORS).toContain(a);
  });

  it('builds initials', () => {
    expect(initials('Ada Lovelace')).toBe('AL');
    expect(initials('grace')).toBe('G');
    expect(initials('  ')).toBe('?');
  });
});

describe('timeAgo', () => {
  it('formats relative times', () => {
    const now = Date.parse('2026-01-01T12:00:00Z');
    expect(timeAgo('2026-01-01T11:59:50Z', now)).toBe('just now');
    expect(timeAgo('2026-01-01T11:55:00Z', now)).toBe('5 minutes ago');
    expect(timeAgo('2025-12-31T12:00:00Z', now)).toBe('yesterday');
  });
});

describe('offline replicas', () => {
  it('are namespaced per user and wiped on logout', async () => {
    expect(localReplicaName('u1', 'n1')).toBe('syncnotes:u1:n1');

    const doc = new Y.Doc();
    const persistence = new IndexeddbPersistence(localReplicaName('u1', 'n1'), doc);
    await persistence.whenSynced;
    doc.getText('title').insert(0, 'cached offline');
    await new Promise((r) => setTimeout(r, 50));
    await persistence.destroy();

    const other = new IndexeddbPersistence(localReplicaName('u2', 'n1'), new Y.Doc());
    await other.whenSynced;
    await other.destroy();

    await clearAllLocalReplicas('u1');
    const names = (await indexedDB.databases()).map((d) => d.name);
    expect(names).not.toContain('syncnotes:u1:n1');
    expect(names).toContain('syncnotes:u2:n1');
  });
});
