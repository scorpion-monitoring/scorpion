import { type Page } from '@playwright/test';
import { adminApi } from './support/admin.ts';
import { expect, test } from './support/fixtures.ts';
import { applyThemeColours, CUSTOM_COLOURS } from './support/theme.ts';

// M12a sprint 4: the administrator's theme colours reach the page as `GET /theme.css` from this origin (ADR-0051), linked by the layout
// with a version in its address, for anonymous pages too. The page's policy is unchanged (no inline style). Every test that applies a
// custom set puts the stored colours back, because the specs of a stack share its settings.

const variable = (page: Page, name: string) =>
  page.evaluate((n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim(), name);

/** Every policy violation the page reports in its console. */
function violations(page: Page): string[] {
  const found: string[] = [];
  page.on('console', (message) => {
    if (/Content.Security.Policy/i.test(message.text())) found.push(message.text());
  });
  return found;
}

test.describe('the theme stylesheet', () => {
  test('with no colour set, the page links none and /theme.css is a comment, not cached', async ({
    page,
    playwright,
    baseURL,
    at,
  }) => {
    await page.goto(at('/'));
    await expect(page.locator('link[href*="theme.css"]')).toHaveCount(0);
    const anonymous = await playwright.request.newContext({ baseURL });
    try {
      const reply = await anonymous.get(at('/theme.css'));
      expect(reply.status()).toBe(200);
      expect(reply.headers()['content-type']).toBe('text/css; charset=utf-8');
      expect(reply.headers()['cache-control']).toBe('no-cache');
      expect(await reply.text()).toMatch(/^\/\*[^*]*\*\/\n$/);
    } finally {
      await anonymous.dispose();
    }
  });

  test('carries a custom set at a versioned address, cached briefly, to a visitor with no session', async ({
    playwright,
    baseURL,
    at,
  }) => {
    const admin = await adminApi(playwright, baseURL, at);
    const { version, restore } = await applyThemeColours(admin);
    const anonymous = await playwright.request.newContext({ baseURL });
    try {
      expect(version).toMatch(/^[0-9a-f]{16}$/);
      const reply = await anonymous.get(at(`/theme.css?v=${version}`));
      expect(reply.status()).toBe(200);
      expect(reply.headers()['content-type']).toBe('text/css; charset=utf-8');
      expect(reply.headers()['cache-control']).toBe('public, max-age=300');
      expect(reply.headers()['x-content-type-options']).toBe('nosniff');
      const css = await reply.text();
      expect(css).toContain("[data-theme='scorpionlight'] { --color-primary: #0f5c5c;");
      expect(css).toContain("[data-theme='scorpiondark'] { --color-primary: #fbbf24;");
      // Any other address is served the current sheet but not kept.
      const stale = await anonymous.get(at('/theme.css?v=0000000000000000'));
      expect(stale.headers()['cache-control']).toBe('no-cache');
      expect(await stale.text()).toBe(css);
    } finally {
      await anonymous.dispose();
      await restore();
      await admin.dispose();
    }
  });

  test('colours an anonymous page in both themes, without a policy violation, and the reset puts back the built-in ones', async ({
    browser,
    playwright,
    baseURL,
    at,
  }) => {
    const admin = await adminApi(playwright, baseURL, at);
    const { version, restore } = await applyThemeColours(admin);
    const context = await browser.newContext({ baseURL, colorScheme: 'light' });
    const page = await context.newPage();
    const found = violations(page);
    try {
      await page.goto(at('/'));
      await expect(page.locator('link[rel="stylesheet"][href*="theme.css"]')).toHaveAttribute(
        'href',
        at(`/theme.css?v=${version}`),
      );
      // The system's light theme, then its dark theme, then a choice by hand against the system.
      expect(await variable(page, '--color-primary')).toBe(CUSTOM_COLOURS.light.primary);
      expect(await variable(page, '--color-base-content')).toBe('#000000'); // derived
      await page.emulateMedia({ colorScheme: 'dark' });
      expect(await variable(page, '--color-primary')).toBe(CUSTOM_COLOURS.dark.primary);
      expect(await variable(page, '--color-info')).toBe('#00e5ff'); // not set: the built-in dark value, not a light one
      await page.emulateMedia({ colorScheme: 'light' });
      await page.evaluate(() => (document.documentElement.dataset.theme = 'scorpiondark'));
      expect(await variable(page, '--color-primary')).toBe(CUSTOM_COLOURS.dark.primary);
      await page.evaluate(() => (document.documentElement.dataset.theme = 'scorpionlight'));
      expect(await variable(page, '--color-primary')).toBe(CUSTOM_COLOURS.light.primary);
      expect(found).toEqual([]);
    } finally {
      await context.close();
      await restore();
      await admin.dispose();
    }
    const after = await browser.newContext({ baseURL, colorScheme: 'light' });
    try {
      const page2 = await after.newPage();
      await page2.goto(at('/'));
      await expect(page2.locator('link[href*="theme.css"]')).toHaveCount(0);
      expect(await variable(page2, '--color-primary')).toBe('#006da8');
    } finally {
      await after.close();
    }
  });
});
