import { INestApplication, ValidationPipe } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { CSRF_HEADER } from './common/cookies';
import { APP_CONFIG, AppConfig } from './config/env';

/** HTTP pipeline shared by `main.ts` and the integration tests (so tests exercise the real setup). */
export function configureApp(app: INestApplication): INestApplication {
  const config = app.get<AppConfig>(APP_CONFIG);
  const express = app as NestExpressApplication;

  // Behind the nginx reverse proxy (docker compose) — needed for correct client IPs in throttling.
  express.set('trust proxy', 1);
  express.disable('x-powered-by');

  app.setGlobalPrefix('api');
  app.use(helmet());
  app.use(cookieParser());
  app.enableCors({
    origin: [config.WEB_ORIGIN],
    credentials: true,
    allowedHeaders: ['content-type', CSRF_HEADER],
    methods: ['GET', 'POST', 'PATCH', 'DELETE'],
  });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  app.enableShutdownHooks();
  return app;
}
