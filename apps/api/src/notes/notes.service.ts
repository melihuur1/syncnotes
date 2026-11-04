import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { NoteDetailDto, NoteSummaryDto } from '@syncnotes/shared';
import type { Prisma } from '@syncnotes/db';
import { FoldersService } from '../folders/folders.service';
import { PrismaService } from '../prisma/prisma.service';
import { AccessEventsPublisher } from '../redis/access-events.publisher';
import { MembersService } from './members.service';

export type NoteScope = 'all' | 'owned' | 'shared';

export interface ListNotesQuery {
  scope?: NoteScope;
  /** folder uuid, or `none` for notes that are not in any folder */
  folderId?: string;
  q?: string;
}

const noteInclude = {
  members: {
    where: { role: 'OWNER' },
    select: { user: { select: { id: true, name: true } } },
  },
  _count: { select: { members: true } },
} satisfies Prisma.NoteInclude;

type MembershipWithNote = Prisma.NoteMemberGetPayload<{
  include: { note: { include: typeof noteInclude } };
}>;

function toSummary(m: MembershipWithNote): NoteSummaryDto {
  const owner = m.note.members[0]?.user ?? { id: m.note.createdById, name: 'Unknown' };
  return {
    id: m.note.id,
    title: m.note.title,
    excerpt: m.note.excerpt,
    role: m.role,
    folderId: m.folderId,
    owner,
    memberCount: m.note._count.members,
    createdAt: m.note.createdAt.toISOString(),
    updatedAt: m.note.updatedAt.toISOString(),
  };
}

@Injectable()
export class NotesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly folders: FoldersService,
    private readonly members: MembersService,
    private readonly events: AccessEventsPublisher,
  ) {}

  async list(userId: string, query: ListNotesQuery): Promise<NoteSummaryDto[]> {
    const where: Prisma.NoteMemberWhereInput = { userId };
    if (query.scope === 'owned') where.role = 'OWNER';
    if (query.scope === 'shared') where.role = { not: 'OWNER' };
    if (query.folderId === 'none') where.folderId = null;
    else if (query.folderId) where.folderId = query.folderId;

    const q = query.q?.trim();
    if (q) {
      where.note = {
        OR: [
          { title: { contains: q, mode: 'insensitive' } },
          { plainText: { contains: q, mode: 'insensitive' } },
        ],
      };
    }

    const memberships = await this.prisma.db.noteMember.findMany({
      where,
      include: { note: { include: noteInclude } },
      orderBy: { note: { updatedAt: 'desc' } },
      take: 200,
    });
    return memberships.map(toSummary);
  }

  async create(userId: string, folderId?: string | null): Promise<NoteSummaryDto> {
    if (folderId) await this.folders.assertOwned(userId, folderId);

    const membership = await this.prisma.db.$transaction(async (tx) => {
      const note = await tx.note.create({ data: { createdById: userId } });
      return tx.noteMember.create({
        data: { noteId: note.id, userId, role: 'OWNER', folderId: folderId ?? null },
        include: { note: { include: noteInclude } },
      });
    });
    return toSummary(membership);
  }

  async get(userId: string, noteId: string): Promise<NoteDetailDto> {
    const membership = await this.prisma.db.noteMember.findUnique({
      where: { noteId_userId: { noteId, userId } },
      include: { note: { include: noteInclude } },
    });
    if (!membership) throw new NotFoundException('Note not found');
    return { ...toSummary(membership), members: await this.members.list(noteId) };
  }

  /** Folder placement is per user, so any member (even a viewer) may file a note. */
  async moveToFolder(
    userId: string,
    noteId: string,
    folderId: string | null,
  ): Promise<NoteSummaryDto> {
    if (folderId) await this.folders.assertOwned(userId, folderId);
    const membership = await this.prisma.db.noteMember.update({
      where: { noteId_userId: { noteId, userId } },
      data: { folderId },
      include: { note: { include: noteInclude } },
    });
    return toSummary(membership);
  }

  async remove(noteId: string): Promise<void> {
    await this.prisma.db.note.delete({ where: { id: noteId } });
    await this.events.publish({ type: 'note.deleted', noteId });
  }

  async leave(userId: string, noteId: string, role: string): Promise<void> {
    if (role === 'OWNER') {
      throw new BadRequestException('The owner cannot leave a note; delete it instead');
    }
    await this.members.remove(noteId, userId);
  }
}
