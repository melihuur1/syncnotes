import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post } from '@nestjs/common';
import { Transform } from 'class-transformer';
import { IsString, Length } from 'class-validator';
import type { FolderDto } from '@syncnotes/shared';
import type { AuthUser } from '../common/auth-user';
import { CurrentUser } from '../common/decorators';
import { FoldersService } from './folders.service';

export class FolderNameDto {
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @Length(1, 60)
  name!: string;
}

@Controller('folders')
export class FoldersController {
  constructor(private readonly folders: FoldersService) {}

  @Get()
  list(@CurrentUser() user: AuthUser): Promise<FolderDto[]> {
    return this.folders.list(user.id);
  }

  @Post()
  create(@CurrentUser() user: AuthUser, @Body() dto: FolderNameDto): Promise<FolderDto> {
    return this.folders.create(user.id, dto.name);
  }

  @Patch(':folderId')
  rename(
    @CurrentUser() user: AuthUser,
    @Param('folderId') folderId: string,
    @Body() dto: FolderNameDto,
  ): Promise<FolderDto> {
    return this.folders.rename(user.id, folderId, dto.name);
  }

  @Delete(':folderId')
  @HttpCode(204)
  remove(@CurrentUser() user: AuthUser, @Param('folderId') folderId: string): Promise<void> {
    return this.folders.remove(user.id, folderId);
  }
}
