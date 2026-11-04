import type { AssignableRole, NoteRole } from './roles';

/** Response shapes of the REST API (consumed by the web client). */

export interface PublicUser {
  id: string;
  email: string;
  name: string;
}

export interface AuthResponse {
  user: PublicUser;
}

export interface FolderDto {
  id: string;
  name: string;
  noteCount: number;
  createdAt: string;
}

export interface MemberDto {
  userId: string;
  email: string;
  name: string;
  role: NoteRole;
  createdAt: string;
}

export interface NoteSummaryDto {
  id: string;
  title: string;
  excerpt: string;
  role: NoteRole;
  folderId: string | null;
  owner: { id: string; name: string };
  memberCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface NoteDetailDto extends NoteSummaryDto {
  members: MemberDto[];
}

export interface CollabTicketDto {
  token: string;
  role: NoteRole;
  expiresIn: number;
}

export interface VersionSummaryDto {
  id: string;
  kind: 'MANUAL' | 'AUTO' | 'RESTORE';
  label: string | null;
  sizeBytes: number;
  createdAt: string;
  createdBy: { id: string; name: string } | null;
}

export interface VersionDetailDto extends VersionSummaryDto {
  /** Base64 encoded Yjs update (full document state at snapshot time). */
  state: string;
}

export interface InviteMemberRequest {
  email: string;
  role: AssignableRole;
}

export interface ApiErrorBody {
  statusCode: number;
  error: string;
  message: string | string[];
}
