import type { Page } from '@playwright/test';
import { admin, expect, person, signInThroughPage, test } from './support/fixtures.ts';
import {
  activeUser,
  adminApi,
  newPerson,
  permissionsOf,
  registerPending,
  unique,
  userId,
} from './support/admin.ts';

// M5 sprint 3: the administration of users from the browser. An Admin approves and rejects accounts on the
// page the mail links to, changes roles, revokes a token, ends sessions and deactivates an account; the last
// Admin cannot be removed, and the error is shown. Every test makes its own accounts (unique names), so a
// retry never meets what an earlier try left.

async function signInAsAdmin(page: Page, at: (path: string) => string) {
  await signInThroughPage(page, at, admin);
}
const toast = (page: Page) => page.getByRole('region', { name: 'Notifications' });

test.describe('approving accounts', () => {
  test('an Admin approves one account and rejects another on the page the mail links to, and each person is told', async ({
    page,
    playwright,
    baseURL,
    at,
    browser,
  }) => {
    const api = await adminApi(playwright, baseURL, at);
    const yes = newPerson('yes');
    const no = newPerson('no');
    await registerPending(api, at, yes);
    await registerPending(api, at, no);
    await signInAsAdmin(page, at);

    await page.goto(at('/admin/users/pending'));
    await expect(
      page.getByRole('heading', { name: 'Accounts waiting for approval', level: 1 }),
    ).toBeVisible();
    const table = page.getByRole('table', { name: 'Accounts waiting for approval' });
    await expect(table.getByRole('rowheader', { name: yes.username })).toBeVisible();
    await expect(table.getByRole('rowheader', { name: no.username })).toBeVisible();

    await table.getByRole('button', { name: `Approve ${yes.username}` }).click();
    await expect(toast(page).getByText(`${yes.username} was approved.`)).toBeVisible();
    await expect(table.getByRole('rowheader', { name: yes.username })).toHaveCount(0);

    await table.getByRole('button', { name: `Reject ${no.username}` }).click();
    const dialog = page.getByRole('dialog', { name: 'Reject this account?' });
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'Reject' }).click();
    await expect(toast(page).getByText(`${no.username} was rejected.`)).toBeVisible();
    await expect(table.getByRole('rowheader', { name: no.username })).toHaveCount(0);

    // The approved person signs in; the rejected one cannot.
    const context = await browser.newContext({ baseURL });
    const visitor = await context.newPage();
    await signInThroughPage(visitor, at, yes);
    await visitor.getByRole('button', { name: 'Account menu' }).click();
    await visitor.getByRole('button', { name: 'Log out' }).click();
    await visitor.goto(at('/login'));
    await visitor.getByLabel('Username').fill(no.username);
    await visitor.getByLabel('Password', { exact: true }).fill(no.password);
    await visitor.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(visitor.getByRole('alert')).toContainText('The username or password is wrong.');
    await context.close();
    await api.dispose();
  });

  test('an Admin gives the role chosen on the page to the account they approve', async ({
    page,
    playwright,
    baseURL,
    at,
  }) => {
    const api = await adminApi(playwright, baseURL, at);
    const who = newPerson('rev');
    await registerPending(api, at, who);
    await signInAsAdmin(page, at);
    await page.goto(at('/admin/users/pending'));
    await page.getByLabel('Role given on approval').selectOption('reviewer');
    await page.getByRole('button', { name: `Approve ${who.username}` }).click();
    await expect(toast(page).getByText(`${who.username} was approved.`)).toBeVisible();
    const id = await userId(api, who.username);
    const roles = await api.get<{ result: { key: string }[] }>(`/users/${id}/roles`);
    expect(roles.result.map((role) => role.key)).toEqual(['reviewer']);
    await api.dispose();
  });

  test('an account that is no longer waiting says so and the list refreshes', async ({
    page,
    playwright,
    baseURL,
    at,
  }) => {
    const api = await adminApi(playwright, baseURL, at);
    const who = newPerson('late');
    const id = await registerPending(api, at, who);
    await signInAsAdmin(page, at);
    await page.goto(at('/admin/users/pending'));
    // Another administrator approves it first.
    expect((await api.send('POST', `/users/${id}/approve`)).status).toBe(200);
    await page.getByRole('button', { name: `Approve ${who.username}` }).click();
    await expect(page.getByRole('alert')).toContainText('This account is no longer waiting.');
    await expect(page.getByRole('rowheader', { name: who.username })).toHaveCount(0);
    await api.dispose();
  });
});

