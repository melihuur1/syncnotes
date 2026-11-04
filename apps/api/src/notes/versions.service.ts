import { Injectable, NotFoundException } from '@nestjs/common';
import type { VersionDetailDto, VersionSummaryDto } from '@syncnotes/shared';
import { isUuid } from '../common/note-access/note-access.service';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Read side of the version history. Snapshots are *created and restored* by the collaboration
 * server (it owns the live Y.Doc); the API only lists them and serves their binary state so the
 * client can render a read-only preview with the exact same editor.
 */
@Injectable()
export class VersionsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(noteId: string): Promise<VersionSummaryDto[]> {
    const versions = await this.prisma.db.noteVersion.findMany({
      where: { noteId },
      orderBy: { createdAt: 'desc' },
      take: 100,
      select: {
        id: true,
        kind: true,
        label: true,
        sizeBytes: true,
        createdAt: true,
        createdBy: { select: { id: true, name: true } },
      },
    });
    return versions.map((v) => ({ ...v, createdAt: v.createdAt.toISOString() }));
  }

  async get(noteId: string, versionId: string): Promise<VersionDetailDto> {
    if (!isUuid(versionId)) throw new NotFoundException('Version not found');
    const v = await this.prisma.db.noteVersion.findFirst({
      where: { id: versionId, noteId },
      include: { createdBy: { select: { id: true, name: true } } },
    });
    if (!v) throw new NotFoundException('Version not found');
    return {
      id: v.id,
      kind: v.kind,
      label: v.label,
      sizeBytes: v.sizeBytes,
      createdAt: v.createdAt.toISOString(),
      createdBy: v.createdBy,
      state: Buffer.from(v.state).toString('base64'),
    };
  }
}
