import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { hasRole, NoteRole } from '@syncnotes/shared';
import { PrismaService } from '../../prisma/prisma.service';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_RE.test(value);
}

/** Single place where "can user X do Y on note Z" is decided for the REST API. */
@Injectable()
export class NoteAccessService {
  constructor(private readonly prisma: PrismaService) {}

  async getRole(userId: string, noteId: string): Promise<NoteRole | null> {
    if (!isUuid(noteId)) return null;
    const membership = await this.prisma.db.noteMember.findUnique({
      where: { noteId_userId: { noteId, userId } },
      select: { role: true },
    });
    return membership?.role ?? null;
  }

  /**
   * Returns the caller's role or throws:
   * - 404 when the caller is not a member (do not reveal that the note exists)
   * - 403 when the caller is a member without the required role
   */
  async require(userId: string, noteId: string, required: NoteRole): Promise<NoteRole> {
    const role = await this.getRole(userId, noteId);
    if (!role) throw new NotFoundException('Note not found');
    if (!hasRole(role, required)) {
      throw new ForbiddenException(`This action requires the ${required} role`);
    }
    return role;
  }
}
