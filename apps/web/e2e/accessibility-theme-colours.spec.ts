import type { Page } from '@playwright/test';
import { violations } from './support/a11y.ts';
import { adminApi } from './support/admin.ts';
import { admin, expect, signIn, test } from './support/fixtures.ts';
import { sharedCatalogue } from './support/services.ts';
import { applyThemeColours, CUSTOM_COLOURS } from './support/theme.ts';

// M12a sprint 4: with a custom set of theme colours applied (ADR-0051), no serious or critical axe violation on the pages that draw
// colour, in both themes: the start page, the catalogues with their stage badges, a service page, the dashboard, the administration
// (the colour editor and its preview among it), signed out and signed in. Each test puts back the colours it replaced.

test.use({ reducedMotion: 'reduce' });

const SIGNED_OUT = ['/', '/login', '/register', '/catalog/services', '/docs'];
const SIGNED_IN = [
  '/',
  '/services',
  '/organisations',
  '/admin/users',
  '/admin/settings',
  '/admin/settings/branding',
  '/profile',
  '/inbox',
];

async function check(page: Page, at: (path: string) => string, paths: string[]) {
  const found: string[] = [];
  for (const path of paths) {
    await page.goto(at(path));
    await page.waitForLoadState('networkidle');
    found.push(...(await violations(page)).map((line) => `${path} ${line}`));
  }
  return found;
}

for (const scheme of ['light', 'dark'] as const) {
  test(`a custom set of theme colours, ${scheme} theme: no serious violation, signed out and signed in`, async ({
    browser,
    playwright,
    baseURL,
    at,
  }) => {
    test.slow();
    const api = await adminApi(playwright, baseURL, at);
    // The catalogue the accessibility spec of the services reads (seeded once per stack, not per run).
    const catalogue = await sharedCatalogue(api, baseURL!, 'a11y');
    const { restore } = await applyThemeColours(api);
    const context = await browser.newContext({ baseURL, colorScheme: scheme });
    try {
      const page = await context.newPage();
      await page.goto(at('/'));
      // The custom set is what the page draws.
      const primary = await page.evaluate(() =>
        getComputedStyle(document.documentElement).getPropertyValue('--color-primary').trim(),
      );
      expect(primary).toBe(CUSTOM_COLOURS[scheme].primary);

      const found = await check(page, at, [
        ...SIGNED_OUT,
        `/catalog/services/${catalogue.alpha.slug}`,
      ]);
      await signIn(context.request, at, admin);
      found.push(
        ...(await check(page, at, [
          ...SIGNED_IN,
          `/services/${catalogue.zeta.id}`,
          `/services?q=${encodeURIComponent(catalogue.tag)}`,
        ])),
      );
      expect(found).toEqual([]);
    } finally {
      await context.close();
      await restore();
      await api.dispose();
    }
  });
}
