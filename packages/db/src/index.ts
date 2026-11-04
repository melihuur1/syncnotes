import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from './generated/prisma/client';

export * from './generated/prisma/client';

export interface CreatePrismaClientOptions {
  /** Max connections in the pg pool (per process). */
  poolSize?: number;
}

/**
 * Creates a Prisma client backed by the `pg` driver adapter (Prisma 7, no Rust query engine).
 * Both the REST API and the collaboration server use this factory so they share one schema.
 */
export function createPrismaClient(
  databaseUrl: string,
  options: CreatePrismaClientOptions = {},
): PrismaClient {
  const adapter = new PrismaPg({ connectionString: databaseUrl, max: options.poolSize ?? 10 });
  return new PrismaClient({ adapter });
}