test.describe('the list of users', () => {
  test('filters by status, searches, sorts and pages, and keeps all of it in the address', async ({
    page,
    playwright,
    baseURL,
    at,
  }) => {
    const api = await adminApi(playwright, baseURL, at);
    const tag = unique('lst');
    const names = ['a', 'b', 'c'].map((letter) => `${tag}${letter}`);
    for (const username of names) await activeUser(api, at, person(username));
    const waiting = `${tag}p`;
    await registerPending(api, at, person(waiting));
    await signInAsAdmin(page, at);

    await page.goto(at('/admin/users'));
    await page.getByLabel('Search by username or address').fill(tag);
    await page.getByRole('button', { name: 'Search' }).click();
    await expect(page).toHaveURL(new RegExp(`q=${tag}`));
    const table = page.getByRole('table', { name: 'Users' });
    await expect(table.getByRole('row')).toHaveCount(5); // the head and four accounts
    await expect(table.getByRole('link')).toHaveText([...names, waiting]);

    await page.getByLabel('Status').selectOption('pending');
    await expect(page).toHaveURL(/status=pending/);
    await expect(table.getByRole('link')).toHaveText([waiting]);
    await page.getByLabel('Status').selectOption('');
    await table.getByRole('button', { name: /Username/ }).click();
    await expect(page).toHaveURL(/dir=desc/);
    await expect(table.getByRole('columnheader', { name: /Username/ })).toHaveAttribute(
      'aria-sort',
      'descending',
    );
    await expect(table.getByRole('link')).toHaveText([waiting, ...[...names].reverse()]);

    // A bookmarked address gives the same list; a bad one gives the default list, not an error.
    await page.goto(at(`/admin/users?q=${tag}&sort=username&dir=desc&pageSize=10`));
    await expect(table.getByRole('link')).toHaveText([waiting, ...[...names].reverse()]);
    await page.goto(at('/admin/users?status=nobody&page=-3&pageSize=7&sort=password'));
    await expect(page.getByRole('heading', { name: 'Users', level: 1 })).toBeVisible();
    await api.dispose();
  });
});

