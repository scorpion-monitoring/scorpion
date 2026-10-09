import { randomUUID } from 'node:crypto';
import type { Page } from '@playwright/test';
import { makeAuditEvent, makeDelivery } from '@scorpion/testing';
import { adminApi, unique, userId } from './support/admin.ts';
import { withDb } from './support/db.ts';
import { admin, expect, signInThroughPage, test } from './support/fixtures.ts';

// M5 sprint 4, the operations screens from the browser: an Admin changes a setting and finds the entry in
// the logs with the right actor; pages the logs and downloads them; looks at the system page and the
// notification status, and repairs a dead delivery from each. Every test makes rows with a name of its own
// (a random tag), so a retry and the tests of the other project never meet each other's.

const toast = (page: Page) => page.getByRole('region', { name: 'Notifications' });
const signInAsAdmin = (page: Page, at: (path: string) => string) =>
  signInThroughPage(page, at, admin);

test.describe('an Admin changes a setting', () => {
  test('the logs show the change with the right actor, and the form stored only what differs from the defaults', async ({
    page,
    playwright,
    baseURL,
    at,
    basePath,
  }) => {
    test.slow();
    const api = await adminApi(playwright, baseURL, at);
    const adminId = await userId(api, admin.username);
    const before = await api.get<{ version: number; values: Record<string, unknown> }>(
      '/settings/core.audit',
    );
    try {
      // Start from "all defaults", as an instance that was never saved.
      expect(
        (await api.send('PUT', '/settings/core.audit', { version: before.version, values: {} }))
          .status,
      ).toBe(200);
      await signInAsAdmin(page, at);
      await page.goto(at('/admin/settings/core.audit'));
      await expect(page.getByLabel('Keep audit entries for (days)')).toBeVisible();
      const days = page.getByLabel('Keep audit entries for (days)');
      await days.fill('401');
      await page.getByRole('button', { name: 'Save' }).click();
      await expect(toast(page).getByText('The settings were saved.')).toBeVisible();

      // Only the value that differs was stored: a later change of a default still reaches this instance.
      const stored = await withDb(
        basePath,
        async (client) =>
          (
            await client.query<{ value: Record<string, unknown> }>(
              `select value from settings_setting where module_id = 'core.audit'`,
            )
          ).rows[0]!.value,
      );
      expect(stored).toEqual({ retentionDays: 401 });

      // The request is in the logs, as this Admin, with the body as it was sent.
      await page.goto(
        at('/admin/logs?endpoint=%2Fapi%2Finternal%2Fsettings&method=PUT&outcome=ok&source=api'),
      );
      await expect(page.getByRole('heading', { name: 'Logs', level: 1 })).toBeVisible();
      const table = page.getByRole('table', { name: 'Logs' });
      const newest = table.getByRole('row').nth(1);
      await expect(newest.getByRole('link', { name: admin.username })).toHaveAttribute(
        'href',
        new RegExp(`/admin/users/${adminId}$`),
      );
      await expect(newest).toContainText('PUT /api/internal/settings/{module}');
      await newest.getByRole('link').first().click();
      await expect(page.getByRole('heading', { name: 'Log entry', level: 1 })).toBeVisible();
      await expect(page.getByText(adminId)).toBeVisible();
      await expect(page.getByText('"retentionDays": 401')).toBeVisible();
      await expect(page.getByText('Secrets were replaced by [redacted]')).toBeVisible();

      // The event of the change reaches the trail a moment later, with the same actor.
      await expect
        .poll(
          async () => {
            await page.goto(
              at(`/admin/logs?action=${encodeURIComponent('settings.changed@1')}&user=${adminId}`),
            );
            return page.getByRole('table', { name: 'Logs' }).getByRole('row').count();
          },
          { timeout: 60_000 },
        )
        .toBeGreaterThan(1);
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

test.describe('the logs', () => {
  test('are paged with "Load more", filtered, show a purged account as a deleted one, and download as CSV that is itself logged', async ({
    page,
    playwright,
    baseURL,
    at,
    basePath,
  }) => {
    test.slow();
    const api = await adminApi(playwright, baseURL, at);
    const adminId = await userId(api, admin.username);
    const tag = `/e2e/${unique('logs')}`;
    const gone = randomUUID();
    await withDb(basePath, async (client) => {
      for (let i = 0; i < 58; i += 1) {
        await makeAuditEvent(client, {
          path: `${tag}/n${i}`,
          method: 'GET',
          userId: adminId,
          occurredAt: new Date(Date.now() - 60_000 - i * 1000),
        });
      }
      await makeAuditEvent(client, {
        path: `${tag}/purged`,
        method: 'DELETE',
        userId: gone,
        occurredAt: new Date(Date.now() - 30_000),
      });
      await makeAuditEvent(client, {
        path: `${tag}/denied`,
        method: 'POST',
        outcome: 'denied',
        status: 403,
        userId: adminId,
        occurredAt: new Date(Date.now() - 20_000),
      });
    });
    try {
      await signInAsAdmin(page, at);
      await page.goto(at(`/admin/logs?endpoint=${encodeURIComponent(tag)}`));
      await expect(page.getByRole('status').filter({ hasText: 'Showing' })).toHaveText(
        'Showing 50 of 60',
      );
      const table = page.getByRole('table', { name: 'Logs' });
      await expect(table.getByRole('row')).toHaveCount(51); // the header and 50 entries
      await page.getByRole('button', { name: 'Load more' }).click();
      await expect(page.getByRole('status').filter({ hasText: 'Showing' })).toHaveText(
        'Showing 60 of 60',
      );
      await expect(table.getByRole('row')).toHaveCount(61);
      await expect(page.getByRole('button', { name: 'Load more' })).toHaveCount(0);

      // A purged account stays an id; the page says so instead of showing a name.
      const purged = table.getByRole('row').filter({ hasText: `${tag}/purged` });
      await expect(purged).toContainText('deleted account');
      await expect(purged).toContainText(gone.slice(0, 8));
      await expect(purged.getByRole('link', { name: admin.username })).toHaveCount(0);
      await expect(
        table
          .getByRole('row')
          .filter({ hasText: `${tag}/n0` })
          .getByRole('link', { name: admin.username }),
      ).toBeVisible();

      // The filters narrow the list and are in the address.
      await page.getByLabel('Outcome').selectOption('denied');
      await page.getByLabel('Endpoint starts with').fill(tag);
      await page.getByRole('button', { name: 'Apply filters' }).click();
      await expect(page).toHaveURL(/outcome=denied/);
      await expect(page.getByRole('status').filter({ hasText: 'Showing' })).toHaveText(
        'Showing 1 of 1',
      );
      await expect(page.getByRole('row').filter({ hasText: `${tag}/denied` })).toContainText(
        'Denied 403',
      );
      await page.getByRole('link', { name: 'Clear filters' }).click();
      await expect(page).not.toHaveURL(/outcome=/);

      // The CSV of the same filters, and the entry the download leaves.
      await page.goto(at(`/admin/logs?endpoint=${encodeURIComponent(tag)}&method=DELETE`));
      await expect(page.getByText('The download is itself recorded in the logs.')).toBeVisible();
      const link = page.getByRole('link', { name: 'Download CSV' });
      const address = (await link.getAttribute('href'))!;
      expect(address).toContain('/api/internal/audit/export.csv');
      expect(address).toContain('method=DELETE');
      const csv = await page.request.get(address);
      expect(csv.status()).toBe(200);
      expect(csv.headers()['content-type']).toContain('text/csv');
      expect(csv.headers()['x-row-count']).toBe('1');
      expect(await csv.text()).toContain(gone);
      await expect
        .poll(
          async () => {
            await page.goto(at(`/admin/logs?action=audit.exported&user=${adminId}`));
            return page.getByRole('table', { name: 'Logs' }).getByRole('row').count();
          },
          { timeout: 30_000 },
        )
        .toBeGreaterThan(1);
    } finally {
      await withDb(basePath, (client) =>
        client.query(`delete from audit_event where path like $1`, [`${tag}/%`]),
      ).catch(() => undefined);
      await api.dispose();
    }
  });
});

test.describe('the system page', () => {
  test('shows the outbox and the job runs, and an Admin puts a dead delivery back in the queue', async ({
    page,
    at,
    basePath,
  }) => {
    test.slow();
    const tag = unique('sys');
    // A real listener, so that the repaired delivery is delivered (and does not die again at once).
    const subscriber = 'core.audit';
    const failure = `the listener refused it ${tag}`;
    const jobName = `e2e.job.${tag}`;
    const eventId = randomUUID();
    const deliveryId = randomUUID();
    await withDb(basePath, async (client) => {
      await client.query(
        `insert into kernel_outbox (id, name, emitter, payload) values ($1, 'settings.changed@1', 'core.settings', $2::jsonb)`,
        [eventId, JSON.stringify({ module: 'core.audit', keys: ['x'], version: 1, actorId: null })],
      );
      await client.query(
        `insert into kernel_outbox_delivery (id, event_id, subscriber, status, attempts, last_error)
         values ($1, $2, $3, 'dead', 8, $4)`,
        [deliveryId, eventId, subscriber, failure],
      );
      await client.query(
        `insert into kernel_job_run (id, job_name, module, job_id, attempt, status, timeout_seconds, started_at, finished_at, duration_ms, result)
         values ($1, $2, 'core.audit', $2, 1, 'succeeded', 60, now(), now(), 12, '{"removed": 7}'::jsonb)`,
        [randomUUID(), jobName],
      );
    });
    try {
      await signInAsAdmin(page, at);
      await page.goto(at('/admin/system'));
      await expect(page.getByRole('heading', { name: 'System', level: 1 })).toBeVisible();

      // The job run, with the counts it returned.
      const runs = page.getByRole('table', { name: 'Job runs' });
      const run = runs.getByRole('row').filter({ hasText: jobName });
      await expect(run).toContainText('Succeeded');
      await expect(run).toContainText('removed: 7');
      await expect(run).toContainText('12 ms');

      // The retention numbers come from the settings and lead to the form that changes them.
      const retention = page
        .getByRole('region', { name: 'Retention' })
        .or(page.locator('section[aria-labelledby="retention-title"]'));
      await expect(retention).toContainText('Audit entries');
      await expect(retention.getByRole('link', { name: 'Change in the settings' })).toBeVisible();

      // The dead delivery: a name, a count and a masked error, never a payload; then the repair.
      const dead = page.getByRole('table', { name: 'Dead deliveries' });
      const row = dead.getByRole('row').filter({ hasText: failure });
      await expect(row).toContainText('settings.changed@1');
      await expect(row).toContainText(subscriber);
      await expect(page.getByText('"keys"')).toHaveCount(0);
      await row.getByRole('button', { name: /^Requeue/ }).click();
      const dialog = page.getByRole('dialog', { name: 'Requeue this delivery?' });
      await expect(dialog).toContainText(subscriber);
      await dialog.getByRole('button', { name: 'Requeue' }).click();
      await expect(
        toast(page).getByText('The delivery of settings.changed@1 is queued again.'),
      ).toBeVisible();
      await expect(dead.getByRole('row').filter({ hasText: failure })).toHaveCount(0);

      const status = await withDb(
        basePath,
        async (client) =>
          (
            await client.query<{ status: string; attempts: number }>(
              `select status, attempts from kernel_outbox_delivery where id = $1`,
              [deliveryId],
            )
          ).rows[0],
      );
      // Back in the queue, and the dispatcher may already have delivered it: it is not dead any more.
      expect(status?.status).not.toBe('dead');

      // The repair is in the logs, with this Admin as the actor.
      await expect
        .poll(
          async () => {
            await page.goto(
              at(`/admin/logs?action=${encodeURIComponent('system.outbox.requeued')}`),
            );
            return page
              .getByRole('table', { name: 'Logs' })
              .getByRole('row')
              .filter({ hasText: admin.username })
              .count();
          },
          { timeout: 30_000 },
        )
        .toBeGreaterThan(0);
    } finally {
      await withDb(basePath, async (client) => {
        await client.query(`delete from kernel_outbox_delivery where id = $1`, [deliveryId]);
        await client.query(`delete from kernel_outbox where id = $1`, [eventId]);
        await client.query(`delete from kernel_job_run where job_name = $1`, [jobName]);
      }).catch(() => undefined);
    }
  });
});

test.describe('the notification status', () => {
  test('lists deliveries without their content, requeues a dead one, and sends a test mail to the Admin', async ({
    page,
    at,
    basePath,
  }) => {
    test.slow();
    const template = `e2e.dead.${unique('n')}`;
    const delivery = await withDb(basePath, (client) =>
      makeDelivery(client, {
        template,
        status: 'dead',
        attempts: 8,
        lastError: 'smtp-timeout',
        subject: 'A subject that must not be shown',
        textBody: 'A body that must not be shown',
        recipientAddress: 'nobody-shows-this@example.org',
      }),
    );
    try {
      await signInAsAdmin(page, at);
      await page.goto(
        at(`/admin/notifications?status=dead&template=${encodeURIComponent(template)}`),
      );
      await expect(
        page.getByRole('heading', { name: 'Notification status', level: 1 }),
      ).toBeVisible();
      const table = page.getByRole('table', { name: 'Delivery list' });
      const row = table.getByRole('row').filter({ hasText: template });
      await expect(row).toContainText('Dead');
      await expect(row).toContainText('smtp-timeout');
      // Metadata only: nothing of the content or the address reaches the page.
      const html = await page.content();
      for (const secret of [
        'A subject that must not be shown',
        'A body that must not be shown',
        'nobody-shows-this@example.org',
      ]) {
        expect(html).not.toContain(secret);
      }

      await row.getByRole('button', { name: `Requeue the delivery of ${template}` }).click();
      const dialog = page.getByRole('dialog', { name: 'Requeue this delivery?' });
      await dialog.getByRole('button', { name: 'Requeue' }).click();
      await expect(toast(page).getByText('The delivery is queued again.')).toBeVisible();
      await expect(table.getByRole('row').filter({ hasText: template })).toHaveCount(0);
      const after = await withDb(
        basePath,
        async (client) =>
          (
            await client.query<{ status: string }>(
              `select status from notify_delivery where id = $1`,
              [delivery.id],
            )
          ).rows[0]!.status,
      );
      expect(after).not.toBe('dead');

      // The test mail goes to the Admin's own address.
      await page.getByRole('button', { name: 'Send a test mail' }).click();
      await expect(
        toast(page).getByText('The test mail is queued for your address.'),
      ).toBeVisible();
    } finally {
      await withDb(basePath, (client) =>
        client.query(`delete from notify_delivery where id = $1`, [delivery.id]),
      ).catch(() => undefined);
    }
  });
});
