import { admin, expect, saveSettings, signIn, test } from './support/fixtures.ts';

// The legal pages are public, rendered from Markdown on the server and sanitised there. A hostile text
// must show as text or not at all, and no script of it may run (M5 acceptance; ADR-0018).
const HOSTILE = [
  '## Terms',
  '',
  'Be kind.',
  '',
  '<script>window.__pwned = 1</script>',
  '',
  '<img src=x onerror="window.__pwned = 2">',
  '',
  '[click me](javascript:window.__pwned=3)',
  '',
  '[docs](https://example.org/docs)',
].join('\n');

test.describe('the legal pages', () => {
  test('answer 404 with the error page while no text is written (a loader throws, defect 12)', async ({
    page,
    at,
  }) => {
    const response = await page.goto(at('/legal/privacy'));
    expect(response?.status()).toBe(404);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('This page does not exist.');
    // A name that is no legal page is a page that does not exist, not a validation error.
    const other = await page.goto(at('/legal/cookies'));
    expect(other?.status()).toBe(404);
  });

  test('show a hostile text as safe HTML, to a visitor who is not signed in', async ({
    page,
    request,
    at,
  }) => {
    const csrf = await signIn(request, at, admin);
    await saveSettings(request, at, csrf, 'core.settings', (values) => ({
      ...values,
      branding: {
        ...(values.branding as object),
        legal: { terms: HOSTILE, imprint: 'Imprint text.' },
      },
    }));
    await request.post(at('/api/internal/auth/logout'), { headers: { 'x-csrf-token': csrf } });

    await page.goto(at('/'));
    // The footer links to the pages that have a text, and only to those.
    const legal = page.getByRole('navigation', { name: 'Legal' });
    await expect(legal.getByRole('link', { name: 'Terms of use' })).toBeVisible();
    await expect(legal.getByRole('link', { name: 'Imprint' })).toBeVisible();
    await expect(legal.getByRole('link', { name: 'Privacy policy' })).toHaveCount(0);

    await legal.getByRole('link', { name: 'Terms of use' }).click();
    await expect(page).toHaveURL(new RegExp(`${at('/legal/terms')}$`));
    const article = page.locator('article');
    await expect(article.getByRole('heading', { level: 1, name: 'Terms of use' })).toBeVisible();
    await expect(article.getByRole('heading', { level: 2, name: 'Terms' })).toBeVisible();
    await expect(article.getByText('Be kind.')).toBeVisible();
    await expect(article.getByRole('link', { name: 'docs' })).toHaveAttribute(
      'href',
      'https://example.org/docs',
    );

    // Nothing the text carried is alive: no script, no handler, no javascript: link, nothing ran.
    await expect(article.locator('script')).toHaveCount(0);
    await expect(article.locator('[onerror], [onclick], [onload]')).toHaveCount(0);
    await expect(article.locator('img')).toHaveCount(0);
    expect(
      await article.locator('a').evaluateAll((links) => links.map((a) => a.getAttribute('href'))),
    ).not.toContain(expect.stringMatching(/^javascript:/i));
    expect(
      await page.evaluate(() => (window as unknown as { __pwned?: number }).__pwned),
    ).toBeUndefined();
    // The same on a full load, where the server rendered the page.
    await page.reload();
    expect(
      await page.evaluate(() => (window as unknown as { __pwned?: number }).__pwned),
    ).toBeUndefined();
    await expect(article.locator('script, img, [onerror]')).toHaveCount(0);
  });
});
