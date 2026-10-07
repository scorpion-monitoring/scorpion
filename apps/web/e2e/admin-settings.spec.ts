import type { Page } from '@playwright/test';
import { admin, expect, signInThroughPage, test } from './support/fixtures.ts';
import { activeUser, adminApi, newPerson, permissionsOf, unique } from './support/admin.ts';

// M5 sprint 3: roles and settings from the browser. An Admin edits the permissions of a role and a setting, the
// branding with a logo, a secret (never shown) and the terms of a vocabulary. What each test changes it puts
// back, so the stack the next test meets is the one the last one had.

const toast = (page: Page) => page.getByRole('region', { name: 'Notifications' });
const signInAsAdmin = (page: Page, at: (path: string) => string) =>
  signInThroughPage(page, at, admin);

/** A real 1 x 1 PNG: the server decodes and re-encodes what it is given. */
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);

test.describe('roles', () => {
  test('an Admin edits the permissions of a role, and it takes effect at once for the people who hold it', async ({
    page,
    playwright,
    baseURL,
    at,
    browser,
  }) => {
    const api = await adminApi(playwright, baseURL, at);
    const before = await permissionsOf(api, 'reviewer');
    const who = newPerson('revw');
    const id = await activeUser(api, at, who);
    expect((await api.send('POST', `/users/${id}/roles`, { role: 'reviewer' })).status).toBe(200);
    const context = await browser.newContext({ baseURL });
    const reviewer = await context.newPage();
    try {
      await signInThroughPage(reviewer, at, who);
      expect((await reviewer.goto(at('/admin/users/pending')))?.status()).toBe(403);

      await signInAsAdmin(page, at);
      await page.goto(at('/admin/roles'));
      await expect(page.getByRole('heading', { name: 'Roles', level: 1 })).toBeVisible();
      // Admin holds everything and cannot be edited.
      await page.getByRole('tab', { name: 'Admin' }).click();
      await expect(
        page.getByText('Admin holds every permission of every module and cannot be edited.'),
      ).toBeVisible();
      await expect(
        page.getByRole('checkbox', { name: 'core.identity.user.approve' }),
      ).toBeDisabled();

      await page.getByRole('tab', { name: 'Reviewer' }).click();
      const pending = page.getByRole('checkbox', { name: 'core.identity.user.list-pending' });
      await expect(pending).not.toBeChecked();
      await pending.check();
      await expect(page.getByRole('tab', { name: 'Reviewer (edited)' })).toBeVisible();
      await page.getByRole('button', { name: 'Save the permissions' }).click();
      await expect(toast(page).getByText('The permissions of Reviewer were saved.')).toBeVisible();
      await expect(page.getByRole('tab', { name: 'Reviewer', exact: true })).toBeVisible();

      // The reviewer can open the page now, and sees only what the permission gives.
      expect((await reviewer.goto(at('/admin/users/pending')))?.status()).toBe(200);
      await expect(
        reviewer.getByRole('heading', { name: 'Accounts waiting for approval', level: 1 }),
      ).toBeVisible();
      const nav = reviewer.getByRole('navigation', { name: 'Main navigation' });
      await expect(nav.getByRole('link', { name: 'Pending approvals' })).toBeVisible();
      await expect(nav.getByRole('link', { name: 'Roles' })).toHaveCount(0);

      // Taking it away works the same way.
      await pending.uncheck();
      await page.getByRole('button', { name: 'Save the permissions' }).click();
      await expect(toast(page).getByText('The permissions of Reviewer were saved.')).toBeVisible();
      expect((await reviewer.goto(at('/admin/users/pending')))?.status()).toBe(403);
    } finally {
      await api.send('PUT', '/roles/reviewer/permissions', { permissions: before });
      await context.close();
      await api.dispose();
    }
  });

  test('the page asks before it is left with edits that were not saved, and "all of a module" selects the group', async ({
    page,
    at,
  }) => {
    await signInAsAdmin(page, at);
    await page.goto(at('/admin/roles'));
    await page.getByRole('tab', { name: 'Reviewer' }).click();
    const group = page.getByRole('group', { name: 'core.audit' });
    await group.getByRole('button', { name: 'Select all of core.audit' }).click();
    await expect(page.getByRole('tab', { name: 'Reviewer (edited)' })).toBeVisible();
    await expect(group.getByRole('checkbox', { name: 'core.audit.read' })).toBeChecked();
    await group.getByRole('button', { name: 'Select none of core.audit' }).click();
    await page.getByRole('button', { name: 'Discard the changes' }).click();
    await page.getByRole('checkbox', { name: 'core.audit.read' }).check();

    // A link inside the application asks; "Cancel" keeps the page and the edit.
    let asked = '';
    page.once('dialog', async (dialog) => {
      asked = dialog.message();
      await dialog.dismiss();
    });
    await page
      .getByRole('navigation', { name: 'Main navigation' })
      .getByRole('link', { name: 'Users' })
      .click();
    await expect.poll(() => asked).toContain('unsaved changes');
    await expect(page.getByRole('heading', { name: 'Roles', level: 1 })).toBeVisible();
    await expect(page.getByRole('checkbox', { name: 'core.audit.read' })).toBeChecked();
    // Accepting leaves.
    page.once('dialog', (dialog) => void dialog.accept());
    await page
      .getByRole('navigation', { name: 'Main navigation' })
      .getByRole('link', { name: 'Users' })
      .click();
    await expect(page.getByRole('heading', { name: 'Users', level: 1 })).toBeVisible();
  });
});

