import { Inject, Injectable, OnModuleDestroy } from '@nestjs/common';
import { createPrismaClient, PrismaClient } from '@syncnotes/db';
import { APP_CONFIG, AppConfig } from '../config/env';

/**
 * Thin injectable wrapper around the shared Prisma client.
 * `db` is the actual client; keeping it as a property (instead of extending PrismaClient)
 * keeps the Prisma 7 factory/adapter setup in one place (`@syncnotes/db`).
 */
@Injectable()
export class PrismaService implements OnModuleDestroy {
  readonly db: PrismaClient;

  constructor(@Inject(APP_CONFIG) config: AppConfig) {
    this.db = createPrismaClient(config.DATABASE_URL);
  }

  async onModuleDestroy(): Promise<void> {
    await this.db.$disconnect();
  }
}
