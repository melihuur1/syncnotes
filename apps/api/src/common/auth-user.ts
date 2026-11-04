import type { Request } from 'express';
import type { NoteRole } from '@syncnotes/shared';

/** Identity attached to the request by `JwtAuthGuard`. */
export interface AuthUser {
  id: string;
  name: string;
  email: string;
  /** refresh-token family id this access token belongs to */
  sessionFamilyId: string;
}

export interface AuthenticatedRequest extends Request {
  user: AuthUser;
  /** set by `NoteRoleGuard` */
  noteRole?: NoteRole;
}

export interface AccessTokenClaims {
  sub: string;
  sid: string;
  name: string;
  email: string;
}