test.describe('settings', () => {
  test('an Admin edits a setting from the browser with the keyboard alone, and it is saved with a new version', async ({
    page,
    playwright,
    baseURL,
    at,
  }) => {
    const api = await adminApi(playwright, baseURL, at);
    const before = await api.get<{ version: number; values: { retentionDays: number } }>(
      '/settings/core.audit',
    );
    try {
      await signInAsAdmin(page, at);
      await page.goto(at('/admin/settings'));
      await page.getByRole('link', { name: 'Audit trail' }).click();
      await expect(page.getByRole('heading', { name: 'Audit trail', level: 1 })).toBeVisible();
      const field = page.getByLabel('Keep audit entries for (days)');
      await expect(field).toHaveValue(String(before.values.retentionDays));

      await field.focus();
      await page.keyboard.press('End');
      await page.keyboard.press('Shift+Home');
      await page.keyboard.type('400');
      await page.keyboard.press('Enter');
      await expect(toast(page).getByText('The settings were saved.')).toBeVisible();
      const after = await api.get<{ version: number; values: { retentionDays: number } }>(
        '/settings/core.audit',
      );
      expect(after.values.retentionDays).toBe(400);
      expect(after.version).toBe(before.version + 1);
      await page.reload();
      await expect(page.getByLabel('Keep audit entries for (days)')).toHaveValue('400');
    } finally {
      await api.send('PUT', '/settings/core.audit', {
        version: (await api.get<{ version: number }>('/settings/core.audit')).version,
        values: before.values,
      });
      await api.dispose();
    }
  });

  test('a value the server refuses is shown on its field and in the list, and nothing is saved', async ({
    page,
    playwright,
    baseURL,
    at,
  }) => {
    const api = await adminApi(playwright, baseURL, at);
    const before = await api.get<{ version: number }>('/settings/core.audit');
    await signInAsAdmin(page, at);
    await page.goto(at('/admin/settings/core.audit'));
    const field = page.getByLabel('Keep audit entries for (days)');
    await field.fill('0');
    await page.getByRole('button', { name: 'Save' }).click();
    const summary = page.getByRole('alert');
    await expect(summary).toBeFocused();
    await expect(summary).toContainText('Keep audit entries for (days)');
    await expect(field).toHaveAttribute('aria-invalid', 'true');
    expect((await api.get<{ version: number }>('/settings/core.audit')).version).toBe(
      before.version,
    );
    await api.dispose();
  });

  test('somebody else saved first: the form says so, saves nothing, and loads the current values on request', async ({
    page,
    playwright,
    baseURL,
    at,
  }) => {
    const api = await adminApi(playwright, baseURL, at);
    const before = await api.get<{ version: number; values: Record<string, unknown> }>(
      '/settings/core.audit',
    );
    try {
      await signInAsAdmin(page, at);
      await page.goto(at('/admin/settings/core.audit'));
      await page.getByLabel('Keep audit entries for (days)').fill('500');
      // The other administrator saves in between.
      const other = await api.send('PUT', '/settings/core.audit', {
        version: before.version,
        values: { ...before.values, retentionDays: 450 },
      });
      expect(other.status).toBe(200);
      await page.getByRole('button', { name: 'Save' }).click();
      await expect(
        page.getByText('Somebody else changed this while you were editing.'),
      ).toBeVisible();
      expect(
        (await api.get<{ values: { retentionDays: number } }>('/settings/core.audit')).values
          .retentionDays,
      ).toBe(450);
      await page.getByRole('button', { name: 'Load the current values' }).click();
      await expect(page.getByLabel('Keep audit entries for (days)')).toHaveValue('450');
      await expect(
        page.getByText('Somebody else changed this while you were editing.'),
      ).toBeHidden();
    } finally {
      const now = await api.get<{ version: number }>('/settings/core.audit');
      await api.send('PUT', '/settings/core.audit', {
        version: now.version,
        values: before.values,
      });
      await api.dispose();
    }
  });

  test('the settings of core.settings leave the branding to its own screen and keep it when saved', async ({
    page,
    playwright,
    baseURL,
    at,
  }) => {
    const api = await adminApi(playwright, baseURL, at);
    const before = await api.get<{ values: { branding: unknown } }>('/settings/core.settings');
    await signInAsAdmin(page, at);
    await page.goto(at('/admin/settings/core.settings'));
    await expect(page.getByRole('group', { name: 'Rate limits' })).toBeVisible();
    await expect(page.getByLabel('Instance name')).toHaveCount(0);
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(toast(page).getByText('The settings were saved.')).toBeVisible();
    const after = await api.get<{ values: { branding: unknown } }>('/settings/core.settings');
    expect(after.values.branding).toEqual(before.values.branding);
    await api.dispose();
  });
});

