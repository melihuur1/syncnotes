import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end tests drive real browsers against the full stack (web + API + collaboration
 * server + Postgres + Redis). Locally they reuse already running dev servers; in CI the
 * servers are started from the production builds.
 */
const CI = !!process.env.CI;
const WEB_URL = process.env.E2E_BASE_URL ?? 'http://localhost:5173';

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: CI ? 1 : 0,
  reporter: CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: WEB_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      command: CI ? 'node ../api/dist/main.js' : 'npm run dev -w @syncnotes/api',
      cwd: CI ? '.' : '../..',
      url: 'http://localhost:4000/api/health',
      reuseExistingServer: !CI,
      timeout: 120_000,
    },
    {
      command: CI ? 'node ../collab/dist/main.js' : 'npm run dev -w @syncnotes/collab',
      cwd: CI ? '.' : '../..',
      url: 'http://localhost:1234/health',
      reuseExistingServer: !CI,
      timeout: 120_000,
    },
    {
      command: CI ? 'npx vite preview --port 5173' : 'npx vite',
      url: WEB_URL,
      reuseExistingServer: !CI,
      timeout: 120_000,
    },
  ],
});
