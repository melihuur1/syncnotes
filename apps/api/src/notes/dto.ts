import { Transform } from 'class-transformer';
import { IsEmail, IsIn, IsOptional, IsString, IsUUID, Matches, MaxLength } from 'class-validator';
import { ASSIGNABLE_ROLES, type AssignableRole } from '@syncnotes/shared';

export class ListNotesQueryDto {
  @IsOptional()
  @IsIn(['all', 'owned', 'shared'])
  scope?: 'all' | 'owned' | 'shared';

  @IsOptional()
  @Matches(/^(none|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i, {
    message: 'folderId must be a UUID or "none"',
  })
  folderId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  q?: string;
}

export class CreateNoteDto {
  @IsOptional()
  @IsUUID()
  folderId?: string;
}

export class MoveNoteDto {
  /** `null` removes the note from its folder (for the current user only). */
  @IsOptional()
  @IsUUID()
  folderId!: string | null;
}

export class InviteMemberDto {
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  @IsEmail()
  @MaxLength(254)
  email!: string;

  /** OWNER is deliberately not assignable — ownership cannot be granted through sharing. */
  @IsIn(ASSIGNABLE_ROLES)
  role!: AssignableRole;
}

export class UpdateMemberRoleDto {
  @IsIn(ASSIGNABLE_ROLES)
  role!: AssignableRole;
}