test.describe('branding', () => {
  test('an Admin uploads a logo and the header shows it; removing it takes it away again', async ({
    page,
    playwright,
    baseURL,
    at,
  }) => {
    const api = await adminApi(playwright, baseURL, at);
    const before = await api.get<{ values: { branding: { logos?: unknown } } }>(
      '/settings/core.settings',
    );
    try {
      await signInAsAdmin(page, at);
      await page.goto(at('/admin/settings/branding'));
      await expect(page.getByRole('heading', { name: 'Branding', level: 1 })).toBeVisible();
      await expect(page.locator('header img.logo-light')).toHaveCount(0);

      const logos = page.getByRole('group', { name: 'Logos' });
      await logos
        .getByLabel('Logo for the light theme')
        .setInputFiles({ name: 'logo.png', mimeType: 'image/png', buffer: PNG });
      await expect(
        logos.getByRole('img', { name: 'The current Logo for the light theme' }),
      ).toBeVisible();
      await page.getByRole('button', { name: 'Save' }).click();
      await expect(toast(page).getByText('The settings were saved.')).toBeVisible();
      await expect(page.locator('header img.logo-light')).toHaveAttribute(
        'src',
        /\/api\/internal\/files\/[0-9a-f]{64}$/,
      );

      await logos.getByRole('button', { name: 'Remove the file' }).click();
      await page.getByRole('button', { name: 'Save' }).click();
      await expect(toast(page).getByText('The settings were saved.').last()).toBeVisible();
      await expect(page.locator('header img.logo-light')).toHaveCount(0);
    } finally {
      const now = await api.get<{ version: number; values: Record<string, unknown> }>(
        '/settings/core.settings',
      );
      await api.send('PUT', '/settings/core.settings', {
        version: now.version,
        values: { ...now.values, branding: before.values.branding },
      });
      await api.dispose();
    }
  });

  test('a file the server refuses is reported on the control, not saved', async ({ page, at }) => {
    await signInAsAdmin(page, at);
    await page.goto(at('/admin/settings/branding'));
    const logos = page.getByRole('group', { name: 'Logos' });
    await logos.getByLabel('Logo for the light theme').setInputFiles({
      name: 'logo.png',
      mimeType: 'image/png',
      buffer: Buffer.from('this is not an image'),
    });
    await expect(logos.getByRole('alert')).toBeVisible();
    await expect(logos.getByRole('img')).toHaveCount(0);
  });
});

