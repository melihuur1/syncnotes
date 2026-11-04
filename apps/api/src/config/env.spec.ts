import { parseEnv } from './env';

const valid = {
  DATABASE_URL: 'postgresql://u:p@localhost:5432/db',
  REDIS_URL: 'redis://localhost:6379',
  JWT_ACCESS_SECRET: 'a'.repeat(40),
  COLLAB_TICKET_SECRET: 'b'.repeat(40),
};

describe('parseEnv', () => {
  it('applies secure defaults', () => {
    const env = parseEnv(valid);
    expect(env.JWT_ACCESS_TTL_SECONDS).toBe(900);
    expect(env.COLLAB_TICKET_TTL_SECONDS).toBe(60);
    expect(env.COOKIE_SECURE).toBe(false);
    expect(parseEnv({ ...valid, COOKIE_SECURE: 'true' }).COOKIE_SECURE).toBe(true);
  });

  it('rejects weak or reused secrets', () => {
    expect(() => parseEnv({ ...valid, JWT_ACCESS_SECRET: 'short' })).toThrow(/at least 32/);
    expect(() => parseEnv({ ...valid, COLLAB_TICKET_SECRET: valid.JWT_ACCESS_SECRET })).toThrow(
      /must differ/,
    );
  });

  it('caps the collaboration ticket lifetime', () => {
    expect(() => parseEnv({ ...valid, COLLAB_TICKET_TTL_SECONDS: '3600' })).toThrow();
  });
});
