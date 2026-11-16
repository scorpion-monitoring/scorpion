import { type Page } from '@playwright/test';
import { adminApi, type AdminApi } from './support/admin.ts';
import { expect, test } from './support/fixtures.ts';
import { pageAs } from './support/members.ts';
import { world } from './support/submission.ts';
import { withDb } from './support/db.ts';

// M12a sprint 5: a person's own navigation no longer drains the budget of the address. The defect (backlog, "Too many 429s when administering
// the instance", and "The loader makes nine reads"): the `default` rate-limit bucket was keyed by the client address, so the shell's reads and the
// nine reads of the data-submission loader on every month change all came out of one bucket of 120, and the eighth month change in a minute
// failed with a 429. The e2e stacks raise the limits to 10 000; this spec puts the DEFAULT limits back (a burst of 120, then 120 a minute) for
// its own length, waits out the settings cache, and puts the stored value back at the end. The specs of a stack run one after the other
// (`workers: 1`), so nothing else sees the lower limits.

const DEFAULT_LIMIT = { burst: 120, perMinute: 120 };
/** The settings cache holds a module's value for five seconds (`SETTINGS_CACHE_TTL_MS`); a write empties it in the process that wrote. */
const SETTINGS_CACHE_WAIT_MS = 6_000;
const MONTH_CHANGES = 9;

interface SettingsDocument {
  version: number;
  values: { rateLimits?: { default?: unknown; strict?: unknown } } & Record<string, unknown>;
}

async function setDefaultLimit(api: AdminApi, limit: unknown): Promise<void> {
  const current = await api.get<SettingsDocument>('/settings/core.settings');
  const saved = await api.send('PUT', '/settings/core.settings', {
    version: current.version,
    values: { ...current.values, rateLimits: { ...current.values.rateLimits, default: limit } },
  });
  expect(saved.status, JSON.stringify(saved.body)).toBe(200);
}

/** Every response of the page that was a 429, with the address that earned it. */
function tooManyRequests(page: Page): string[] {
  const refused: string[] = [];
  page.on('response', (response) => {
    if (response.status() === 429) refused.push(`${response.request().method()} ${response.url()}`);
  });
  return refused;
}

test.describe('the default rate limit, by session', () => {
  test('nine month changes in a row on the data-submission page are never refused (the old limit refused the eighth)', async ({
    browser,
    playwright,
    baseURL,
    basePath,
    at,
  }) => {
    test.slow();
    const w = await world(playwright, baseURL, at);
    const admin = await adminApi(playwright, baseURL, at);
    const before = await admin.get<SettingsDocument>('/settings/core.settings');
    const originalDefault = before.values.rateLimits?.default;
    try {
      await setDefaultLimit(admin, DEFAULT_LIMIT);
      await new Promise((resolve) => setTimeout(resolve, SETTINGS_CACHE_WAIT_MS));

      const opened = await pageAs(browser, baseURL, at, w.member);
      const page = opened.page;
      const refused = tooManyRequests(page);
      await page.goto(at(`/submit?service=${w.service.id}`));
      await expect(page.getByRole('heading', { name: 'Reporting for', level: 2 })).toBeVisible();

      const choices = await page
        .getByLabel('Month', { exact: true })
        .locator('option')
        .evaluateAll((options) => options.map((option) => (option as HTMLOptionElement).value));
      expect(choices.length).toBeGreaterThanOrEqual(3);

      // What the person's bucket holds now: the most recently used `session:` row is theirs (the others belong to the setup).
      const tokensLeft = () =>
        withDb(basePath, async (db) => {
          const { rows } = await db.query<{ tokens: number }>(
            `select tokens from kernel_rate_bucket where key like 'session:default:%' order by updated_at desc limit 1`,
          );
          return Math.round(rows[0]?.tokens ?? -1);
        });
      const used: number[] = [];
      const started = Date.now();
      for (let change = 1; change <= MONTH_CHANGES; change++) {
        const month = choices[change % 3]!;
        const left = await tokensLeft();
        await page.getByLabel('Month', { exact: true }).selectOption(month);
        await page.getByRole('button', { name: 'Show month' }).click();
        await expect(page, `month change ${change}`).toHaveURL(new RegExp(`period=${month}`));
        await expect(
          page.getByRole('heading', { name: 'Reporting for', level: 2 }),
          `month change ${change}`,
        ).toBeVisible();
        used.push(left - (await tokensLeft()));
        console.log(`[rate-limit] change ${change}: ${left} tokens before, used ${used.at(-1)}`);
      }
      console.log(
        `[rate-limit] tokens of the bucket used by each month change: ${used.join(', ')}`,
      );
      console.log(
        `[rate-limit] ${MONTH_CHANGES} month changes in ${Math.round((Date.now() - started) / 1000)} s, 429s seen: ${refused.length}`,
      );
      expect(refused).toEqual([]);
      await opened.close();
    } finally {
      await setDefaultLimit(admin, originalDefault);
      await admin.dispose();
      await w.api.dispose();
    }
  });

  test('another person on the same address keeps a budget of their own while one is refused', async ({
    browser,
    playwright,
    baseURL,
    at,
  }) => {
    test.slow();
    const w = await world(playwright, baseURL, at);
    const admin = await adminApi(playwright, baseURL, at);
    const before = await admin.get<SettingsDocument>('/settings/core.settings');
    const originalDefault = before.values.rateLimits?.default;
    try {
      // A small bucket, so one person can use theirs up with a few calls from the test itself.
      await setDefaultLimit(admin, { burst: 20, perMinute: 1 });
      await new Promise((resolve) => setTimeout(resolve, SETTINGS_CACHE_WAIT_MS));

      const busy = await pageAs(browser, baseURL, at, w.member);
      const quiet = await pageAs(browser, baseURL, at, w.stranger);
      const statuses: number[] = [];
      for (let i = 0; i < 30; i++) {
        const reply = await busy.page.request.get(at('/api/internal/auth/me'));
        statuses.push(reply.status());
      }
      expect(statuses).toContain(429);
      // The other person, from the same address, is not refused.
      const reply = await quiet.page.request.get(at('/api/internal/auth/me'));
      expect(reply.status()).toBe(200);
      await busy.close();
      await quiet.close();
    } finally {
      await setDefaultLimit(admin, originalDefault);
      await admin.dispose();
      await w.api.dispose();
    }
  });
});
