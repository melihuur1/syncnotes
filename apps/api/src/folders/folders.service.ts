import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { FolderDto } from '@syncnotes/shared';
import { isUuid } from '../common/note-access/note-access.service';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class FoldersService {
  constructor(private readonly prisma: PrismaService) {}

  async list(userId: string): Promise<FolderDto[]> {
    const folders = await this.prisma.db.folder.findMany({
      where: { ownerId: userId },
      orderBy: { name: 'asc' },
      include: { _count: { select: { entries: true } } },
    });
    return folders.map((f) => ({
      id: f.id,
      name: f.name,
      noteCount: f._count.entries,
      createdAt: f.createdAt.toISOString(),
    }));
  }

  async create(userId: string, name: string): Promise<FolderDto> {
    try {
      const folder = await this.prisma.db.folder.create({ data: { ownerId: userId, name } });
      return { id: folder.id, name: folder.name, noteCount: 0, createdAt: folder.createdAt.toISOString() };
    } catch (err) {
      if ((err as { code?: string }).code === 'P2002') {
        throw new ConflictException('A folder with this name already exists');
      }
      throw err;
    }
  }

  async rename(userId: string, folderId: string, name: string): Promise<FolderDto> {
    await this.assertOwned(userId, folderId);
    try {
      const folder = await this.prisma.db.folder.update({
        where: { id: folderId },
        data: { name },
        include: { _count: { select: { entries: true } } },
      });
      return {
        id: folder.id,
        name: folder.name,
        noteCount: folder._count.entries,
        createdAt: folder.createdAt.toISOString(),
      };
    } catch (err) {
      if ((err as { code?: string }).code === 'P2002') {
        throw new ConflictException('A folder with this name already exists');
      }
      throw err;
    }
  }

  /** Notes inside the folder are not deleted — they move back to "unfiled" (FK `ON DELETE SET NULL`). */
  async remove(userId: string, folderId: string): Promise<void> {
    await this.assertOwned(userId, folderId);
    await this.prisma.db.folder.delete({ where: { id: folderId } });
  }

  /** Folders are private: someone else's folder id is indistinguishable from a missing one. */
  async assertOwned(userId: string, folderId: string): Promise<void> {
    if (!isUuid(folderId)) throw new NotFoundException('Folder not found');
    const folder = await this.prisma.db.folder.findFirst({
      where: { id: folderId, ownerId: userId },
      select: { id: true },
    });
    if (!folder) throw new NotFoundException('Folder not found');
  }
}
