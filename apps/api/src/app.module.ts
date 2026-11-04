import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AuthModule } from './auth/auth.module';
import { CsrfGuard } from './common/guards/csrf.guard';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { NoteAccessModule } from './common/note-access/note-access.module';
import { isAuthRateLimited } from './common/throttle';
import { AppConfigModule } from './config/config.module';
import { APP_CONFIG, AppConfig } from './config/env';
import { FoldersModule } from './folders/folders.module';
import { HealthController } from './health/health.controller';
import { NotesModule } from './notes/notes.module';
import { PrismaModule } from './prisma/prisma.module';
import { RedisModule } from './redis/redis.module';

@Module({
  imports: [
    AppConfigModule,
    // Secrets are passed per call (access tokens vs. collab tickets use different keys).
    JwtModule.register({ global: true }),
    ThrottlerModule.forRootAsync({
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) => ({
        throttlers: [
          { name: 'default', ttl: 60_000, limit: config.THROTTLE_DEFAULT_LIMIT },
          {
            name: 'auth',
            ttl: 60_000,
            limit: config.THROTTLE_AUTH_LIMIT,
            skipIf: (ctx) => !isAuthRateLimited(ctx),
          },
        ],
      }),
    }),
    PrismaModule,
    RedisModule,
    NoteAccessModule,
    AuthModule,
    FoldersModule,
    NotesModule,
  ],
  controllers: [HealthController],
  providers: [
    // Order matters: rate limit → authenticate → CSRF.
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: CsrfGuard },
  ],
})
export class AppModule {}
