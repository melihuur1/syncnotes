import { type Browser, expect, type Page } from '@playwright/test';

export const PASSWORD = 'e2e-password-123';

export interface E2EUser {
  name: string;
  email: string;
  page: Page;
}

let counter = 0;
function uniqueEmail(name: string): string {
  counter += 1;
  return `${name.toLowerCase()}-${Date.now().toString(36)}-${counter}@e2e.test`;
}

/** Opens a fresh browser context (own cookies + IndexedDB) and registers a new account. */
export async function newUser(browser: Browser, name: string): Promise<E2EUser> {
  const context = await browser.newContext();
  const page = await context.newPage();
  const email = uniqueEmail(name);
  await page.goto('/register');
  await page.getByLabel('Name').fill(name);
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByTestId('current-user')).toHaveText(name);
  return { name, email, page };
}

export async function createNote(user: E2EUser, title: string): Promise<string> {
  await user.page.getByRole('button', { name: 'New note' }).first().click();
  await user.page.waitForURL(/\/notes\/[0-9a-f-]{36}$/);
  await expect(user.page.getByTestId('connection-status')).toHaveAttribute('data-phase', 'synced');
  await user.page.getByTestId('note-title').fill(title);
  return user.page.url().split('/notes/')[1]!;
}

export async function openNote(user: E2EUser, noteId: string): Promise<void> {
  await user.page.goto(`/notes/${noteId}`);
  await expect(user.page.getByTestId('connection-status')).toHaveAttribute('data-phase', 'synced');
}

export async function share(
  owner: E2EUser,
  member: E2EUser,
  role: 'Editor' | 'Viewer',
): Promise<void> {
  const { page } = owner;
  await page.getByTestId('share-button').click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('E-mail to invite').fill(member.email);
  await dialog.getByLabel('Role for the invite').selectOption({ label: role });
  await dialog.getByRole('button', { name: 'Invite' }).click();
  await expect(dialog.getByTestId('member-row').filter({ hasText: member.name })).toBeVisible();
  await page.keyboard.press('Escape');
}

/** Types at the end of the editor body. */
export async function typeInEditor(page: Page, text: string): Promise<void> {
  const editor = page.getByTestId('editor');
  await editor.click();
  await page.keyboard.press('Control+End');
  await page.keyboard.type(text);
}
