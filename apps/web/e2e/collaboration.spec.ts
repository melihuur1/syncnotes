import { expect, test } from '@playwright/test';
import { createNote, newUser, openNote, PASSWORD, share, typeInEditor } from './helpers';

test.describe('SyncNotes end-to-end', () => {
  test('register, sign out and sign back in', async ({ browser }) => {
    const ada = await newUser(browser, 'Ada');
    await ada.page.getByRole('button', { name: 'Sign out' }).click();
    await expect(ada.page).toHaveURL(/\/login$/);

    await ada.page.getByLabel('Email').fill(ada.email);
    await ada.page.getByLabel('Password').fill('wrong-password');
    await ada.page.getByRole('button', { name: 'Sign in' }).click();
    await expect(ada.page.getByRole('alert')).toContainText('Invalid email or password');

    await ada.page.getByLabel('Password').fill(PASSWORD);
    await ada.page.getByRole('button', { name: 'Sign in' }).click();
    await expect(ada.page.getByTestId('current-user')).toHaveText('Ada');
  });

  test('two editors type into the same note and see each other live', async ({ browser }) => {
    const ada = await newUser(browser, 'Ada');
    const bob = await newUser(browser, 'Bob');
    const noteId = await createNote(ada, 'Team plan');
    await share(ada, bob, 'Editor');

    await openNote(bob, noteId);
    await expect(bob.page.getByTestId('note-title')).toHaveValue('Team plan');

    await typeInEditor(ada.page, 'Hello from Ada. ');
    await expect(bob.page.getByTestId('editor')).toContainText('Hello from Ada.');

    await typeInEditor(bob.page, 'Hi from Bob!');
    await expect(ada.page.getByTestId('editor')).toContainText('Hello from Ada. Hi from Bob!');

    // Remote caret with the collaborator's name, and presence avatars.
    await expect(
      ada.page.locator('.collaboration-carets__label', { hasText: 'Bob' }),
    ).toBeVisible();
    await expect(ada.page.getByTestId('presence').getByTitle('Bob')).toBeVisible();

    // The shared note shows up on Bob's dashboard. Titles are a projection the collaboration
    // server writes on its debounced store, so allow for that delay.
    await bob.page.goto('/?view=shared');
    await expect(async () => {
      await bob.page.reload();
      await expect(
        bob.page.getByTestId('note-card-title').filter({ hasText: 'Team plan' }),
      ).toBeVisible({ timeout: 1000 });
    }).toPass({ timeout: 20_000 });
  });

  test('viewers can read but not edit', async ({ browser }) => {
    const ada = await newUser(browser, 'Ada');
    const vic = await newUser(browser, 'Vic');
    const noteId = await createNote(ada, 'Read only');
    await typeInEditor(ada.page, 'Visible to viewers');
    await share(ada, vic, 'Viewer');

    await openNote(vic, noteId);
    await expect(vic.page.getByTestId('readonly-banner')).toBeVisible();
    await expect(vic.page.getByTestId('editor')).toHaveAttribute('contenteditable', 'false');
    await expect(vic.page.getByTestId('note-title')).toHaveAttribute('readonly', '');
    await expect(vic.page.getByRole('toolbar', { name: 'Formatting' })).toHaveCount(0);

    await vic.page.getByTestId('editor').click();
    await vic.page.keyboard.type('should not appear');
    await expect(vic.page.getByTestId('editor')).not.toContainText('should not appear');
    await expect(ada.page.getByTestId('editor')).toHaveText('Visible to viewers');
  });

  test('offline edits are kept locally and merged after reconnecting', async ({ browser }) => {
    const ada = await newUser(browser, 'Ada');
    const bob = await newUser(browser, 'Bob');
    const noteId = await createNote(ada, 'Offline test');
    await typeInEditor(ada.page, 'Base.');
    await share(ada, bob, 'Editor');
    await openNote(bob, noteId);
    await expect(bob.page.getByTestId('editor')).toContainText('Base.');

    await bob.page.context().setOffline(true);
    await expect(bob.page.getByTestId('connection-status')).toHaveAttribute(
      'data-phase',
      'offline',
    );
    await typeInEditor(bob.page, ' Written offline by Bob.');
    await typeInEditor(ada.page, ' Ada kept typing online.');

    await expect(ada.page.getByTestId('editor')).not.toContainText('offline by Bob');
    await expect(bob.page.getByTestId('editor')).not.toContainText('Ada kept typing');

    await bob.page.context().setOffline(false);
    await expect(bob.page.getByTestId('connection-status')).toHaveAttribute('data-phase', 'synced');
    for (const page of [ada.page, bob.page]) {
      await expect(page.getByTestId('editor')).toContainText('Written offline by Bob.');
      await expect(page.getByTestId('editor')).toContainText('Ada kept typing online.');
    }
  });

  test('offline edits survive closing the tab (IndexedDB) and sync on the next visit', async ({
    browser,
  }) => {
    const ada = await newUser(browser, 'Ada');
    const noteId = await createNote(ada, 'Durable offline');
    await typeInEditor(ada.page, 'Online part.');
    await expect(ada.page.getByTestId('connection-status')).toContainText('Saved');

    await ada.page.context().setOffline(true);
    await expect(ada.page.getByTestId('connection-status')).toHaveAttribute(
      'data-phase',
      'offline',
    );
    await typeInEditor(ada.page, ' Offline part.');
    await ada.page.waitForTimeout(300); // let y-indexeddb flush

    // Reload the app while online again: the offline part comes back from IndexedDB and syncs.
    await ada.page.context().setOffline(false);
    const fresh = await ada.page.context().newPage();
    await ada.page.close();
    await fresh.goto(`/notes/${noteId}`);
    await expect(fresh.getByTestId('editor')).toContainText('Online part. Offline part.');

    // Proof that it reached the server: a different user sees it.
    const bob = await newUser(browser, 'Bob');
    const owner = { ...ada, page: fresh };
    await share(owner, bob, 'Viewer');
    await openNote(bob, noteId);
    await expect(bob.page.getByTestId('editor')).toContainText('Online part. Offline part.');
  });

  test('removing a member ends their live session', async ({ browser }) => {
    const ada = await newUser(browser, 'Ada');
    const bob = await newUser(browser, 'Bob');
    const noteId = await createNote(ada, 'Revocation');
    await share(ada, bob, 'Editor');
    await openNote(bob, noteId);

    await ada.page.getByTestId('share-button').click();
    await ada.page.getByRole('button', { name: 'Remove Bob' }).click();

    await expect(bob.page.getByTestId('access-message')).toContainText('Your access was removed');
  });

  test('saving and restoring a version', async ({ browser }) => {
    const ada = await newUser(browser, 'Ada');
    await createNote(ada, 'Versioned');
    await typeInEditor(ada.page, 'First draft.');

    await ada.page.getByTestId('history-button').click();
    await ada.page.getByLabel('Version name').fill('Draft 1');
    await ada.page.getByTestId('save-version').click();
    await expect(ada.page.getByTestId('version-item').filter({ hasText: 'Draft 1' })).toBeVisible();

    await typeInEditor(ada.page, ' Later rewrite.');
    await expect(ada.page.getByTestId('editor')).toContainText('First draft. Later rewrite.');

    await ada.page.getByTestId('version-item').filter({ hasText: 'Draft 1' }).click();
    await expect(ada.page.getByRole('dialog')).toContainText('First draft.');
    await ada.page.getByTestId('restore-version').click();

    await expect(ada.page.getByTestId('editor')).toHaveText('First draft.');
    await expect(
      ada.page.getByTestId('version-item').filter({ hasText: 'Before restoring "Draft 1"' }),
    ).toBeVisible();
  });
});
