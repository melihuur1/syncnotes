import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { AssignableRole, MemberDto } from '@syncnotes/shared';
import { isUuid } from '../common/note-access/note-access.service';
import { PrismaService } from '../prisma/prisma.service';
import { AccessEventsPublisher } from '../redis/access-events.publisher';

const ROLE_ORDER = { OWNER: 0, EDITOR: 1, VIEWER: 2 } as const;

@Injectable()
export class MembersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly events: AccessEventsPublisher,
  ) {}

  async list(noteId: string): Promise<MemberDto[]> {
    const members = await this.prisma.db.noteMember.findMany({
      where: { noteId },
      include: { user: { select: { id: true, email: true, name: true } } },
      orderBy: { createdAt: 'asc' },
    });
    return members
      .map((m) => ({
        userId: m.user.id,
        email: m.user.email,
        name: m.user.name,
        role: m.role,
        createdAt: m.createdAt.toISOString(),
      }))
      .sort((a, b) => ROLE_ORDER[a.role] - ROLE_ORDER[b.role]);
  }

  async invite(
    noteId: string,
    inviterId: string,
    email: string,
    role: AssignableRole,
  ): Promise<MemberDto> {
    const user = await this.prisma.db.user.findUnique({
      where: { email },
      select: { id: true, email: true, name: true },
    });
    if (!user) throw new NotFoundException('No SyncNotes account uses this e-mail address');
    if (user.id === inviterId) throw new BadRequestException('You already own this note');

    try {
      const member = await this.prisma.db.noteMember.create({
        data: { noteId, userId: user.id, role, invitedById: inviterId },
      });
      return {
        userId: user.id,
        email: user.email,
        name: user.name,
        role: member.role,
        createdAt: member.createdAt.toISOString(),
      };
    } catch (err) {
      if ((err as { code?: string }).code === 'P2002') {
        throw new ConflictException('This user is already a member of the note');
      }
      throw err;
    }
  }

  async updateRole(noteId: string, userId: string, role: AssignableRole): Promise<MemberDto> {
    const existing = await this.findMembership(noteId, userId);
    if (existing.role === 'OWNER')
      throw new BadRequestException("The owner's role cannot be changed");

    const member = await this.prisma.db.noteMember.update({
      where: { noteId_userId: { noteId, userId } },
      data: { role },
      include: { user: { select: { id: true, email: true, name: true } } },
    });
    // Live sessions are downgraded/upgraded without reconnecting.
    await this.events.publish({ type: 'member.updated', noteId, userId, role });
    return {
      userId: member.user.id,
      email: member.user.email,
      name: member.user.name,
      role: member.role,
      createdAt: member.createdAt.toISOString(),
    };
  }

  async remove(noteId: string, userId: string): Promise<void> {
    const existing = await this.findMembership(noteId, userId);
    if (existing.role === 'OWNER') throw new BadRequestException('The owner cannot be removed');

    await this.prisma.db.noteMember.delete({ where: { noteId_userId: { noteId, userId } } });
    // Open WebSocket sessions of this user are closed by every collaboration server.
    await this.events.publish({ type: 'member.removed', noteId, userId });
  }

  private async findMembership(noteId: string, userId: string) {
    if (!isUuid(userId)) throw new NotFoundException('Member not found');
    const membership = await this.prisma.db.noteMember.findUnique({
      where: { noteId_userId: { noteId, userId } },
      select: { role: true },
    });
    if (!membership) throw new NotFoundException('Member not found');
    return membership;
  }
}
