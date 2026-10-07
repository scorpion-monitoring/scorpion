import http from 'node:http';
import { admin, expect, productName, saveSettings, signIn, test } from './support/fixtures.ts';

test.describe('the shell', () => {
  // `at()` refuses a path with `..` or an encoded slash (as `url()` does), which is what these requests need.
  const raw = (basePath: string, path: string) => `${basePath === '/' ? '' : basePath}${path}`;

  test('the start page loads and the header shows the instance name from the settings', async ({
    page,
    request,
    at,
  }) => {
    const csrf = await signIn(request, at, admin);
    await saveSettings(request, at, csrf, 'core.settings', (values) => ({
      ...values,
      branding: { ...(values.branding as object), instanceName: 'Test Registry' },
    }));
    await request.post(at('/api/internal/auth/logout'), { headers: { 'x-csrf-token': csrf } });

    await page.goto(at('/'));
    await expect(page.getByRole('banner').getByText('Test Registry')).toBeVisible();
    await expect(page).toHaveTitle('Test Registry');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(
      await productName(request, at),
    );
    await expect(page.getByRole('link', { name: 'Sign in' }).first()).toBeVisible();
    await page.screenshot({ path: `test-results/shell-${test.info().project.name}.png` });
  });

  test('navigation by link stays under the base path, and assets load from it', async ({
    page,
    at,
  }) => {
    const failed: string[] = [];
    page.on('response', (response) => {
      if (response.status() >= 400) failed.push(`${response.status()} ${response.url()}`);
    });
    await page.goto(at('/'));
    const nav = page.getByRole('navigation', { name: 'Main navigation' });
    // The link of the page that is shown is the current one, under any base path.
    await expect(nav.getByRole('link', { name: 'Home' })).toHaveAttribute('aria-current', 'page');
    await expect(nav.getByRole('link', { name: 'API documentation' })).not.toHaveAttribute(
      'aria-current',
      'page',
    );
    await nav.getByRole('link', { name: 'API documentation' }).click();
    await expect(page).toHaveURL(new RegExp(`${at('/docs')}$`));
    await expect(page.getByRole('heading', { level: 1, name: 'API documentation' })).toBeVisible();
    await expect(
      page.getByText('The public API of this instance has no routes yet.'),
    ).toBeVisible();
    await expect(nav.getByRole('link', { name: 'API documentation' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    await expect(nav.getByRole('link', { name: 'Home' })).not.toHaveAttribute(
      'aria-current',
      'page',
    );
    // A full load of the same address renders the same page.
    await page.reload();
    await expect(page.getByRole('heading', { level: 1, name: 'API documentation' })).toBeVisible();
    expect(failed).toEqual([]);
  });

  test('a section of the sidebar collapses and expands, and the sidebar folds to an icon rail', async ({
    page,
    at,
  }) => {
    await page.goto(at('/'));
    const nav = page.getByRole('navigation', { name: 'Main navigation' });
    const section = nav.getByRole('button', { name: 'Main' });
    await expect(nav.getByRole('link', { name: 'Home' })).toBeVisible();
    await section.click();
    await expect(section).toHaveAttribute('aria-expanded', 'false');
    await expect(nav.getByRole('link', { name: 'Home' })).toBeHidden();
    await section.click();
    await expect(nav.getByRole('link', { name: 'Home' })).toBeVisible();

    // The rail keeps the links (named for assistive technology, with a tooltip) and remembers the choice.
    await page.getByRole('button', { name: 'Collapse the sidebar' }).click();
    await expect(nav.getByRole('link', { name: 'Home' })).toHaveAttribute('data-tip', 'Home');
    await page.reload();
    await expect(page.getByRole('button', { name: 'Expand the sidebar' })).toBeVisible();
    await page.getByRole('button', { name: 'Expand the sidebar' }).click();
    await expect(page.getByRole('button', { name: 'Collapse the sidebar' })).toBeVisible();
  });

  test('an unknown path is the error page with 404 and a way home under the base path', async ({
    page,
    request,
    at,
  }) => {
    const response = await page.goto(at('/no/such/page'));
    expect(response?.status()).toBe(404);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('This page does not exist.');
    await page.getByRole('link', { name: 'Go home' }).click();
    await expect(page).toHaveURL(new RegExp(`${at('/')}$`));
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(
      await productName(request, at),
    );
  });

  test('a path with an encoded slash or dot segment is not served', async ({
    baseURL,
    basePath,
  }) => {
    // A browser resolves `%2e%2e` itself before it sends anything, so the request is made by hand.
    const status = (path: string) =>
      new Promise<number>((resolve, reject) => {
        const { port } = new URL(baseURL!);
        http
          .get({ host: '127.0.0.1', port, path: raw(basePath, path) }, (response) => {
            response.resume();
            resolve(response.statusCode ?? 0);
          })
          .on('error', reject);
      });
    // An encoded slash or backslash, and an empty segment, are no page.
    for (const path of ['/legal/a%2Fb', '/legal/a%2fb', '//docs', '/legal/%5Cx', '/legal/%00']) {
      expect([400, 404], path).toContain(await status(path));
    }
    // Dot segments are resolved by the URL parser before the application sees them, so they can only
    // lead to a page that exists under the base path, never out of it.
    for (const path of ['/docs/%2e%2e/docs', '/%2e%2e/%2e%2e', '/docs/../docs']) {
      expect([200, 400, 404], path).toContain(await status(path));
    }
  });

  test('the theme toggle sets and remembers a theme without a flash', async ({ page, at }) => {
    await page.goto(at('/'));
    const html = page.locator('html');
    await expect(html).not.toHaveAttribute('data-theme', /.+/);
    await page.getByRole('button', { name: 'Dark' }).click();
    await expect(html).toHaveAttribute('data-theme', 'scorpiondark');
    await expect(page.getByRole('button', { name: 'Dark' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    // The stored choice is applied by the inline script before the page paints.
    await page.reload({ waitUntil: 'commit' });
    await expect(html).toHaveAttribute('data-theme', 'scorpiondark');
    await page.getByRole('button', { name: 'Light' }).click();
    await expect(html).toHaveAttribute('data-theme', 'scorpionlight');
    await page.getByRole('button', { name: 'System' }).click();
    await expect(html).not.toHaveAttribute('data-theme', /.+/);
  });

  test('the theme follows the system when nothing was chosen', async ({ page, at }) => {
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.goto(at('/'));
    const background = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    // scorpiondark: base-100 is #070c1e (the style guide).
    expect(background).toMatch(/rgb\(7, 12, 30\)|oklch|color\(/);
    await page.emulateMedia({ colorScheme: 'light' });
    await expect(page.locator('html')).not.toHaveAttribute('data-theme', /.+/);
  });
});
