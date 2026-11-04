import { ForbiddenException, NotFoundException } from '@nestjs/common';
import type { NoteRole } from '@syncnotes/shared';
import type { PrismaService } from '../../prisma/prisma.service';
import { NoteAccessService } from './note-access.service';

const NOTE = '6f1c1c2e-4a0b-4c41-9b7e-0c5e4c1f8a11';

function serviceWith(role: NoteRole | null) {
  const findUnique = jest.fn().mockResolvedValue(role ? { role } : null);
  const prisma = { db: { noteMember: { findUnique } } } as unknown as PrismaService;
  return { service: new NoteAccessService(prisma), findUnique };
}

describe('NoteAccessService', () => {
  it('returns 404 for non-members so note existence is not leaked', async () => {
    const { service } = serviceWith(null);
    await expect(service.require('u1', NOTE, 'VIEWER')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('returns 403 when the member lacks the required role', async () => {
    const { service } = serviceWith('VIEWER');
    await expect(service.require('u1', NOTE, 'EDITOR')).rejects.toBeInstanceOf(ForbiddenException);
    const { service: editor } = serviceWith('EDITOR');
    await expect(editor.require('u1', NOTE, 'OWNER')).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('resolves the role when sufficient', async () => {
    const { service } = serviceWith('OWNER');
    await expect(service.require('u1', NOTE, 'EDITOR')).resolves.toBe('OWNER');
  });

  it('does not hit the database for malformed ids', async () => {
    const { service, findUnique } = serviceWith('OWNER');
    await expect(service.require('u1', "1' OR '1'='1", 'VIEWER')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(findUnique).not.toHaveBeenCalled();
  });
});
