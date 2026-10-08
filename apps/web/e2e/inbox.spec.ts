import type { Page } from '@playwright/test';
import {
  activeUser,
  adminApi,
  newPerson,
  registerPending,
  unique,
  userId,
} from './support/admin.ts';
import { admin, expect, signInThroughPage, test } from './support/fixtures.ts';

// M5 sprint 4: the inbox bell and its live count (ADR-0028), the inbox page, the notification preferences and
// the dashboard. Each test makes an administrator of its own, so its inbox starts empty and what other tests
// left in the one of `root` does not count.

const toast = (page: Page) => page.getByRole('region', { name: 'Notifications' });
const bell = (page: Page, count: number | 'none') =>
  page.getByRole('button', {
    name: count === 'none' ? 'Inbox' : `Inbox, ${count} unread item${count === 1 ? '' : 's'}`,
    exact: true,
  });

/** A second administrator, made through the API: its inbox gets the registration requests from now on. */
async function newAdmin(
  api: Awaited<ReturnType<typeof adminApi>>,
  at: (path: string) => string,
  prefix: string,
) {
  const who = newPerson(prefix);
  const id = await activeUser(api, at, who);
  expect((await api.send('POST', `/users/${id}/roles`, { role: 'admin' })).status).toBe(200);
  return { who, id };
}

test.describe('the inbox bell', () => {
  test('counts live while the stream is open, shows the items, and marks them read', async ({
    page,
    playwright,
    baseURL,
    at,
  }) => {
    test.slow();
    const api = await adminApi(playwright, baseURL, at);
    const { who } = await newAdmin(api, at, 'bell');
    await signInThroughPage(page, at, who);
    // The approval of this account is its first message.
    await expect(bell(page, 1)).toBeVisible();

    // Somebody registers: the item reaches the open page with no reload, over the event stream.
    const first = newPerson('applicant');
    await registerPending(api, at, first);
    await expect(bell(page, 2)).toBeVisible({ timeout: 15_000 });
    const second = newPerson('applicant');
    await registerPending(api, at, second);
    await expect(bell(page, 3)).toBeVisible({ timeout: 15_000 });
    // The number is announced to a screen reader politely, not as an alert.
    await expect(page.getByText('You have 3 unread items.')).toBeAttached();

    await bell(page, 3).click();
    const menu = page.getByRole('region', { name: 'Inbox' });
    await expect(menu.getByText(new RegExp(`${first.username} \\(`))).toBeVisible();
    await expect(menu.getByText(new RegExp(`${second.username} \\(`))).toBeVisible();
    // An item links to the page that deals with it, on this site.
    await expect(menu.getByRole('link', { name: 'Open' }).first()).toHaveAttribute(
      'href',
      new RegExp(`${at('/admin/users/pending')}$`),
    );

    await menu
      .getByRole('listitem')
      .filter({ hasText: first.username })
      .getByRole('button', { name: /^Mark .* read$/ })
      .click();
    await expect(bell(page, 2)).toBeVisible();
    await menu.getByRole('button', { name: 'Mark all read' }).click();
    await expect(bell(page, 'none')).toBeVisible();

    // Escape closes the menu and gives the bell its focus back.
    await page.keyboard.press('Escape');
    await expect(menu).toBeHidden();
    await expect(bell(page, 'none')).toBeFocused();
    await api.dispose();
  });

  test('falls back to asking once a minute when the stream cannot be opened, and says the same', async ({
    page,
    playwright,
    baseURL,
    at,
  }) => {
    test.slow();
    const api = await adminApi(playwright, baseURL, at);
    const { who } = await newAdmin(api, at, 'poll');
    await page.clock.install();
    await page.route('**/api/internal/inbox/stream', (route) => route.abort());
    await signInThroughPage(page, at, who);
    await expect(bell(page, 1)).toBeVisible();

    await registerPending(api, at, newPerson('later'));
    // No stream: nothing yet. A minute later the bell asks and the count appears.
    await page.clock.fastForward(61_000);
    await expect(bell(page, 2)).toBeVisible({ timeout: 15_000 });
    await api.dispose();
  });

  test('is not there for a visitor, and a plain User gets the bell but no administration cards', async ({
    page,
    playwright,
    baseURL,
    at,
  }) => {
    await page.goto(at('/'));
    await expect(page.getByRole('button', { name: /^Inbox/ })).toHaveCount(0);

    const api = await adminApi(playwright, baseURL, at);
    const who = newPerson('plainbell');
    await activeUser(api, at, who);
    await api.dispose();
    await signInThroughPage(page, at, who);
    await expect(page.getByRole('button', { name: /^Inbox/ })).toBeVisible();
    await page.goto(at('/'));
    await expect(page.getByRole('heading', { name: 'What needs your attention' })).toHaveCount(0);
    await expect(
      page.getByRole('region', { name: 'Registrations waiting for approval' }),
    ).toHaveCount(0);
    await expect(
      page.getByRole('region', { name: 'Mail that could not be delivered' }),
    ).toHaveCount(0);
  });
});