test.describe('one account', () => {
  test('an Admin gives a role and takes it away, with a confirm for the removal', async ({
    page,
    playwright,
    baseURL,
    at,
  }) => {
    const api = await adminApi(playwright, baseURL, at);
    const who = newPerson('role');
    const id = await activeUser(api, at, who);
    await signInAsAdmin(page, at);
    await page.goto(at(`/admin/users/${id}`));
    await expect(page.getByRole('heading', { name: who.username, level: 1 })).toBeVisible();
    const roles = page.getByRole('region', { name: 'Roles' });
    await expect(roles.getByRole('listitem').getByText('User', { exact: true })).toBeVisible();

    await roles.getByLabel('Give a role').selectOption('reviewer');
    await roles.getByRole('button', { name: 'Give the role' }).click();
    await expect(
      toast(page).getByText(`${who.username} now holds the role Reviewer.`),
    ).toBeVisible();
    const held = roles.getByRole('listitem');
    await expect(held.getByText('Reviewer', { exact: true })).toBeVisible();

    await roles.getByRole('button', { name: 'Remove the role Reviewer' }).click();
    const dialog = page.getByRole('dialog', { name: 'Remove this role?' });
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(held.getByText('Reviewer', { exact: true })).toBeVisible();
    await roles.getByRole('button', { name: 'Remove the role Reviewer' }).click();
    await dialog.getByRole('button', { name: 'Remove' }).click();
    await expect(
      toast(page).getByText(`${who.username} no longer holds the role Reviewer.`),
    ).toBeVisible();
    await expect(held.getByText('Reviewer', { exact: true })).toHaveCount(0);
    await api.dispose();
  });

  test('an Admin cannot change their own roles: the screen says why', async ({
    page,
    playwright,
    baseURL,
    at,
  }) => {
    const api = await adminApi(playwright, baseURL, at);
    await signInAsAdmin(page, at);
    const id = await userId(api, admin.username);
    await page.goto(at(`/admin/users/${id}`));
    const roles = page.getByRole('region', { name: 'Roles' });
    await roles.getByRole('button', { name: 'Remove the role Admin' }).click();
    await page
      .getByRole('dialog', { name: 'Remove this role?' })
      .getByRole('button', { name: 'Remove' })
      .click();
    await expect(page.getByRole('alert')).toContainText('You cannot change your own roles');
    await expect(roles.getByText('Admin', { exact: true })).toBeVisible();
    await api.dispose();
  });

  test('the last Admin who can sign in cannot be removed, and the error is shown', async ({
    page,
    playwright,
    baseURL,
    at,
  }) => {
    const api = await adminApi(playwright, baseURL, at);
    // Only someone who is not an Admin themselves can try: nobody removes their own role. A role that may
    // change roles is made of the Reviewer role for the length of the test, and put back afterwards.
    const before = await permissionsOf(api, 'reviewer');
    const manager = newPerson('mgr');
    const managerId = await registerPending(api, at, manager);
    try {
      const elevated = [
        ...new Set([
          ...before,
          'core.identity.user.read',
          'core.identity.role.read',
          'core.identity.role.assign',
          'core.authz.role.read',
          'core.authz.role.assign',
        ]),
      ];
      expect(
        (await api.send('PUT', '/roles/reviewer/permissions', { permissions: elevated })).status,
      ).toBe(200);
      expect(
        (await api.send('POST', `/users/${managerId}/approve`, { role: 'reviewer' })).status,
      ).toBe(200);
      // The role `user` is what lets a person sign in and read their own account.
      expect((await api.send('POST', `/users/${managerId}/roles`, { role: 'user' })).status).toBe(
        200,
      );
      const adminId = await userId(api, admin.username);

      await signInThroughPage(page, at, manager);
      await page.goto(at(`/admin/users/${adminId}`));
      const roles = page.getByRole('region', { name: 'Roles' });
      await roles.getByRole('button', { name: 'Remove the role Admin' }).click();
      await page
        .getByRole('dialog', { name: 'Remove this role?' })
        .getByRole('button', { name: 'Remove' })
        .click();
      await expect(page.getByRole('alert')).toContainText(
        'The last Admin who can sign in cannot be removed.',
      );
      await expect(roles.getByText('Admin', { exact: true })).toBeVisible();
      const still = await api.get<{ result: { key: string }[] }>(`/users/${adminId}/roles`);
      expect(still.result.map((role) => role.key)).toContain('admin');
    } finally {
      expect(
        (await api.send('PUT', '/roles/reviewer/permissions', { permissions: before })).status,
      ).toBe(200);
      await api.dispose();
    }
  });

  test('an Admin revokes an access token of another person by its id, and the token stops working', async ({
    page,
    playwright,
    baseURL,
    at,
  }) => {
    const api = await adminApi(playwright, baseURL, at);
    const who = newPerson('tok');
    const id = await activeUser(api, at, who);
    // The person makes a token (through the API, as their own session).
    const theirs = await playwright.request.newContext({ baseURL });
    const login = await theirs.post(at('/api/internal/auth/login'), { data: who });
    const csrf = ((await login.json()) as { csrfToken: string }).csrfToken;
    const made = await theirs.post(at('/api/internal/tokens'), {
      headers: { 'x-csrf-token': csrf },
      data: { name: 'pipeline', scopes: ['core.identity.me.read'] },
    });
    const token = ((await made.json()) as { token: string }).token;
    const works = () =>
      playwright.request.newContext({ baseURL }).then(async (anonymous) => {
        const response = await anonymous.get(at('/api/internal/auth/me'), {
          headers: { authorization: `Bearer ${token}` },
        });
        await anonymous.dispose();
        return response.status();
      });
    expect(await works()).toBe(200);

    await signInAsAdmin(page, at);
    await page.goto(at(`/admin/users/${id}`));
    const tokens = page.getByRole('region', { name: 'Access tokens' });
    await expect(tokens.getByRole('rowheader', { name: 'pipeline' })).toBeVisible();
    // The page never shows the secret, only a prefix.
    await expect(page.locator('body')).not.toContainText(token);
    await tokens.getByRole('button', { name: 'Revoke the token pipeline' }).click();
    await page
      .getByRole('dialog', { name: 'Revoke this token?' })
      .getByRole('button', { name: 'Revoke' })
      .click();
    await expect(toast(page).getByText('The token pipeline was revoked.')).toBeVisible();
    await expect(tokens.getByText('This account has no open access token.')).toBeVisible();
    expect(await works()).toBe(401);
    await theirs.dispose();
    await api.dispose();
  });

  test('an Admin ends all sessions of an account, and deactivates it: the person is signed out and cannot sign in again', async ({
    page,
    playwright,
    baseURL,
    at,
    browser,
  }) => {
    const api = await adminApi(playwright, baseURL, at);
    const who = newPerson('gone');
    const id = await activeUser(api, at, who);
    const context = await browser.newContext({ baseURL });
    const visitor = await context.newPage();
    await signInThroughPage(visitor, at, who);

    await signInAsAdmin(page, at);
    await page.goto(at(`/admin/users/${id}`));
    // Ending the sessions signs the person out; they can sign in again.
    await page.getByRole('button', { name: 'End all sessions of this account' }).click();
    await page
      .getByRole('dialog', { name: 'End all sessions?' })
      .getByRole('button', { name: 'End all sessions' })
      .click();
    await expect(toast(page).getByText('1 session ended.')).toBeVisible();
    await visitor.reload();
    await expect(visitor.getByRole('button', { name: 'Account menu' })).toHaveCount(0);
    await signInThroughPage(visitor, at, who);

    // Deactivating ends the sessions in the same step and closes the account.
    await page.getByRole('button', { name: 'Deactivate this account' }).click();
    const dialog = page.getByRole('dialog', { name: 'Deactivate this account?' });
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await page.getByRole('button', { name: 'Deactivate this account' }).click();
    await dialog.getByRole('button', { name: 'Deactivate' }).click();
    await expect(toast(page).getByText(`${who.username} was deactivated.`)).toBeVisible();
    await expect(page.getByText('Deactivated', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Deactivate this account' })).toHaveCount(0);
    await visitor.reload();
    await expect(visitor.getByRole('button', { name: 'Account menu' })).toHaveCount(0);
    await visitor.goto(at('/login'));
    await visitor.getByLabel('Username').fill(who.username);
    await visitor.getByLabel('Password', { exact: true }).fill(who.password);
    await visitor.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(visitor.getByRole('alert')).toContainText('The username or password is wrong.');
    await context.close();
    await api.dispose();
  });

  test('an Admin cannot deactivate their own account', async ({
    page,
    playwright,
    baseURL,
    at,
  }) => {
    const api = await adminApi(playwright, baseURL, at);
    await signInAsAdmin(page, at);
    const id = await userId(api, admin.username);
    await page.goto(at(`/admin/users/${id}`));
    await page.getByRole('button', { name: 'Deactivate this account' }).click();
    await page
      .getByRole('dialog', { name: 'Deactivate this account?' })
      .getByRole('button', { name: 'Deactivate' })
      .click();
    await expect(page.getByRole('alert')).toContainText('You cannot deactivate your own account.');
    await api.dispose();
  });

  test('an Admin ends every session of everybody, behind a confirm, and stays signed in', async ({
    page,
    playwright,
    baseURL,
    at,
    browser,
  }) => {
    const api = await adminApi(playwright, baseURL, at);
    const who = newPerson('all');
    await activeUser(api, at, who);
    const context = await browser.newContext({ baseURL });
    const visitor = await context.newPage();
    await signInThroughPage(visitor, at, who);

    await signInAsAdmin(page, at);
    await page.goto(at('/admin/users'));
    await page.getByRole('button', { name: 'End every session of everybody' }).click();
    const dialog = page.getByRole('dialog', { name: 'End every session of everybody?' });
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await visitor.reload();
    await expect(visitor.getByRole('button', { name: 'Account menu' })).toBeVisible(); // cancelled: nothing ended
    await page.getByRole('button', { name: 'End every session of everybody' }).click();
    await dialog.getByRole('button', { name: 'End every session' }).click();
    await expect(toast(page).getByText(/sessions? ended\./)).toBeVisible();
    await visitor.reload();
    await expect(visitor.getByRole('button', { name: 'Account menu' })).toHaveCount(0);
    await page.reload();
    await expect(page.getByRole('button', { name: 'Account menu' })).toBeVisible(); // the Admin who did it is not locked out
    await context.close();
    await api.dispose();
  });
});
