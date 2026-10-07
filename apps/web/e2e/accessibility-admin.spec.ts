import type { Locator, Page } from '@playwright/test';
import { violations } from './support/a11y.ts';
import {
  activeUser,
  adminApi,
  newPerson,
  registerPending,
  unique,
  userId,
} from './support/admin.ts';
import { admin, expect, signInThroughPage, test } from './support/fixtures.ts';

// M5 sprint 3: no serious or critical axe violation on any administration screen, in both themes, with the
// dialog open where there is one; and the two paths the plan names are done with the keyboard alone: the
// approval of an account and the saving of a settings form.

test.use({ reducedMotion: 'reduce' });

/** Presses Tab from the top of the page until `target` has focus; fails when it is not reached in `max` presses. */
async function tabTo(page: Page, target: Locator, max = 80): Promise<number> {
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.locator('body').click({ position: { x: 1, y: 1 } });
  for (let presses = 1; presses <= max; presses += 1) {
    await page.keyboard.press('Tab');
    if (await target.evaluate((node) => node === document.activeElement)) return presses;
  }
  throw new Error(`the control was not reached with ${max} presses of Tab`);
}

for (const scheme of ['light', 'dark'] as const) {
  test.describe(`the administration, ${scheme} theme`, () => {
    /** The screens of one area, each checked as it opens and again with its dialog or message showing. */
    async function walk(
      page: Page,
      at: (path: string) => string,
      screens: (
        clean: (what: string) => Promise<void>,
        heading: (name: string | RegExp) => Promise<void>,
      ) => Promise<void>,
    ) {
      await page.emulateMedia({ colorScheme: scheme, reducedMotion: 'reduce' });
      await signInThroughPage(page, at, admin);
      const heading = async (name: string | RegExp) =>
        expect(page.getByRole('heading', { name, level: 1 })).toBeVisible();
      const clean = async (what: string) => expect(await violations(page), what).toEqual([]);
      await screens(clean, heading);
    }

    test('has no serious violation on the screens of users', async ({
      page,
      playwright,
      baseURL,
      at,
    }) => {
      test.slow();
      const api = await adminApi(playwright, baseURL, at);
      const waiting = newPerson(`wait${scheme}`);
      await registerPending(api, at, waiting);
      const member = newPerson(`memb${scheme}`);
      await activeUser(api, at, member);
      const memberId = await userId(api, member.username);
      try {
        await walk(page, at, async (clean, heading) => {
          await page.goto(at('/admin/users'));
          await heading('Users');
          await clean('/admin/users');
          await page.getByRole('button', { name: 'End every session of everybody' }).click();
          await expect(page.getByRole('dialog')).toBeVisible();
          await clean('/admin/users with the confirm dialog');
          await page.keyboard.press('Escape');

          await page.goto(at('/admin/users/pending'));
          await heading('Accounts waiting for approval');
          await clean('/admin/users/pending');
          await page.getByRole('button', { name: `Reject ${waiting.username}` }).click();
          await expect(page.getByRole('dialog')).toBeVisible();
          await clean('/admin/users/pending with the dialog');
          await page.keyboard.press('Escape');

          await page.goto(at(`/admin/users/${memberId}`));
          await heading(member.username);
          await clean('one account');
          await page.getByRole('button', { name: 'Deactivate this account' }).click();
          await expect(page.getByRole('dialog')).toBeVisible();
          await clean('one account with the dialog');
          await page.keyboard.press('Escape');

          await page.goto(at('/admin/roles'));
          await heading('Roles');
          await clean('/admin/roles, Admin');
          await page.getByRole('tab', { name: 'Reviewer' }).click();
          await clean('/admin/roles, Reviewer');
          await page.getByRole('checkbox', { name: 'core.audit.read' }).check();
          await clean('/admin/roles, edited');
        });
      } finally {
        await api.dispose();
      }
    });

    test('has no serious violation on the screens of settings', async ({
      page,
      playwright,
      baseURL,
      at,
    }) => {
      test.slow();
      const api = await adminApi(playwright, baseURL, at);
      const secret = `e2e.${unique('a11y')}`;
      await api.send('PUT', `/secrets/${secret}`, { value: 'a value that is not shown' });
      try {
        await walk(page, at, async (clean, heading) => {
          await page.goto(at('/admin/settings'));
          await heading('Settings');
          await clean('/admin/settings');
          await page.goto(at('/admin/settings/core.identity'));
          await heading('Accounts and sign-in');
          await clean('the settings of core.identity');
          await page.getByRole('button', { name: 'Add' }).last().click();
          await clean('the settings of core.identity with a provider item');
          await page.goto(at('/admin/settings/core.audit'));
          await page.getByLabel('Keep audit entries for (days)').fill('0');
          await page.getByRole('button', { name: 'Save' }).click();
          await expect(page.getByRole('alert')).toBeVisible();
          await clean('a settings form with a message from the server');
          await page.goto(at('/admin/settings/branding'));
          await heading('Branding');
          await clean('/admin/settings/branding');
          await page.goto(at('/admin/settings/secrets'));
          await heading('Secrets');
          await clean('/admin/settings/secrets');
          await page.getByRole('button', { name: `Delete the secret ${secret}` }).click();
          await expect(page.getByRole('dialog')).toBeVisible();
          await clean('/admin/settings/secrets with the dialog');
          await page.keyboard.press('Escape');
          await page.goto(at('/admin/settings/vocabularies'));
          await heading('Vocabularies');
          await page.getByLabel('Vocabulary').selectOption('stage');
          await expect(page.getByRole('button', { name: 'Edit the term DEV' })).toBeVisible();
          await clean('/admin/settings/vocabularies');
          await page.getByRole('button', { name: 'Edit the term DEV' }).click();
          await expect(page.getByRole('dialog')).toBeVisible();
          await clean('/admin/settings/vocabularies with the edit dialog');
        });
      } finally {
        await api.send('DELETE', `/secrets/${secret}`);
        await api.dispose();
      }
    });
  });
}

