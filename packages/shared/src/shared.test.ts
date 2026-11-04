import { describe, expect, it } from 'vitest';
import { canEdit, hasRole, isNoteRole } from './roles';
import { parseAccessEvent, serializeAccessEvent } from './access-events';

describe('roles', () => {
  it('ranks OWNER > EDITOR > VIEWER', () => {
    expect(hasRole('OWNER', 'EDITOR')).toBe(true);
    expect(hasRole('EDITOR', 'EDITOR')).toBe(true);
    expect(hasRole('VIEWER', 'EDITOR')).toBe(false);
    expect(hasRole('EDITOR', 'OWNER')).toBe(false);
    expect(hasRole(null, 'VIEWER')).toBe(false);
  });

  it('only owners and editors can edit', () => {
    expect(canEdit('OWNER')).toBe(true);
    expect(canEdit('EDITOR')).toBe(true);
    expect(canEdit('VIEWER')).toBe(false);
    expect(canEdit(undefined)).toBe(false);
  });

  it('validates role strings', () => {
    expect(isNoteRole('EDITOR')).toBe(true);
    expect(isNoteRole('ADMIN')).toBe(false);
    expect(isNoteRole(3)).toBe(false);
  });
});

describe('access events', () => {
  it('round-trips valid events', () => {
    const event = {
      type: 'member.updated',
      noteId: 'n1',
      userId: 'u1',
      role: 'VIEWER',
      at: 1,
    } as const;
    expect(parseAccessEvent(serializeAccessEvent(event))).toEqual(event);
  });

  it('rejects malformed payloads instead of throwing', () => {
    expect(parseAccessEvent('not json')).toBeNull();
    expect(parseAccessEvent(JSON.stringify({ type: 'member.removed', noteId: 'n1' }))).toBeNull();
    expect(parseAccessEvent(JSON.stringify({ type: 'unknown', noteId: 'n1' }))).toBeNull();
    expect(parseAccessEvent('null')).toBeNull();
  });
});
