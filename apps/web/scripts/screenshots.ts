/**
 * Captures README screenshots from a running stack (npm run dev).
 * Usage: npx tsx scripts/screenshots.ts  → writes ../../docs/screenshots/*.png
 */
import { chromium, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const BASE = process.env.E2E_BASE_URL ?? 'http://localhost:5173';
const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../docs/screenshots');
const PASSWORD = 'screenshot-pass-123';

async function register(page: Page, name: string, email: string) {
  await page.goto(`${BASE}/register`);
  await page.getByLabel('Name').fill(name);
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Create account' }).click();
  await page.getByTestId('current-user').waitFor();
}

async function typeNote(page: Page, title: string, lines: string[]) {
  await page.getByRole('button', { name: 'New note' }).first().click();
  await page.waitForURL(/\/notes\//);
  await page.getByTestId('note-title').fill(title);
  await page.getByTestId('editor').click();
  for (const [i, line] of lines.entries()) {
    await page.keyboard.type(line);
    if (i < lines.length - 1) await page.keyboard.press('Enter');
  }
  return page.url();
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  const stamp = Date.now().toString(36);
  const mk = async (scheme: 'light' | 'dark') =>
    browser.newContext({
      viewport: { width: 1440, height: 900 },
      colorScheme: scheme,
      deviceScaleFactor: 1,
    });

  const adaCtx = await mk('light');
  const bobCtx = await mk('dark');
  const ada = await adaCtx.newPage();
  const bob = await bobCtx.newPage();
  const bobEmail = `bob-${stamp}@demo.test`;
  await register(bob, 'Bob Martin', bobEmail);
  await register(ada, 'Ada Lovelace', `ada-${stamp}@demo.test`);

  await ada.screenshot({ path: path.join(OUT, 'dashboard-empty.png') });

  for (const [title, lines] of [
    [
      'Q4 roadmap',
      ['# Goals', 'Ship real-time collaboration', 'Offline-first editing with IndexedDB'],
    ],
    [
      'Interview notes',
      ['Candidate showed strong CRDT fundamentals.', 'Follow up on Redis scaling questions.'],
    ],
    [
      'Reading list',
      ['Designing Data-Intensive Applications', 'Local-first software (Ink & Switch)'],
    ],
  ] as const) {
    await typeNote(ada, title, [...lines]);
    await ada.goto(BASE);
  }
  const url = await typeNote(ada, 'Sprint planning', [
    '## Agenda',
    '[ ] Review last sprint',
    'Estimate collaboration features',
    'Write the Redis outage tests',
  ]);

  // Share with Bob and make him type so his caret appears.
  await ada.getByTestId('share-button').click();
  await ada.getByLabel('E-mail to invite').fill(bobEmail);
  await ada.getByRole('button', { name: 'Invite' }).click();
  await ada.getByTestId('member-row').filter({ hasText: 'Bob Martin' }).waitFor();
  await ada.screenshot({ path: path.join(OUT, 'share-dialog.png') });
  await ada.keyboard.press('Escape');

  await bob.goto(url);
  await bob.getByTestId('connection-status').filter({ hasText: 'Saved' }).waitFor();
  await bob.getByTestId('editor').click();
  await bob.keyboard.press('Control+End');
  await bob.keyboard.press('Enter');
  await bob.keyboard.type('Pair-review the offline sync flow');
  await ada.waitForTimeout(4500); // let toasts fade out
  await ada.screenshot({ path: path.join(OUT, 'editor-light.png') });
  await bob.screenshot({ path: path.join(OUT, 'editor-dark.png') });

  await ada.getByTestId('history-button').click();
  await ada.getByLabel('Version name').fill('Before planning');
  await ada.getByTestId('save-version').click();
  await ada.getByTestId('version-item').first().waitFor();
  await ada.screenshot({ path: path.join(OUT, 'history.png') });

  await bobCtx.setOffline(true);
  await bob.getByTestId('connection-status').filter({ hasText: 'Offline' }).waitFor();
  await bob.keyboard.type(' (typed offline)');
  await bob.waitForTimeout(300);
  await bob.screenshot({ path: path.join(OUT, 'offline.png') });
  await bobCtx.setOffline(false);

  await ada.goto(BASE);
  await ada.waitForTimeout(2500);
  await ada.reload();
  await ada.getByTestId('note-grid').waitFor();
  await ada.screenshot({ path: path.join(OUT, 'dashboard.png') });

  const mobile = await browser.newContext({
    viewport: { width: 390, height: 844 },
    colorScheme: 'dark',
    deviceScaleFactor: 2,
  });
  const m = await mobile.newPage();
  await m.goto(`${BASE}/login`);
  await m.screenshot({ path: path.join(OUT, 'login-mobile.png') });

  await browser.close();
  console.log(`screenshots written to ${OUT}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
