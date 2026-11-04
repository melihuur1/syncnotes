import { Global, Module } from '@nestjs/common';
import { NoteAccessService } from './note-access.service';
import { NoteRoleGuard } from './note-role.guard';

@Global()
@Module({
  providers: [NoteAccessService, NoteRoleGuard],
  exports: [NoteAccessService, NoteRoleGuard],
})
export class NoteAccessModule {}