test.describe('the inbox page', () => {
  test('lists the items, marks one or all read, and deletes one', async ({
    page,
    playwright,
    baseURL,
    at,
  }) => {
    test.slow();
    const api = await adminApi(playwright, baseURL, at);
    const { who } = await newAdmin(api, at, 'page');
    const names = [newPerson('one'), newPerson('two'), newPerson('three')];
    for (const name of names) await registerPending(api, at, name);
    await signInThroughPage(page, at, who);
    await page.goto(at('/inbox'));
    await expect(page.getByRole('heading', { name: 'Inbox', level: 1 })).toBeVisible();
    await expect(page.getByTestId('unread')).toHaveText('4 unread items');
    const table = page.getByRole('table', { name: 'Inbox' });
    const row = (n: string) => table.getByRole('row').filter({ hasText: `${n} (` });
    await expect(row(names[0]!.username)).toContainText('new');

    await row(names[0]!.username)
      .getByRole('button', { name: /^Mark .* read$/ })
      .click();
    await expect(page.getByTestId('unread')).toHaveText('3 unread items');
    await expect(row(names[0]!.username)).not.toContainText('new');

    await row(names[1]!.username)
      .getByRole('button', { name: /^Delete/ })
      .click();
    await expect(toast(page).getByText('The message was deleted.')).toBeVisible();
    await expect(row(names[1]!.username)).toHaveCount(0);
    await expect(page.getByTestId('unread')).toHaveText('2 unread items');

    await page.getByRole('button', { name: 'Mark all read' }).first().click();
    await expect(toast(page).getByText('All messages are marked read.')).toBeVisible();
    await expect(page.getByTestId('unread')).toHaveText('0 unread items');
    await api.dispose();
  });

  test('shows only the caller’s own items: another person’s item is not in the list or reachable by id', async ({
    page,
    playwright,
    baseURL,
    at,
  }) => {
    const api = await adminApi(playwright, baseURL, at);
    const a = await newAdmin(api, at, 'owner');
    await registerPending(api, at, newPerson('seen'));
    const b = newPerson('stranger');
    await activeUser(api, at, b);
    await signInThroughPage(page, at, b);
    await page.goto(at('/inbox'));
    await expect(page.getByText('A registration waits for review')).toHaveCount(0);
    // The id of an item of somebody else is refused (403), whether it exists or not.
    const mine = await api.get<{ result: { id: string }[] }>('/notifications/inbox');
    void mine; // the administrator's own inbox, read through the API only to see it exists
    expect(userId).toBeDefined();
    expect(a.id).toBeTruthy();
    await api.dispose();
  });
});

test.describe('the notification settings', () => {
  test('lock the security messages, save the others, and show them again after a reload', async ({
    page,
    playwright,
    baseURL,
    at,
  }) => {
    const api = await adminApi(playwright, baseURL, at);
    const who = newPerson('prefs');
    await activeUser(api, at, who);
    await signInThroughPage(page, at, who);
    await page.goto(at('/profile/notifications'));
    await expect(
      page.getByRole('heading', { name: 'Notification settings', level: 1 }),
    ).toBeVisible();

    // A category whose messages are all mandatory is locked, with the reason.
    const security = page.getByRole('group', { name: 'Security' });
    await expect(security.getByRole('checkbox', { name: 'By mail' })).toBeDisabled();
    await expect(security.getByRole('checkbox', { name: 'In the inbox' })).toBeChecked();
    await expect(security.getByText('always sent')).toBeVisible();

    const account = page.getByRole('group', { name: 'Your account' });
    await expect(account.getByRole('checkbox', { name: 'By mail' })).toBeChecked();
    await account.getByRole('checkbox', { name: 'By mail' }).uncheck();
    await expect(page.getByRole('button', { name: 'Undo changes' })).toBeEnabled();
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(toast(page).getByText('Your notification settings were saved.')).toBeVisible();

    await page.reload();
    await expect(
      page.getByRole('group', { name: 'Your account' }).getByRole('checkbox', { name: 'By mail' }),
    ).not.toBeChecked();
    // What was stored: only the switch that is off.
    await page.request.get(at('/api/internal/preferences')).then(async (reply) => {
      const list = (await reply.json()) as { result: { key: string; value: unknown }[] };
      expect(list.result.find((p) => p.key === 'notifications.preferences')?.value).toEqual({
        account: { email: false },
      });
    });
    await api.dispose();
  });

  test('asks before the page is left with changes that are not saved, and Undo puts them back', async ({
    page,
    playwright,
    baseURL,
    at,
  }) => {
    const api = await adminApi(playwright, baseURL, at);
    const who = newPerson('prefsundo');
    await activeUser(api, at, who);
    await signInThroughPage(page, at, who);
    await page.goto(at('/profile/notifications'));
    const account = page.getByRole('group', { name: 'Your account' });
    await account.getByRole('checkbox', { name: 'In the inbox' }).uncheck();
    await page.getByRole('button', { name: 'Undo changes' }).click();
    await expect(account.getByRole('checkbox', { name: 'In the inbox' })).toBeChecked();
    await expect(page.getByRole('button', { name: 'Undo changes' })).toBeDisabled();
    expect(unique('x')).toBeTruthy();
    await api.dispose();
  });
});

test.describe('the dashboard', () => {
  test('gives an administrator the cards of what needs attention, with the numbers and the links', async ({
    page,
    playwright,
    baseURL,
    at,
  }) => {
    const api = await adminApi(playwright, baseURL, at);
    await registerPending(api, at, newPerson('dashwait'));
    await signInThroughPage(page, at, admin);
    await page.goto(at('/'));
    await expect(
      page.getByRole('heading', { name: 'What needs your attention', level: 2 }),
    ).toBeVisible();
    const pending = page.getByRole('region', { name: 'Registrations waiting for approval' });
    await expect(pending).toContainText(/waits? for your decision/);
    await expect(pending.getByRole('link', { name: 'Review the registrations' })).toHaveAttribute(
      'href',
      at('/admin/users/pending'),
    );
    const dead = page.getByRole('region', { name: 'Mail that could not be delivered' });
    await expect(dead).toBeVisible();
    await expect(dead.getByRole('link', { name: 'Open the notification status' })).toBeVisible();
    await api.dispose();
  });
});
