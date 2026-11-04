import { z } from 'zod';

export const collabEnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1),
  COLLAB_PORT: z.coerce.number().int().nonnegative().default(1234),
  COLLAB_TICKET_SECRET: z.string().min(32),
  /** Unique per instance; shows up in logs and the health endpoint. */
  INSTANCE_NAME: z.string().default(`collab-${process.pid}`),
  /** Max age of a cached role before it is re-read from Postgres. */
  PERMISSION_CACHE_TTL_MS: z.coerce.number().int().positive().default(5000),
  /** Every open connection is re-authorised this often — also connections that never send. */
  PERMISSION_SWEEP_INTERVAL_MS: z.coerce.number().int().positive().default(5000),
  STORE_DEBOUNCE_MS: z.coerce.number().int().nonnegative().default(2000),
  STORE_MAX_DEBOUNCE_MS: z.coerce.number().int().positive().default(10000),
  AUTO_VERSION_INTERVAL_MINUTES: z.coerce.number().nonnegative().default(10),
  /** Max automatic snapshots kept per note (manual ones are never pruned). */
  AUTO_VERSION_KEEP: z.coerce.number().int().positive().default(50),
  /** How often open documents are reconciled through Postgres while Redis is unavailable. */
  DEGRADED_RECONCILE_INTERVAL_MS: z.coerce.number().int().positive().default(3000),
  /**
   * Anti-entropy pass through Postgres even while this instance's Redis link is healthy —
   * covers asymmetric partitions where *another* instance has lost Redis.
   */
  ANTI_ENTROPY_INTERVAL_MS: z.coerce.number().int().positive().default(15000),
  MAX_MESSAGE_BYTES: z.coerce
    .number()
    .int()
    .positive()
    .default(8 * 1024 * 1024),
});

export type CollabConfig = z.infer<typeof collabEnvSchema>;

export function loadCollabConfig(env: Record<string, unknown> = process.env): CollabConfig {
  const result = collabEnvSchema.safeParse(env);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid collaboration server configuration:\n${issues}`);
  }
  return result.data;
}
