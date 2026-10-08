import { randomUUID } from 'node:crypto';
import type { Locator, Page } from '@playwright/test';
import { makeAuditEvent, makeDelivery } from '@scorpion/testing';
import { violations } from './support/a11y.ts';
import {
  activeUser,
  adminApi,
  newPerson,
  registerPending,
  unique,
  userId,
} from './support/admin.ts';
import { withDb } from './support/db.ts';
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
          // Removing an item asks first (sprint 4); the question is a dialog and is checked as one.
          await page
            .getByRole('button', { name: /^Remove / })
            .last()
            .click();
          await expect(page.getByRole('dialog', { name: 'Remove this item?' })).toBeVisible();
          await clean('the settings of core.identity with the question about removing an item');
          await page.keyboard.press('Escape');
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

    test('has no serious violation on the screens of the logs, the system and the notification status', async ({
      page,
      at,
      basePath,
    }) => {
      test.slow();
      const tag = `/e2e/${unique('axe')}`;
      const subscriber = 'core.audit';
      const failure = `an error for the axe check ${unique('f')}`;
      const eventId = randomUUID();
      const deliveryId = randomUUID();
      const template = `e2e.axe.${unique('t')}`;
      const mail = await withDb(basePath, async (client) => {
        for (let i = 0; i < 55; i += 1) {
          await makeAuditEvent(client, { path: `${tag}/n${i}`, userId: randomUUID() });
        }
        await client.query(
          `insert into kernel_outbox (id, name, emitter, payload) values ($1, 'settings.changed@1', 'core.settings', $2::jsonb)`,
          [
            eventId,
            JSON.stringify({ module: 'core.audit', keys: ['x'], version: 1, actorId: null }),
          ],
        );
        await client.query(
          `insert into kernel_outbox_delivery (id, event_id, subscriber, status, attempts, last_error)
           values ($1, $2, $3, 'dead', 8, $4)`,
          [deliveryId, eventId, subscriber, failure],
        );
        return makeDelivery(client, {
          template,
          status: 'dead',
          attempts: 8,
          lastError: 'smtp-timeout',
        });
      });
      try {
        await walk(page, at, async (clean, heading) => {
          await page.goto(at(`/admin/logs?endpoint=${encodeURIComponent(tag)}`));
          await heading('Logs');
          await clean('/admin/logs');
          await page.getByRole('button', { name: 'Load more' }).click();
          await expect(page.getByRole('status').filter({ hasText: 'Showing' })).toHaveText(
            'Showing 55 of 55',
          );
          await clean('/admin/logs after "Load more"');
          await page.getByLabel('Outcome').selectOption('error');
          await page.getByLabel('From (day, UTC)').fill('2026-10-02');
          await page.getByLabel('To (day, UTC)').fill('2026-10-01');
          await expect(page.getByRole('alert')).toBeVisible();
          await clean('/admin/logs with a message about the days');
          await page.goto(at(`/admin/logs?endpoint=${encodeURIComponent(tag)}`));
          await page.getByRole('table', { name: 'Logs' }).getByRole('link').first().click();
          await heading('Log entry');
          await clean('one log entry');

          await page.goto(at('/admin/system'));
          await heading('System');
          await clean('/admin/system');
          const dead = page.getByRole('table', { name: 'Dead deliveries' });
          await dead
            .getByRole('row')
            .filter({ hasText: failure })
            .getByRole('button', { name: /^Requeue/ })
            .click();
          await expect(page.getByRole('dialog', { name: 'Requeue this delivery?' })).toBeVisible();
          await clean('/admin/system with the dialog');
          await page.keyboard.press('Escape');

          await page.goto(
            at(`/admin/notifications?status=dead&template=${encodeURIComponent(template)}`),
          );
          await heading('Notification status');
          await clean('/admin/notifications');
          await page.getByRole('button', { name: /^Requeue the delivery/ }).click();
          await expect(page.getByRole('dialog', { name: 'Requeue this delivery?' })).toBeVisible();
          await clean('/admin/notifications with the dialog');
          await page.keyboard.press('Escape');
        });
      } finally {
        await withDb(basePath, async (client) => {
          await client.query(`delete from audit_event where path like $1`, [`${tag}/%`]);
          await client.query(`delete from kernel_outbox_delivery where id = $1`, [deliveryId]);
          await client.query(`delete from kernel_outbox where id = $1`, [eventId]);
          await client.query(`delete from notify_delivery where id = $1`, [mail.id]);
        }).catch(() => undefined);
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
  test('filters the logs and opens an entry with the keyboard alone', async ({
    page,
    at,
    basePath,
  }) => {
    const tag = `/e2e/${unique('kbd')}`;
    await withDb(basePath, async (client) => {
      for (let i = 0; i < 3; i += 1) {
        await makeAuditEvent(client, { path: `${tag}/n${i}`, method: 'PUT', userId: randomUUID() });
      }
    });
    try {
      await signInThroughPage(page, at, admin);
      await page.goto(at('/admin/logs'));
      await expect(page.getByRole('heading', { name: 'Logs', level: 1 })).toBeVisible();
      const field = page.getByLabel('Endpoint starts with');
      await tabTo(page, field);
      await page.keyboard.type(tag);
      await page.keyboard.press('Enter');
      await expect(page).toHaveURL(/endpoint=/);
      await expect(page.getByRole('status').filter({ hasText: 'Showing' })).toHaveText(
        'Showing 3 of 3',
      );
      // The first entry is a link in the table: Tab reaches it, Enter opens it.
      const first = page.getByRole('table', { name: 'Logs' }).getByRole('link').first();
      await tabTo(page, first);
      await page.keyboard.press('Enter');
      await expect(page.getByRole('heading', { name: 'Log entry', level: 1 })).toBeVisible();
    } finally {
      await withDb(basePath, (client) =>
        client.query(`delete from audit_event where path like $1`, [`${tag}/%`]),
      ).catch(() => undefined);
    }
  });
});
