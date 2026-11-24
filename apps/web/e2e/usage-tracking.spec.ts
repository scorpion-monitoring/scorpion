import type { Page } from '@playwright/test';
import { url } from '@scorpion/contracts';
import { adminApi, userId, type AdminApi } from './support/admin.ts';
import { admin, expect, signIn, test } from './support/fixtures.ts';
import { ADMIN } from './support/stack.ts';

// Usage statistics with Matomo (matomo, M13b, ADR-0054). A stub stands in for the Matomo instance: the browser asks for it,
// Playwright answers, so the page's real Content-Security-Policy still decides whether the script may load and the hit may
// go out. The stub's matomo.js reads the `_paq` queue as Matomo does and sends each page view to matomo.php, where the
// test reads what Matomo would have received. Tracking is on for this file only and off again at its end.

const MATOMO = 'https://stats.example.org';
const SITE_ID = 3;

const STUB = `(() => {
  const queue = window._paq || [];
  const state = {};
  const run = (command) => {
    const [name, value] = command;
    if (name === 'setTrackerUrl') state.endpoint = value;
    else if (name === 'setSiteId') state.site = value;
    else if (name === 'disableCookies') state.cookieless = '1';
    else if (name === 'setCustomUrl') state.url = value;
    else if (name === 'setDocumentTitle') state.title = value;
    else if (name === 'setUserId') state.uid = value;
    else if (name === 'resetUserId') delete state.uid;
    else if (name === 'trackPageView') {
      const query = new URLSearchParams({ idsite: state.site, url: state.url, action_name: state.title, cookieless: state.cookieless || '0' });
      if (state.uid) query.set('uid', state.uid);
      fetch(state.endpoint + '?' + query.toString(), { mode: 'no-cors' });
    }
  };
  for (const command of queue) run(command);
  window._paq = { push: run };
})();`;

interface Hit {
  idsite: string;
  url: string;
  action_name: string;
  cookieless: string;
  uid?: string;
  /** The whole request address, to prove what is not in it. */
  raw: string;
}

/** Answers the browser's requests to the Matomo origin and records the page views. */
async function stubMatomo(page: Page): Promise<{ hits: Hit[]; scripts: () => number }> {
  const hits: Hit[] = [];
  let scripts = 0;
  await page.route(`${MATOMO}/**`, async (route) => {
    const address = new URL(route.request().url());
    if (address.pathname.endsWith('/matomo.js')) {
      scripts += 1;
      await route.fulfill({ contentType: 'text/javascript', body: STUB });
      return;
    }
    const query = Object.fromEntries(address.searchParams) as Omit<Hit, 'raw'>;
    hits.push({ ...query, raw: address.href });
    await route.fulfill({ status: 204 });
  });
  return { hits, scripts: () => scripts };
}

const policyOf = async (page: Page, address: string) =>
  (await page.request.get(address)).headers()['content-security-policy'] ?? '';

/** The sources of one directive, as whole tokens: an origin is compared exactly, never as a part of a longer host. */
const sourcesOf = (policy: string, directive: string): string[] => {
  const [, ...sources] =
    policy
      .split(';')
      .map((part) => part.trim().split(/\s+/))
      .find(([name]) => name === directive) ?? [];
  return sources;
};

/** Whether any directive of the policy names the Matomo origin as a source. */
const namesMatomo = (policy: string): boolean =>
  policy.split(';').some((part) =>
    part
      .trim()
      .split(/\s+/)
      .slice(1)
      .some((source) => source === MATOMO),
  );

