import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import type {
  CollabTicketDto,
  MemberDto,
  NoteDetailDto,
  NoteRole,
  NoteSummaryDto,
  VersionDetailDto,
  VersionSummaryDto,
} from '@syncnotes/shared';
import type { AuthUser } from '../common/auth-user';
import { CurrentNoteRole, CurrentUser, RequireNoteRole } from '../common/decorators';
import { NoteRoleGuard } from '../common/note-access/note-role.guard';
import { CollabTicketService } from './collab-ticket.service';
import {
  CreateNoteDto,
  InviteMemberDto,
  ListNotesQueryDto,
  MoveNoteDto,
  UpdateMemberRoleDto,
} from './dto';
import { MembersService } from './members.service';
import { NotesService } from './notes.service';
import { VersionsService } from './versions.service';

@Controller('notes')
@UseGuards(NoteRoleGuard)
export class NotesController {
  constructor(
    private readonly notes: NotesService,
    private readonly tickets: CollabTicketService,
  ) {}

  @Get()
  list(@CurrentUser() user: AuthUser, @Query() query: ListNotesQueryDto): Promise<NoteSummaryDto[]> {
    return this.notes.list(user.id, query);
  }

  @Post()
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateNoteDto): Promise<NoteSummaryDto> {
    return this.notes.create(user.id, dto.folderId);
  }

  @Get(':noteId')
  @RequireNoteRole('VIEWER')
  get(@CurrentUser() user: AuthUser, @Param('noteId') noteId: string): Promise<NoteDetailDto> {
    return this.notes.get(user.id, noteId);
  }

  @Patch(':noteId/folder')
  @RequireNoteRole('VIEWER')
  move(
    @CurrentUser() user: AuthUser,
    @Param('noteId') noteId: string,
    @Body() dto: MoveNoteDto,
  ): Promise<NoteSummaryDto> {
    return this.notes.moveToFolder(user.id, noteId, dto.folderId ?? null);
  }

  @Delete(':noteId')
  @RequireNoteRole('OWNER')
  @HttpCode(204)
  remove(@Param('noteId') noteId: string): Promise<void> {
    return this.notes.remove(noteId);
  }

  @Post(':noteId/leave')
  @RequireNoteRole('VIEWER')
  @HttpCode(204)
  leave(
    @CurrentUser() user: AuthUser,
    @Param('noteId') noteId: string,
    @CurrentNoteRole() role: NoteRole,
  ): Promise<void> {
    return this.notes.leave(user.id, noteId, role);
  }

  /** Short-lived ticket for the collaboration WebSocket (see CollabTicketService). */
  @Post(':noteId/collab-ticket')
  @RequireNoteRole('VIEWER')
  @HttpCode(200)
  ticket(
    @CurrentUser() user: AuthUser,
    @Param('noteId') noteId: string,
    @CurrentNoteRole() role: NoteRole,
  ): Promise<CollabTicketDto> {
    return this.tickets.issue(user, noteId, role);
  }
}

@Controller('notes/:noteId/members')
@UseGuards(NoteRoleGuard)
export class MembersController {
  constructor(private readonly members: MembersService) {}

  @Get()
  @RequireNoteRole('VIEWER')
  list(@Param('noteId') noteId: string): Promise<MemberDto[]> {
    return this.members.list(noteId);
  }

  @Post()
  @RequireNoteRole('OWNER')
  invite(
    @CurrentUser() user: AuthUser,
    @Param('noteId') noteId: string,
    @Body() dto: InviteMemberDto,
  ): Promise<MemberDto> {
    return this.members.invite(noteId, user.id, dto.email, dto.role);
  }

  @Patch(':userId')
  @RequireNoteRole('OWNER')
  updateRole(
    @Param('noteId') noteId: string,
    @Param('userId') userId: string,
    @Body() dto: UpdateMemberRoleDto,
  ): Promise<MemberDto> {
    return this.members.updateRole(noteId, userId, dto.role);
  }

  @Delete(':userId')
  @RequireNoteRole('OWNER')
  @HttpCode(204)
  remove(@Param('noteId') noteId: string, @Param('userId') userId: string): Promise<void> {
    return this.members.remove(noteId, userId);
  }
}

@Controller('notes/:noteId/versions')
@UseGuards(NoteRoleGuard)
export class VersionsController {
  constructor(private readonly versions: VersionsService) {}

  @Get()
  @RequireNoteRole('VIEWER')
  list(@Param('noteId') noteId: string): Promise<VersionSummaryDto[]> {
    return this.versions.list(noteId);
  }

  @Get(':versionId')
  @RequireNoteRole('VIEWER')
  get(
    @Param('noteId') noteId: string,
    @Param('versionId') versionId: string,
  ): Promise<VersionDetailDto> {
    return this.versions.get(noteId, versionId);
  }
}