test.describe('secrets', () => {
  test('an Admin stores, replaces and deletes a secret, and its value is never shown', async ({
    page,
    playwright,
    baseURL,
    at,
  }) => {
    const api = await adminApi(playwright, baseURL, at);
    const name = `e2e.${unique('sec')}`;
    const value = `value-${unique('v')}-never-shown`;
    try {
      await signInAsAdmin(page, at);
      await page.goto(at('/admin/settings/secrets'));
      await page.getByLabel('Name', { exact: false }).first().fill(name);
      await page.getByLabel('Value', { exact: false }).fill(value);
      await page.getByRole('button', { name: 'Store the secret' }).click();
      await expect(toast(page).getByText(`The secret ${name} was stored.`)).toBeVisible();

      const table = page.getByRole('table', { name: 'Secrets' });
      await expect(table.getByRole('rowheader', { name })).toBeVisible();
      await expect(
        table.getByRole('row').filter({ hasText: name }).getByRole('cell').first(),
      ).toHaveText('Set');
      // The value is nowhere in the page, and the box that held it is empty.
      await expect(page.locator('body')).not.toContainText(value);
      expect(await page.content()).not.toContain(value);
      await expect(page.getByLabel('Value', { exact: false })).toHaveValue('');
      // Nor does the API hand it back.
      const listed = await api.get<{ result: Record<string, unknown>[] }>('/secrets?pageSize=100');
      expect(JSON.stringify(listed)).not.toContain(value);
      expect(listed.result.find((entry) => entry.name === name)).toMatchObject({ set: true });

      // Replace: the name is filled in, a new value is stored.
      await table.getByRole('button', { name: `Replace the secret ${name}` }).click();
      await expect(page.getByLabel('Name', { exact: false }).first()).toHaveValue(name);
      await page.getByLabel('Value', { exact: false }).fill(`${value}-2`);
      await page.getByRole('button', { name: 'Store the secret' }).click();
      await expect(toast(page).getByText(`The secret ${name} was stored.`).last()).toBeVisible();

      await table.getByRole('button', { name: `Delete the secret ${name}` }).click();
      const dialog = page.getByRole('dialog', { name: 'Delete this secret?' });
      await dialog.getByRole('button', { name: 'Cancel' }).click();
      await expect(table.getByRole('rowheader', { name })).toBeVisible();
      await table.getByRole('button', { name: `Delete the secret ${name}` }).click();
      await dialog.getByRole('button', { name: 'Delete' }).click();
      await expect(toast(page).getByText(`The secret ${name} was deleted.`)).toBeVisible();
      await expect(table.getByRole('rowheader', { name })).toHaveCount(0);
    } finally {
      await api.send('DELETE', `/secrets/${name}`);
      await api.dispose();
    }
  });

  test('a name the server refuses is shown on its field, and the value is not kept in the box', async ({
    page,
    at,
  }) => {
    await signInAsAdmin(page, at);
    await page.goto(at('/admin/settings/secrets'));
    await page.getByLabel('Name', { exact: false }).first().fill('Not A Valid Name');
    await page.getByLabel('Value', { exact: false }).fill('a value');
    await page.getByRole('button', { name: 'Store the secret' }).click();
    await expect(page.getByLabel('Name', { exact: false }).first()).toHaveAttribute(
      'aria-invalid',
      'true',
    );
    await expect(page.getByLabel('Value', { exact: false })).toHaveValue('');
  });
});

