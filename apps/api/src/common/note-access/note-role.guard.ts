import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { NoteRole } from '@syncnotes/shared';
import type { AuthenticatedRequest } from '../auth-user';
import { NOTE_ROLE_KEY } from '../decorators';
import { NoteAccessService } from './note-access.service';

/** Enforces `@RequireNoteRole(...)` using the `:noteId` route parameter. */
@Injectable()
export class NoteRoleGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly access: NoteAccessService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const required = this.reflector.getAllAndOverride<NoteRole | undefined>(NOTE_ROLE_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required) return true;

    const req = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const noteId = req.params.noteId;
    req.noteRole = await this.access.require(req.user.id, String(noteId), required);
    return true;
  }
}
