import { admin, expect, signIn, test } from './support/fixtures.ts';
import { activeUser, adminApi, newPerson, userId } from './support/admin.ts';

// M5 sprint 3, definition of done: a plain User sees no administration, and gets 403 on every admin path
// and every route the screens call. An anonymous visitor is sent to sign in. An Admin sees the section.

const PAGES = [
  '/admin/users',
  '/admin/users/pending',
  '/admin/users/019a0000-0000-7000-8000-000000000000',
  '/admin/roles',
  '/admin/settings',
  '/admin/settings/branding',
  '/admin/settings/secrets',
  '/admin/settings/vocabularies',
  '/admin/settings/core.identity',
  '/admin/logs',
  '/admin/logs/019a0000-0000-7000-8000-000000000000',
  '/admin/system',
  '/admin/notifications',
];

test.describe('who may open the administration', () => {
  test('a plain User has no administration in the navigation or the page, and is refused every admin path', async ({
    page,
    playwright,
    baseURL,
    at,
  }) => {
    const api = await adminApi(playwright, baseURL, at);
    const who = newPerson('plain');
    await activeUser(api, at, who);
    await api.dispose();
    await page.goto(at('/login'));
    await page.getByLabel('Username').fill(who.username);
    await page.getByLabel('Password', { exact: true }).fill(who.password);
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Account menu' })).toBeVisible();

    // The DOM: no Administration heading, no link to an admin path.
    const nav = page.getByRole('navigation', { name: 'Main navigation' });
    await expect(nav).toBeVisible();
    await expect(nav.getByText('Administration')).toHaveCount(0);
    await expect(page.locator('a[href*="/admin"]')).toHaveCount(0);

    // A direct visit to each admin path: 403 and the error page, never an empty or half-drawn page.
    for (const path of PAGES) {
      const response = await page.goto(at(path));
      expect(response?.status(), path).toBe(403);
      await expect(page.getByText('You are not allowed to open this page.'), path).toBeVisible();
      await expect(
        page.getByRole('heading', { name: /Users|Roles|Settings|Logs|System|Notification status/ }),
      ).toHaveCount(0);
    }
  });

  test('a plain User is refused (403) on every route the administration screens call', async ({
    page,
    playwright,
    baseURL,
    at,
  }) => {
    const api = await adminApi(playwright, baseURL, at);
    const who = newPerson('plainapi');
    const target = await activeUser(api, at, who);
    const other = newPerson('plainother');
    const otherId = await activeUser(api, at, other);
    await api.dispose();
    const csrf = await signIn(page.request, at, who);

    const calls: [string, string, unknown?][] = [
      ['GET', '/users'],
      ['GET', `/users/${otherId}`],
      ['GET', `/users/${otherId}/roles`],
      ['GET', `/users/${otherId}/tokens`],
      ['GET', '/users/pending'],
      ['POST', `/users/${otherId}/deactivate`, {}],
      ['POST', `/users/${otherId}/sessions/revoke`, {}],
      ['POST', '/system/sessions/revoke-all', {}],
      ['POST', `/users/${otherId}/roles`, { role: 'admin' }],
      ['DELETE', `/users/${otherId}/roles/user`],
      ['PUT', '/roles/user/permissions', { permissions: [] }],
      ['GET', '/settings'],
      ['PUT', '/settings/core.identity', { version: 0, values: {} }],
      ['GET', '/secrets'],
      ['PUT', '/secrets/e2e.plain', { value: 'nope' }],
      ['POST', '/vocabularies/stage/terms', { key: 'PLAIN', labels: { en: 'x' } }],
      ['GET', '/permissions'],
      ['GET', '/audit'],
      ['GET', `/audit/${otherId}`],
      ['GET', '/audit/export.csv'],
      ['GET', '/system/outbox'],
      ['GET', '/system/job-runs'],
      ['POST', `/system/outbox/deliveries/${otherId}/requeue`, {}],
      ['GET', '/notifications/status'],
      ['GET', '/notifications/deliveries'],
      ['POST', `/notifications/deliveries/${otherId}/requeue`, {}],
      ['POST', '/notifications/test', {}],
    ];
    for (const [method, path, data] of calls) {
      const response = await page.request.fetch(at(`/api/internal${path}`), {
        method,
        headers: { 'x-csrf-token': csrf },
        data,
      });
      expect(response.status(), `${method} ${path}`).toBe(403);
    }
    // Nothing happened: the other account is still active and still a plain User.
    const verifier = await adminApi(playwright, baseURL, at);
    const list = await verifier.get<{ result: { username: string; status: string }[] }>(
      `/users?q=${other.username}`,
    );
    expect(list.result[0]).toMatchObject({ username: other.username, status: 'active' });
    expect(await userId(verifier, who.username)).toBe(target);
    await verifier.dispose();
  });

  test('an anonymous visitor is sent to sign in and back', async ({ page, at }) => {
    await page.goto(at('/admin/users'));
    await expect(page).toHaveURL(new RegExp(`${at('/login')}\\?returnTo=`));
    await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
    await page.getByLabel('Username').fill(admin.username);
    await page.getByLabel('Password', { exact: true }).fill(admin.password);
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Users', level: 1 })).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`${at('/admin/users')}$`));
  });

  test('an Admin sees the Administration section, with the entries each module contributes', async ({
    page,
    at,
  }) => {
    await page.goto(at('/login'));
    await page.getByLabel('Username').fill(admin.username);
    await page.getByLabel('Password', { exact: true }).fill(admin.password);
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    const nav = page.getByRole('navigation', { name: 'Main navigation' });
    await expect(nav.getByText('Administration')).toBeVisible();
    for (const name of [
      'Users',
      'Pending approvals',
      'Roles',
      'Settings',
      'Logs',
      'Notification status',
      'System',
    ]) {
      await expect(nav.getByRole('link', { name, exact: true })).toBeVisible();
    }
  });
});
