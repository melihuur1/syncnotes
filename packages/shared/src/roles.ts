export const NOTE_ROLES = ['OWNER', 'EDITOR', 'VIEWER'] as const;
export type NoteRole = (typeof NOTE_ROLES)[number];

/** Roles that can be granted through sharing. Ownership is never transferable via invites. */
export const ASSIGNABLE_ROLES = ['EDITOR', 'VIEWER'] as const;
export type AssignableRole = (typeof ASSIGNABLE_ROLES)[number];

const ROLE_RANK: Record<NoteRole, number> = {
  VIEWER: 1,
  EDITOR: 2,
  OWNER: 3,
};

/** True when `actual` grants at least the capabilities of `required`. */
export function hasRole(actual: NoteRole | null | undefined, required: NoteRole): boolean {
  if (!actual) return false;
  return ROLE_RANK[actual] >= ROLE_RANK[required];
}

export function canEdit(role: NoteRole | null | undefined): boolean {
  return hasRole(role, 'EDITOR');
}

export function isNoteRole(value: unknown): value is NoteRole {
  return typeof value === 'string' && (NOTE_ROLES as readonly string[]).includes(value);
}
