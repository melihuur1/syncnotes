import { Module } from '@nestjs/common';
import { FoldersModule } from '../folders/folders.module';
import { CollabTicketService } from './collab-ticket.service';
import { MembersService } from './members.service';
import { MembersController, NotesController, VersionsController } from './notes.controller';
import { NotesService } from './notes.service';
import { VersionsService } from './versions.service';

@Module({
  imports: [FoldersModule],
  controllers: [NotesController, MembersController, VersionsController],
  providers: [NotesService, MembersService, VersionsService, CollabTicketService],
})
export class NotesModule {}
