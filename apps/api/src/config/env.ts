import { z } from 'zod';

const booleanString = z
  .union([z.boolean(), z.string()])
  .transform((value) => value === true || value === 'true' || value === '1');

export const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    DATABASE_URL: z.string().min(1),
    REDIS_URL: z.string().min(1),
    WEB_ORIGIN: z.string().url().default('http://localhost:5173'),
    API_PORT: z.coerce.number().int().positive().default(4000),

    JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET must be at least 32 characters'),
    JWT_ACCESS_TTL_SECONDS: z.coerce.number().int().positive().default(900),
    REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(7),
    COOKIE_SECURE: booleanString.default(false),

    COLLAB_TICKET_SECRET: z.string().min(32, 'COLLAB_TICKET_SECRET must be at least 32 characters'),
    COLLAB_TICKET_TTL_SECONDS: z.coerce.number().int().positive().max(300).default(60),

    LOGIN_MAX_ATTEMPTS: z.coerce.number().int().positive().default(5),
    LOGIN_LOCK_MINUTES: z.coerce.number().int().positive().default(15),
    THROTTLE_AUTH_LIMIT: z.coerce.number().int().positive().default(10),
    THROTTLE_DEFAULT_LIMIT: z.coerce.number().int().positive().default(300),
  })
  .refine((env) => env.JWT_ACCESS_SECRET !== env.COLLAB_TICKET_SECRET, {
    message: 'COLLAB_TICKET_SECRET must differ from JWT_ACCESS_SECRET',
    path: ['COLLAB_TICKET_SECRET'],
  });

export type AppConfig = z.infer<typeof envSchema>;

export const APP_CONFIG = Symbol('APP_CONFIG');

export function parseEnv(raw: Record<string, unknown>): AppConfig {
  const result = envSchema.safeParse(raw);
  if (!result.success) {
    const issues = result.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  return result.data;
}
