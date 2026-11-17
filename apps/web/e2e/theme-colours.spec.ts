import { type Page } from '@playwright/test';
import { adminApi } from './support/admin.ts';
import { admin, expect, signInThroughPage, test } from './support/fixtures.ts';
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

  test('are edited in the branding screen: two tabs, a failing pair named before and at save, a good set applied, a reset', async ({
    page,
    playwright,
    baseURL,
    at,
  }) => {
    const api = await adminApi(playwright, baseURL, at);
    const { restore } = await applyThemeColours(api, { light: {}, dark: {} });
    try {
      await signInThroughPage(page, at, admin);
      await page.goto(at('/admin/settings/branding'));
      const colours = page.getByRole('group', { name: 'Colours' });
      const tabs = colours.getByRole('tablist', { name: 'Theme' });
      await expect(tabs.getByRole('tab')).toHaveText(['Light theme', 'Dark theme']);
      await expect(tabs.getByRole('tab', { name: 'Light theme' })).toHaveAttribute(
        'aria-selected',
        'true',
      );
      const panel = colours.getByRole('tabpanel');

      // A primary too light for text on the page: the tab and the panel say so before anything is sent.
      await panel.getByLabel('Primary', { exact: true }).fill('#29b6f6');
      await expect(tabs.getByRole('tab', { name: 'Light theme (3 to fix)' })).toBeVisible();
      await expect(panel.getByRole('status')).toContainText('Primary on Page: 2.15:1, needs 4.5:1');
      await expect(panel.getByText('Derived: #000000', { exact: false }).first()).toBeVisible();

      // The server refuses it with the pair named (the form's summary), and the light theme's tab stays open.
      await page.getByRole('button', { name: 'Save' }).click();
      await expect(page.getByRole('alert').filter({ hasText: 'WCAG AA' })).toContainText(
        'In the light theme, primary on base-100 is 2.15:1, needs 4.5:1 (WCAG AA).',
      );
      await expect(tabs.getByRole('tab', { name: 'Light theme (3 to fix)' })).toHaveAttribute(
        'aria-selected',
        'true',
      );
      // The other tab can still be opened while the message stands.
      await tabs.getByRole('tab', { name: 'Dark theme' }).click();
      await expect(tabs.getByRole('tab', { name: 'Dark theme' })).toHaveAttribute(
        'aria-selected',
        'true',
      );
      await expect(colours.getByRole('tabpanel')).toContainText('Built in: #00e5ff.');
      await tabs.getByRole('tab', { name: /^Light theme/ }).click();

      // A readable one is saved, and the page takes it at once.
      await panel.getByLabel('Primary', { exact: true }).fill('#0f5c5c');
      await expect(tabs.getByRole('tab', { name: 'Light theme' })).toBeVisible();
      await page.getByRole('button', { name: 'Save' }).click();
      await expect(page.getByText('The settings were saved.')).toBeVisible();
      await expect(page.locator('link[rel="stylesheet"][href*="theme.css?v="]')).toHaveCount(1);
      await page.emulateMedia({ colorScheme: 'light' });
      await expect.poll(() => variable(page, '--color-primary')).toBe('#0f5c5c');

      // The reset of the light theme clears it; after the save the page links no sheet again.
      await panel
        .getByRole('button', { name: 'Reset the light theme to the built-in colours' })
        .click();
      await expect(panel.getByLabel('Primary', { exact: true })).toHaveValue('');
      await page.getByRole('button', { name: 'Save' }).click();
      await expect(page.locator('link[href*="theme.css"]')).toHaveCount(0);
      await expect.poll(() => variable(page, '--color-primary')).toBe('#006da8');
    } finally {
      await restore();
      await api.dispose();
    }
  });
});
