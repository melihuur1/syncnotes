import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import type { NoteRole } from '@syncnotes/shared';
import type { AuthenticatedRequest, AuthUser } from './auth-user';

export const IS_PUBLIC_KEY = 'syncnotes:isPublic';
/** Opt a route out of the global JWT guard. */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

export const NOTE_ROLE_KEY = 'syncnotes:noteRole';
/**
 * Require the caller to hold at least `role` on the note identified by the `:noteId` route param.
 * Non-members get 404 (existence is not leaked), insufficient roles get 403.
 */
export const RequireNoteRole = (role: NoteRole) => SetMetadata(NOTE_ROLE_KEY, role);

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthUser =>
    ctx.switchToHttp().getRequest<AuthenticatedRequest>().user,
);

/** The caller's role on the current note (populated by `NoteRoleGuard`). */
export const CurrentNoteRole = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): NoteRole | undefined =>
    ctx.switchToHttp().getRequest<AuthenticatedRequest>().noteRole,
);
