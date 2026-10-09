// What every component spec shares: opening a scene of the harness, and the two checks each of them makes
// in both themes: no serious axe violation, and no Content-Security-Policy violation (the harness page has
// the application's policy). A component's spec has a test tagged `[component:<Name>] keyboard` and one tagged
// `[component:<Name>] axe`; `coverage.test.ts` fails for a component of ui-kit that lacks either.
import { expect, test as base, type Page } from '@playwright/test';
import { violations } from '../support/a11y.ts';

export { expect };

interface SceneOptions {
  theme?: 'light' | 'dark';
  lang?: 'en' | 'de';
  query?: string;
}

export const test = base.extend<{ scene: (name: string, options?: SceneOptions) => Promise<void> }>(
  {
    scene: async ({ page }, use) => {
      await page.addInitScript(() => {
        const found: string[] = [];
        (window as unknown as { __csp: string[] }).__csp = found;
        document.addEventListener('securitypolicyviolation', (event) =>
          found.push(
            `${event.violatedDirective}: ${event.blockedURI} ${event.sourceFile}:${event.lineNumber} ${event.sample}`,
          ),
        );
      });
      // A colour that is still fading in when axe looks is not what a visitor sees.
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await use(async (name, options = {}) => {
        const params = new URLSearchParams({ scene: name });
        if (options.theme) params.set('theme', options.theme);
        if (options.lang) params.set('lang', options.lang);
        await page.emulateMedia({ colorScheme: options.theme ?? 'light', reducedMotion: 'reduce' });
        await page.goto(`/?${params.toString()}${options.query ? `&${options.query}` : ''}`);
        await expect(page.locator('main[data-scene]')).toBeVisible();
      });
      const csp = await page.evaluate(
        () => (window as unknown as { __csp?: string[] }).__csp ?? [],
      );
      expect(csp, 'the page broke its Content-Security-Policy').toEqual([]);
    },
  },
);

/** Both themes, with the page in the state `prepare` leaves it in. */
export function inBothThemes(
  title: string,
  name: string,
  prepare: (page: Page) => Promise<void> = () => Promise.resolve(),
  query?: string,
) {
  for (const theme of ['light', 'dark'] as const) {
    test(`${title}, ${theme} theme`, async ({ page, scene }) => {
      await scene(name, { theme, query });
      await prepare(page);
      expect(await violations(page)).toEqual([]);
    });
  }
}
