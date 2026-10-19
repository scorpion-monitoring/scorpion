import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Page } from '@playwright/test';
import { withDb, stackFor } from './support/db.ts';
import {
  admin,
  createUser,
  expect,
  person,
  saveSettings,
  signIn,
  signInThroughPage,
  test,
} from './support/fixtures.ts';
import {
  browserState,
  callFromReference,
  expectNoForeignRequest,
  KNOWN_REPORTS,
  openReference,
  watch,
} from './support/reference.ts';

// The API reference (ADR-0038): a person makes a token, follows the landing page to the reference, and calls the
// API from it. Under both base paths. The reference carries a policy of its own (the one document that may write
// styles); the checks here are what keeps that exception small: nothing leaves the origin, nothing is stored in
// the browser, no token reaches a log or the audit trail, and no policy report is new.

const SCOPE_PROVIDERS = 'registry.organisations.v1.read';
const SCOPE_SERVICES = 'registry.services.v1.read';

/** Makes a token on the profile page, as a person does, and returns its secret. */
async function makeToken(page: Page, name: string, scope: string): Promise<string> {
  const tokens = page.getByRole('region', { name: 'Access tokens' });
  await tokens.getByLabel('Name').fill(name);
  await tokens.getByRole('checkbox', { name: scope }).check();
  await tokens.getByRole('button', { name: 'Create the token' }).click();
  const secret = (await page.getByTestId('token-secret').textContent())!;
  await page.getByRole('button', { name: 'I have copied it' }).click();
  // The next token starts from a form with nothing ticked.
  await tokens.getByRole('checkbox', { name: scope }).uncheck();
  return secret;
}