test.describe('vocabularies', () => {
  test('an Admin adds a term, relabels it, deactivates it and removes it; a declared term is only deactivated', async ({
    page,
    playwright,
    baseURL,
    at,
  }) => {
    const api = await adminApi(playwright, baseURL, at);
    const key = `E2E${unique('t')}`;
    try {
      await signInAsAdmin(page, at);
      await page.goto(at('/admin/settings/vocabularies'));
      await page.getByLabel('Vocabulary').selectOption('stage');
      const table = page.getByRole('table', { name: 'Terms of stage' });
      await expect(table.getByRole('rowheader', { name: /^PROD/ })).toBeVisible();
      await expect(
        table.getByRole('rowheader', { name: /PROD/ }).getByText('declared by a module'),
      ).toBeVisible();

      const form = page.getByRole('region', { name: 'Add a term' });
      await form.getByLabel('Key').fill(key);
      await form.getByLabel('Label (en)').fill('End to end');
      await form.getByLabel('Label (de)').fill('Ende zu Ende');
      await form.getByLabel('Position').fill('900');
      await form.getByRole('button', { name: 'Add the term' }).click();
      await expect(toast(page).getByText(`The term ${key} was added.`)).toBeVisible();
      const row = table.getByRole('row').filter({ hasText: key });
      await expect(row).toContainText('End to end');
      await expect(row).toContainText('Ende zu Ende');

      // The same key again is refused, with a message that says why.
      await form.getByLabel('Key').fill(key);
      await form.getByLabel('Label (en)').fill('Again');
      await form.getByRole('button', { name: 'Add the term' }).click();
      await expect(page.getByRole('alert')).toContainText('A term with this key exists already');

      await row.getByRole('button', { name: `Edit the term ${key}` }).click();
      const dialog = page.getByRole('dialog', { name: `Edit ${key}` });
      await dialog.getByLabel('Label (en)').fill('End to end test');
      await dialog.getByRole('button', { name: 'Save' }).click();
      await expect(toast(page).getByText(`The term ${key} was saved.`)).toBeVisible();
      await expect(row).toContainText('End to end test');

      await row.getByRole('button', { name: `Deactivate the term ${key}` }).click();
      await expect(row).toContainText('Inactive');
      await row.getByRole('button', { name: `Activate the term ${key}` }).click();
      await expect(row).toContainText('Active');

      await row.getByRole('button', { name: `Remove the term ${key}` }).click();
      await page
        .getByRole('dialog', { name: 'Remove this term?' })
        .getByRole('button', { name: 'Remove' })
        .click();
      await expect(table.getByRole('row').filter({ hasText: key })).toHaveCount(0);

      // A term a module declared is kept: removing it deactivates it.
      const demo = table.getByRole('row').filter({ hasText: 'DEMO' });
      await demo.getByRole('button', { name: 'Remove the term DEMO' }).click();
      await page
        .getByRole('dialog', { name: 'Remove this term?' })
        .getByRole('button', { name: 'Remove' })
        .click();
      await expect(
        toast(page).getByText(
          'The term DEMO is kept, as it is declared or in use, and is inactive now.',
        ),
      ).toBeVisible();
      await expect(demo).toContainText('Inactive');
    } finally {
      await api.send('PATCH', '/vocabularies/stage/terms/DEMO', { active: true });
      await api.send('DELETE', `/vocabularies/stage/terms/${key}`);
      await api.dispose();
    }
  });
});
