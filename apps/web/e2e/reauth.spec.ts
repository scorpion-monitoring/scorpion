import { makeSessionsStale } from './support/db.ts';
import { createUser, expect, person, signInThroughPage, test } from './support/fixtures.ts';

// ASVS 7.5.1 and 7.5.2 in a browser: a change that needs a recent authentication asks for the password
// in a dialog and is made after it; ending a session does the same.

async function staleProfile(
  page: import('@playwright/test').Page,
  at: (path: string) => string,
  basePath: string,
  name: string,
) {
  const who = person(name);
  await createUser(page.request, at, who);
  await signInThroughPage(page, at, who);
  await makeSessionsStale(basePath, who.username);
  await page.goto(at('/profile'));
  await expect(page.getByRole('heading', { name: 'Your profile' })).toBeVisible();
  return who;
}

test.describe('the dialog that confirms the identity', () => {
  test('[ASVS-7.5.1] an email change asks for the password, refuses a wrong one, and succeeds after the right one', async ({
    page,
    at,
    basePath,
  }) => {
    const who = await staleProfile(page, at, basePath, 'sam');
    await page.getByLabel('Email address').fill('sam.new@example.org');
    await page.getByRole('button', { name: 'Save' }).first().click();

    const dialog = page.getByRole('dialog', { name: 'Confirm your identity' });
    await expect(dialog).toBeVisible();
    // Nothing was changed yet.
    await expect(page.getByText('A confirmation was mailed')).toHaveCount(0);

    await dialog.getByLabel('Password').fill('not my password at all');
    await dialog.getByRole('button', { name: 'Confirm' }).click();
    await expect(dialog.getByRole('alert')).toHaveText('That password is not right.');
    await expect(dialog.getByLabel('Password')).toHaveValue('');

    await dialog.getByLabel('Password').fill(who.password);
    await dialog.getByRole('button', { name: 'Confirm' }).click();
    await expect(dialog).toBeHidden();
    // The change that asked for it is made, without the person doing it again.
    await expect(page.getByText('A confirmation was mailed to sam.new@example.org.')).toBeVisible();
  });

  test('closes with Escape or Cancel, and the change is not made', async ({
    page,
    at,
    basePath,
  }) => {
    await staleProfile(page, at, basePath, 'tess');
    await page.getByLabel('Email address').fill('tess.new@example.org');
    await page.getByRole('button', { name: 'Save' }).first().click();
    const dialog = page.getByRole('dialog', { name: 'Confirm your identity' });
    await expect(dialog).toBeVisible();
    // Focus is inside the dialog (the browser traps it).
    await expect(dialog.getByLabel('Password')).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(page.getByText('A confirmation was mailed')).toHaveCount(0);
    await expect(page.getByLabel('Email address')).toHaveValue('tess.new@example.org');

    await page.getByRole('button', { name: 'Save' }).first().click();
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByText('A confirmation was mailed')).toHaveCount(0);
  });

  test('[ASVS-7.5.2] ending a session asks for the password too', async ({
    page,
    at,
    basePath,
    browser,
    baseURL,
  }) => {
    const who = await staleProfile(page, at, basePath, 'uma');
    // A second session to end.
    const other = await browser.newContext({ baseURL });
    try {
      await signInThroughPage(await other.newPage(), at, who);
      await makeSessionsStale(basePath, who.username);
      await page.reload();

      const sessions = page.getByRole('region', { name: 'Sessions' });
      await expect(sessions.getByRole('row')).toHaveCount(3);
      await sessions
        .getByRole('row')
        .filter({ hasNotText: 'This session' })
        .getByRole('button', { name: 'End' })
        .click();
      const dialog = page.getByRole('dialog', { name: 'Confirm your identity' });
      await expect(dialog).toBeVisible();
      await expect(sessions.getByRole('row')).toHaveCount(3);
      await dialog.getByLabel('Password').fill(who.password);
      await dialog.getByRole('button', { name: 'Confirm' }).click();
      await expect(dialog).toBeHidden();
      await expect(sessions.getByRole('row')).toHaveCount(2);
    } finally {
      await other.close();
    }
  });

  test('is in German for a person who chose it', async ({ page, at, basePath }) => {
    const who = await staleProfile(page, at, basePath, 'val');
    await page.getByLabel('Language').selectOption('de');
    await page.getByRole('button', { name: 'Save' }).last().click();
    await expect(page.getByRole('heading', { name: 'Ihr Profil' })).toBeVisible();
    await makeSessionsStale(basePath, who.username);
    await page.getByLabel('E-Mail-Adresse').fill('val.new@example.org');
    await page.getByRole('button', { name: 'Speichern' }).first().click();
    await expect(page.getByRole('dialog', { name: 'Identität bestätigen' })).toBeVisible();
  });
});
