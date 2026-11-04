import { Global, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_CONFIG, parseEnv } from './env';

@Global()
@Module({
  imports: [
    ConfigModule.forRoot({
      // Run from apps/api (dev) or the repo root; explicit env vars always win.
      envFilePath: ['.env', '../../.env'],
      ignoreEnvFile: process.env.NODE_ENV === 'test',
      validate: (raw) => parseEnv(raw),
    }),
  ],
  providers: [
    {
      provide: APP_CONFIG,
      inject: [ConfigService],
      useFactory: () => parseEnv(process.env),
    },
  ],
  exports: [APP_CONFIG],
})
export class AppConfigModule {}