test.describe('the keyboard', () => {
  test('approves an account with Tab, Enter and Escape alone, from the list to the toast', async ({
    page,
    playwright,
    baseURL,
    at,
  }) => {
    const api = await adminApi(playwright, baseURL, at);
    const who = newPerson('kbd');
    await registerPending(api, at, who);
    await signInThroughPage(page, at, admin);
    await page.goto(at('/admin/users/pending'));
    await expect(page.getByRole('rowheader', { name: who.username })).toBeVisible();

    // Rejecting asks first; Escape says no and focus goes back to the button.
    const reject = page.getByRole('button', { name: `Reject ${who.username}` });
    await tabTo(page, reject);
    await page.keyboard.press('Enter');
    await expect(page.getByRole('dialog', { name: 'Reject this account?' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(reject).toBeFocused();
    await expect(page.getByRole('rowheader', { name: who.username })).toBeVisible();

    // Shift+Tab goes back to Approve, which needs no confirm.
    await page.keyboard.press('Shift+Tab');
    await expect(page.getByRole('button', { name: `Approve ${who.username}` })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(
      page
        .getByRole('region', { name: 'Notifications' })
        .getByText(`${who.username} was approved.`),
    ).toBeVisible();
    await expect(page.getByRole('rowheader', { name: who.username })).toHaveCount(0);
    await api.dispose();
  });

  test('changes a setting with the keyboard alone: Tab to the field, type, Enter, and the toast', async ({
    page,
    playwright,
    baseURL,
    at,
  }) => {
    const api = await adminApi(playwright, baseURL, at);
    const before = await api.get<{ version: number; values: { csvMaxRows: number } }>(
      '/settings/core.audit',
    );
    try {
      await signInThroughPage(page, at, admin);
      await page.goto(at('/admin/settings/core.audit'));
      const field = page.getByLabel('Largest CSV export (rows)');
      await tabTo(page, field);
      await page.keyboard.press('End');
      await page.keyboard.press('Shift+Home');
      await page.keyboard.type('40000');
      await page.keyboard.press('Enter');
      await expect(
        page.getByRole('region', { name: 'Notifications' }).getByText('The settings were saved.'),
      ).toBeVisible();
      const after = await api.get<{ values: { csvMaxRows: number } }>('/settings/core.audit');
      expect(after.values.csvMaxRows).toBe(40000);
    } finally {
      const now = await api.get<{ version: number }>('/settings/core.audit');
      await api.send('PUT', '/settings/core.audit', {
        version: now.version,
        values: before.values,
      });
      await api.dispose();
    }
  });
});