test.describe('the API reference', () => {
  test('[ASVS-7.2.1] [ASVS-8.2.1] [ASVS-8.3.1] a person makes a token, opens the reference from the landing page and calls the API with it', async ({
    page,
    playwright,
    baseURL,
    basePath,
    at,
  }) => {
    const tag = randomBytes(3).toString('hex');
    const who = person(`refer${tag}`);
    await createUser(page.request, at, who);
    await signInThroughPage(page, at, who);
    const seen = await watch(page);

    // 1. Two tokens on the profile page: one with the scope of the providers, one with the other scope only.
    await page.goto(at('/profile'));
    await expect(page.getByRole('heading', { name: 'Your profile' })).toBeVisible();
    const good = await makeToken(page, `good${tag}`, SCOPE_PROVIDERS);
    const wrong = await makeToken(page, `wrong${tag}`, SCOPE_SERVICES);

    // 2. The landing page says how, and links to the reference, which is a document of its own.
    await page.goto(at('/docs'));
    await expect(page.getByRole('heading', { level: 1, name: 'API documentation' })).toBeVisible();
    await expect(page.getByRole('heading', { level: 2, name: 'Get a token' })).toBeVisible();
    // Two routes need it (the list and one provider).
    await expect(
      page.getByRole('cell', { name: SCOPE_PROVIDERS, exact: true }).first(),
    ).toBeVisible();
    await page.getByRole('link', { name: 'Open the API reference' }).click();
    await expect(page).toHaveURL((address) => address.pathname === at('/docs/reference'));
    await expect(page.getByRole('link', { name: 'List the providers' })).toBeVisible();
    // The back link names the instance and returns to the landing page.
    await expect(page.getByRole('link', { name: 'Back to the API documentation' })).toHaveAttribute(
      'href',
      at('/docs'),
    );

    // 3. The routes of the document are drawn, and the page speaks of this instance's address.
    for (const route of [
      'Get one provider',
      'List the providers',
      'List the services',
      // M10: the first write of the public API, with the token schemes of every other route
      'List the measurements of a service',
      'Record the measurements of a service',
    ]) {
      await expect(page.getByRole('link', { name: route })).toBeVisible();
    }
    await expect(page.locator('body')).toContainText(`${new URL(baseURL!).origin}${at('/api/v1')}`);

    // 4. A token with the scope gets the envelope; one without it gets 403, in the same panel.
    const before = await browserState(page);
    const ok = await callFromReference(page, 'List the providers', good);
    expect(ok.status).toMatch(/^200\b/);
    // Scalar's viewer draws only the lines in view, so the text is read as text, not parsed.
    expect(ok.body).toContain('"metadata"');
    expect(ok.body).toContain('"currentPage": 0');
    expect(ok.body).toContain('"result"');
    const refused = await callFromReference(page, 'List the providers', wrong);
    expect(refused.status).toMatch(/^403\b/);
    // The page decides nothing: a token that was never made is refused by the server at the same call (401).
    const invented = `not-a-token-${randomBytes(12).toString('hex')}`;
    const unknown = await callFromReference(page, 'List the providers', invented);
    expect(unknown.status).toMatch(/^401\b/);

    // 5. The token is in no storage and no cookie, and nothing in the browser changed.
    const after = await browserState(page);
    expect(after).toBe(before);
    for (const secret of [good, wrong, invented]) expect(after).not.toContain(secret);

    // 6. Nothing left the origin (the landing page and the reference), and the policy had one report: the known one.
    expectNoForeignRequest(seen.requests, new URL(baseURL!).origin);
    expect(await seen.reports()).toEqual(KNOWN_REPORTS);
    expect(seen.policyMessages).toEqual([]);

    // 7. A plain request with the token returns the same envelope the panel showed.
    const program = await playwright.request.newContext({
      baseURL,
      extraHTTPHeaders: { authorization: `Bearer ${good}` },
    });
    const plain = await program.get(at('/api/v1/providers'));
    expect(plain.status()).toBe(200);
    const envelope = (await plain.json()) as {
      metadata: { currentPage: number; totalCount: number };
      result: unknown[];
    };
    expect(envelope.metadata.currentPage).toBe(0);
    expect(Array.isArray(envelope.result)).toBe(true);
    // The panel showed the same count the plain request returns.
    expect(ok.body).toContain(`"totalCount": ${envelope.metadata.totalCount}`);
    const aliased = await playwright.request.newContext({
      baseURL,
      extraHTTPHeaders: { 'x-api-key': good },
    });
    expect((await aliased.get(at('/api/v1/providers'))).status()).toBe(200);
    expect((await program.get(at('/api/v1/services'))).status()).toBe(403);

    // 8. The calls are in the audit trail, with the token's id, and the secret is nowhere in it or in the logs.
    const calls = await withDb(basePath, async (client) => {
      const entries = await client.query<{ n: number }>(
        `select count(*)::int as n from audit_event where source = 'api' and path like $1`,
        ['%/api/v1/providers'],
      );
      const leaks = await client.query<{ n: number }>(
        `select count(*)::int as n from audit_event where audit_event::text like any ($1)`,
        [[good, wrong, invented].map((secret) => `%${secret}%`)],
      );
      return { entries: entries.rows[0]!.n, leaks: leaks.rows[0]!.n };
    });
    expect(calls.entries).toBeGreaterThanOrEqual(3);
    expect(calls.leaks).toBe(0);
    const log = readFileSync(
      resolve(import.meta.dirname, `../test-results/stack-${stackFor(basePath).name}.log`),
      'utf8',
    );
    for (const secret of [good, wrong, invented]) expect(log).not.toContain(secret);
    await program.dispose();
    await aliased.dispose();
  });

  test('the reference is served with the policy of ADR-0038, a new nonce each time, and no cache', async ({
    request,
    at,
  }) => {
    const first = await request.get(at('/docs/reference'));
    const second = await request.get(at('/docs/reference'));
    expect(first.status()).toBe(200);
    const policy = first.headers()['content-security-policy'] ?? '';
    const nonce = /'nonce-([A-Za-z0-9+/=]+)'/.exec(policy)?.[1];
    expect(nonce).toBeTruthy();
    expect(policy).toBe(
      [
        "default-src 'none'",
        `script-src 'self' 'nonce-${nonce}'`,
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data:",
        "font-src 'self'",
        "connect-src 'self'",
        "manifest-src 'self'",
        "base-uri 'none'",
        "form-action 'none'",
        "frame-ancestors 'none'",
        "object-src 'none'",
      ].join('; '),
    );
    expect(first.headers()['cache-control']).toBe('no-cache');
    expect(first.headers()['content-type']).toContain('text/html');
    expect(first.headers()['x-frame-options']).toBe('DENY');
    expect(first.headers()['x-content-type-options']).toBe('nosniff');
    const nonceOf = (headers: Record<string, string>) =>
      /'nonce-([A-Za-z0-9+/=]+)'/.exec(headers['content-security-policy'] ?? '')?.[1];
    expect(nonceOf(second.headers())).not.toBe(nonce);

    // The nonce of the response is the one on every inline tag; the script is ours, hashed and immutable.
    const html = await first.text();
    const inline = [...html.matchAll(/<script(?![^>]*\ssrc=)([^>]*)>/g)];
    expect(inline.length).toBeGreaterThan(0);
    for (const [, attributes] of inline) expect(attributes).toContain(`nonce="${nonce}"`);
    expect(html).not.toContain('http://');
    expect(html).not.toContain('https://');
    const asset = /<script src="([^"]+)"/.exec(html)?.[1];
    expect(asset).toContain(at('/_app/immutable/scalar/api-reference.'));
    const script = await request.get(asset!);
    expect(script.status()).toBe(200);
    expect(script.headers()['cache-control']).toContain('immutable');
  });

  test('the reference is public, and a method other than GET is refused', async ({
    playwright,
    baseURL,
    at,
  }) => {
    const anonymous = await playwright.request.newContext({ baseURL });
    expect((await anonymous.get(at('/docs/reference'))).status()).toBe(200);
    for (const method of ['POST', 'PUT', 'DELETE', 'PATCH'] as const) {
      // 405 from the route, or 403 from SvelteKit's own check of a cross-site form post that comes first.
      expect([403, 405], method).toContain(
        (await anonymous.fetch(at('/docs/reference'), { method })).status(),
      );
    }
    await anonymous.dispose();
  });

  test('a browser application is let in only from an origin on the list (the documented CORS flow)', async ({
    request,
    playwright,
    baseURL,
    at,
  }) => {
    const allowed = 'https://app.example.org';
    const other = 'https://other.example.org';
    const csrf = await signIn(request, at, admin);
    // The administrator's own token with the providers scope: the flow of the landing page, through the API.
    const made = await request.post(at('/api/internal/tokens'), {
      headers: { 'x-csrf-token': csrf },
      data: { name: `cors${randomBytes(3).toString('hex')}`, scopes: [SCOPE_PROVIDERS] },
    });
    expect(made.status(), await made.text()).toBe(201);
    const token = ((await made.json()) as { token: string }).token;

    let previous: unknown = [];
    await saveSettings(request, at, csrf, 'public-api', (values) => {
      previous = values.corsOrigins;
      return { ...values, corsOrigins: [allowed] };
    });
    try {
      const program = await playwright.request.newContext({
        baseURL,
        extraHTTPHeaders: { authorization: `Bearer ${token}` },
      });
      const preflight = (origin: string) =>
        program.fetch(at('/api/v1/providers'), {
          method: 'OPTIONS',
          headers: { origin, 'access-control-request-method': 'GET' },
        });
      const yes = await preflight(allowed);
      expect(yes.status()).toBe(204);
      expect(yes.headers()['access-control-allow-origin']).toBe(allowed);
      expect(yes.headers()['access-control-allow-credentials']).toBeUndefined();
      const no = await preflight(other);
      expect(no.status()).toBe(403);
      expect(no.headers()['access-control-allow-origin']).toBeUndefined();

      const read = await program.get(at('/api/v1/providers'), { headers: { origin: allowed } });
      expect(read.status()).toBe(200);
      expect(read.headers()['access-control-allow-origin']).toBe(allowed);
      expect(read.headers()['vary']).toContain('Origin');
      const foreign = await program.get(at('/api/v1/providers'), { headers: { origin: other } });
      expect(foreign.status()).toBe(200); // the token decides, not the origin
      expect(foreign.headers()['access-control-allow-origin']).toBeUndefined();
      await program.dispose();
    } finally {
      await saveSettings(request, at, csrf, 'public-api', (values) => ({
        ...values,
        corsOrigins: previous,
      }));
    }
  });

  test('the landing page and the reference ask for nothing from another origin', async ({
    page,
    baseURL,
    at,
  }) => {
    const seen = await watch(page);
    await page.goto(at('/docs'));
    await expect(page.getByRole('heading', { level: 1, name: 'API documentation' })).toBeVisible();
    expectNoForeignRequest(seen.requests, new URL(baseURL!).origin);
    // The landing page keeps the strict policy: no report at all.
    expect(await seen.reports()).toEqual([]);
    await openReference(page, at);
    expectNoForeignRequest(seen.requests, new URL(baseURL!).origin);
    expect(await seen.reports()).toEqual(KNOWN_REPORTS);
  });

  test('the reference follows the theme of the shell, chosen by hand or by the system', async ({
    page,
    at,
  }) => {
    const modeClass = { light: /\blight-mode\b/, dark: /\bdark-mode\b/ };
    for (const choice of ['light', 'dark'] as const) {
      await page.addInitScript((value) => localStorage.setItem('scorpion.theme', value), choice);
      await openReference(page, at);
      await expect(page.locator('body')).toHaveClass(modeClass[choice]);
    }
    await page.addInitScript(() => localStorage.removeItem('scorpion.theme'));
    for (const scheme of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme: scheme });
      await openReference(page, at);
      await expect(page.locator('body')).toHaveClass(modeClass[scheme]);
    }
  });
});
