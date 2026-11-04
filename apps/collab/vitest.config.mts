import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
    setupFiles: ['test/setup-env.ts'],
    // Integration suites spin up real servers against shared Postgres/Redis and assert on
    // timing (TTL fallbacks, outages) — run files one at a time for deterministic results.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
