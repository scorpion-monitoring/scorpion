import { makePng } from '@scorpion/testing';
import { makeSessionsStale } from './support/db.ts';
import { createUser, expect, person, signInThroughPage, test } from './support/fixtures.ts';

// The headers and the Content-Security-Policy of the web app (M5 plan §2): no 'unsafe-inline', nonces
// for the inline scripts SvelteKit and the theme script need, framing denied, no sniffing.
test.describe('the security headers of a page', () => {
  for (const path of [
    '/',
    '/docs',
    '/legal/terms',
    '/no/such/page',
    '/login',
    '/register',
    '/forgot-password',
    '/reset-password',
    '/verify-email',
    '/link-sign-in',
  ]) {
    test(`on ${path}`, async ({ request, at }) => {
      const response = await request.get(at(path));
      const headers = response.headers();
      const csp = headers['content-security-policy'] ?? '';
      expect(csp).toContain("default-src 'none'");
      expect(csp).toContain("frame-ancestors 'none'");
      expect(csp).toContain("object-src 'none'");
      expect(csp).toContain("base-uri 'none'");
      expect(csp).not.toContain('unsafe-inline');
      expect(csp).not.toContain('unsafe-eval');
      expect(csp).toMatch(/script-src [^;]*'nonce-[A-Za-z0-9+/=_-]+'/);
      expect(headers['x-content-type-options']).toBe('nosniff');
      expect(headers['x-frame-options']).toBe('DENY');
      expect(headers['referrer-policy']).toBe('no-referrer');
      expect(headers['cross-origin-opener-policy']).toBe('same-origin');
      expect(headers['permissions-policy']).toContain('camera=()');
      // A page can carry the caller's session: no shared cache may keep it.
      expect(headers['cache-control']).toBe('no-store');
    });
  }

  test('every inline script of a page carries the nonce of its policy', async ({ request, at }) => {
    const response = await request.get(at('/'));
    const html = await response.text();
    const nonce = /'nonce-([^']+)'/.exec(response.headers()['content-security-policy'] ?? '')?.[1];
    expect(nonce).toBeTruthy();
    const inline = [...html.matchAll(/<script(?![^>]*\ssrc=)([^>]*)>/g)];
    expect(inline.length).toBeGreaterThan(0);
    for (const [, attributes] of inline) expect(attributes).toContain(`nonce="${nonce}"`);
    expect(html).not.toMatch(/\sstyle="/);
    expect(html).not.toMatch(/\son[a-z]+="/);
  });

  test('a page runs without a single policy violation, in the browser', async ({ page, at }) => {
    const problems: string[] = [];
    page.on('console', (message) => {
      if (/content security policy|refused to/i.test(message.text())) problems.push(message.text());
    });
    page.on('pageerror', (error) => problems.push(error.message));
    for (const path of ['/', '/docs']) {
      await page.goto(at(path));
      await page.getByRole('button', { name: 'Dark' }).click();
      await page.getByRole('button', { name: 'System' }).click();
    }
    expect(problems).toEqual([]);
  });

  test('the sign-in and profile pages run without a policy violation, dialog and picture included', async ({
    page,
    at,
    basePath,
  }) => {
    const problems: string[] = [];
    page.on('console', (message) => {
      if (/content security policy|refused to/i.test(message.text())) problems.push(message.text());
    });
    page.on('pageerror', (error) => problems.push(error.message));
    for (const path of ['/login', '/register', '/forgot-password']) await page.goto(at(path));
    const who = person('csp');
    await createUser(page.request, at, who);
    await signInThroughPage(page, at, who);
    await page.goto(at('/profile'));
    await page.getByLabel('Choose a picture').setInputFiles({
      name: 'me.png',
      mimeType: 'image/png',
      buffer: makePng(16),
    });
    await expect(page.getByRole('img', { name: 'Picture of csp' })).toBeVisible();
    await makeSessionsStale(basePath, who.username);
    await page.getByLabel('Email address').fill('csp.new@example.org');
    await page.getByRole('button', { name: 'Save' }).first().click();
    await expect(page.getByRole('dialog', { name: 'Confirm your identity' })).toBeVisible();
    expect(problems).toEqual([]);
  });

  test('the API answers through the same origin with its own strict policy, and nothing is cached', async ({
    request,
    at,
  }) => {
    const response = await request.get(at('/api/internal/ui/navigation'));
    expect(response.status()).toBe(200);
    expect(response.headers()['content-security-policy']).toContain("default-src 'none'");
    expect(response.headers()['cache-control']).toBe('no-store');
  });
});