test.describe('usage statistics with Matomo', () => {
  test.describe.configure({ mode: 'serial' });

  let api: AdminApi;
  const setTracking = async (values: Record<string, unknown>) => {
    const { version } = await api.get<{ version: number }>('/settings/matomo');
    const saved = await api.send('PUT', '/settings/matomo', { version, values });
    expect(saved.status, JSON.stringify(saved.body)).toBe(200);
  };
  /** The web app keeps the tracker's origin for a few seconds (TRACKING_TTL_MS): wait until its pages say what is set. */
  const policyAllowsMatomo = async (page: Page, at: (path: string) => string, allowed: boolean) =>
    expect
      .poll(async () => namesMatomo(await policyOf(page, at('/'))), { timeout: 15_000 })
      .toBe(allowed);

  test.beforeAll(async ({ playwright, baseURL }, info) => {
    const basePath = (info.project.use as { basePath?: string }).basePath ?? '/';
    api = await adminApi(playwright, baseURL, (path) => url(basePath, path));
    await setTracking({ enabled: true, url: `${MATOMO}/matomo/`, siteId: SITE_ID });
  });

  test.afterAll(async () => {
    await setTracking({ enabled: false });
    await api.send('DELETE', '/secrets/matomo.user-id-key');
    await api.dispose();
  });

  test('pages allow the Matomo origin for the script and its hits, and nothing more', async ({
    page,
    at,
  }) => {
    await policyAllowsMatomo(page, at, true);
    const policy = await policyOf(page, at('/login'));
    for (const directive of ['script-src', 'connect-src', 'img-src']) {
      expect(
        sourcesOf(policy, directive).filter((source) => source === MATOMO),
        directive,
      ).toHaveLength(1);
    }
    for (const directive of ['default-src', 'style-src', 'frame-ancestors', 'form-action']) {
      expect(
        sourcesOf(policy, directive).filter((source) => source === MATOMO),
        directive,
      ).toHaveLength(0);
    }
    expect(policy).not.toContain('unsafe-inline');
    expect(policy).not.toContain('unsafe-eval');
  });

  test('an anonymous visitor is counted once per page, by pattern, also after a navigation inside the application', async ({
    page,
    at,
    baseURL,
  }) => {
    const origin = new URL(baseURL!).origin;
    const problems: string[] = [];
    page.on('console', (message) => {
      if (/content security policy|refused to/i.test(message.text())) problems.push(message.text());
    });
    const { hits } = await stubMatomo(page);
    await page.goto(at('/'));
    await expect.poll(() => hits.length).toBe(1);
    expect(hits[0]).toMatchObject({
      idsite: String(SITE_ID),
      url: `${origin}${at('/')}`,
      action_name: '/',
      cookieless: '1',
    });
    expect(hits[0]!.uid).toBeUndefined();

    // A link inside the application: a navigation in the browser, no new document.
    await page
      .locator(`a[href="${at('/docs')}"]`)
      .first()
      .click();
    await expect(page).toHaveURL(new RegExp(`${at('/docs')}$`));
    await expect.poll(() => hits.length).toBe(2);
    expect(hits[1]).toMatchObject({ url: `${origin}${at('/docs')}`, action_name: '/docs' });
    expect(problems).toEqual([]);
  });

  test('the token of a mailed link and the ids in a path never reach Matomo', async ({
    page,
    at,
    baseURL,
  }) => {
    const origin = new URL(baseURL!).origin;
    const { hits } = await stubMatomo(page);
    await page.goto(`${at('/reset-password')}#token=SECRET-TOKEN-0123456789`);
    await page.goto(`${at('/verify-email')}?source=mail#token=OTHER-SECRET-TOKEN`);
    await page.goto(at('/no/such/page'));
    await expect.poll(() => hits.length).toBe(3);
    expect(hits.map((hit) => hit.url)).toEqual([
      `${origin}${at('/reset-password')}`,
      `${origin}${at('/verify-email')}`,
      `${origin}${at('/(error)')}`,
    ]);
    for (const hit of hits) {
      expect(hit.raw).not.toMatch(/SECRET-TOKEN|source|no%2Fsuch|no\/such/);
    }

    await signIn(page.request, at, admin);
    const id = await userId(api, ADMIN.username);
    await page.goto(at(`/admin/users/${id}`));
    await expect.poll(() => hits.length).toBe(4);
    expect(hits[3]!.url).toBe(`${origin}${at('/admin/users/:id')}`);
    expect(hits[3]!.raw).not.toContain(id);
  });

  test('a signed-in person gets a pseudonymous id with the option on and the secret set, never their account', async ({
    page,
    at,
  }) => {
    const set = await api.send('PUT', '/secrets/matomo.user-id-key', {
      value: 'e2e-matomo-user-id-key-0123456789',
    });
    expect(set.status).toBe(200);
    await setTracking({
      enabled: true,
      url: `${MATOMO}/matomo/`,
      siteId: SITE_ID,
      pseudonymousUserId: true,
    });
    const { hits } = await stubMatomo(page);
    await signIn(page.request, at, admin);
    await page.goto(at('/'));
    await expect.poll(() => hits.length).toBe(1);
    const id = await userId(api, ADMIN.username);
    expect(hits[0]!.uid).toMatch(/^[0-9a-f]{32}$/);
    expect(hits[0]!.raw).not.toContain(id);
    expect(hits[0]!.raw).not.toContain(ADMIN.username);
  });

  test('a browser that asks not to be tracked sends nothing', async ({ page, at }) => {
    await page.addInitScript(() =>
      Object.defineProperty(navigator, 'globalPrivacyControl', { get: () => true }),
    );
    const { hits, scripts } = await stubMatomo(page);
    await page.goto(at('/'));
    await page
      .locator(`a[href="${at('/docs')}"]`)
      .first()
      .click();
    await expect(page).toHaveURL(new RegExp(`${at('/docs')}$`));
    // Long enough for a hit to have gone out, had there been one.
    await page.waitForTimeout(1_000);
    expect(scripts()).toBe(0);
    expect(hits).toEqual([]);
  });

  test('turned off, pages allow no other origin and send nothing', async ({ page, at }) => {
    await setTracking({ enabled: false });
    await policyAllowsMatomo(page, at, false);
    const { hits, scripts } = await stubMatomo(page);
    await page.goto(at('/'));
    await page.waitForTimeout(1_000);
    expect(scripts()).toBe(0);
    expect(hits).toEqual([]);
  });
});
