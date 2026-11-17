import { violations } from './support/a11y.ts';
import { adminApi } from './support/admin.ts';
import { admin, expect, signInThroughPage, test } from './support/fixtures.ts';
import { setLook } from './support/services.ts';

// The start page (M12a): a visitor gets an introduction ("What is Scorpion?"); a signed-in person gets the dashboard at the
// full width, with no banner above it.
test.describe('the start page', () => {
  test('introduces the software to a visitor, with the ways in, and has no serious accessibility violation', async ({
    page,
    at,
  }) => {
    await page.goto(at('/'));
    await expect(page.getByRole('heading', { level: 1, name: /^What is .+\?$/ })).toBeVisible();
    await expect(page.getByRole('heading', { level: 2, name: 'What it offers' })).toBeVisible();
    await expect(page.getByRole('heading', { level: 2, name: 'How it works' })).toBeVisible();
    const main = page.getByRole('main');
    await expect(main.getByRole('link', { name: 'Browse the service catalogue' })).toHaveAttribute(
      'href',
      at('/catalog/services'),
    );
    await expect(main.getByRole('link', { name: 'Sign in' })).toHaveAttribute('href', at('/login'));
    await expect(main.getByRole('link', { name: 'Create an account' })).toHaveAttribute(
      'href',
      at('/register'),
    );
    expect(await violations(page), 'the introduction').toEqual([]);
  });

  test('shows a signed-in person the dashboard at the full width and no introduction', async ({
    page,
    at,
  }) => {
    await page.setViewportSize({ width: 1700, height: 900 });
    await signInThroughPage(page, at, admin);
    await page.goto(at('/'));
    await expect(page.getByRole('heading', { level: 1, name: /^What is/ })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Customise dashboard' })).toBeVisible();
    const box = await page.getByRole('main').boundingBox();
    // The column of other pages is 1152 px; the start page uses what the sidebar leaves.
    expect(box!.width).toBeGreaterThan(1300);
    // Another page keeps its readable column.
    await page.goto(at('/profile'));
    const other = await page.getByRole('main').boundingBox();
    expect(other!.width).toBeLessThanOrEqual(1152);
  });

  // The filters beside the table are the look `sidebar` (sprint 3 of M12a: the default of a new instance is
  // `combined`, one box above the table); the test chooses it and puts back the look it replaced.
  test('uses the full width for the service catalogue, with the filters in the left column', async ({
    page,
    playwright,
    baseURL,
    at,
  }) => {
    const api = await adminApi(playwright, baseURL, at);
    const replaced = await setLook(api, 'sidebar');
    await page.setViewportSize({ width: 1700, height: 900 });
    await signInThroughPage(page, at, admin);
    await page.goto(at('/services'));
    await expect(page.getByRole('heading', { level: 1, name: 'Services' })).toBeVisible();
    const main = (await page.getByRole('main').boundingBox())!;
    expect(main.width).toBeGreaterThan(1300);
    const filters = (await page.getByRole('region', { name: 'Filters' }).boundingBox())!;
    const table = (await page.getByRole('table').boundingBox())!;
    // The filters sit beside the table, on its left, not above it.
    expect(filters.x + filters.width).toBeLessThanOrEqual(table.x);
    // The look it replaced (on a new instance `combined`, one box above the table) uses the full width as well.
    await setLook(api, replaced);
    await page.reload();
    await expect(page.locator(`[data-facet-look="${replaced}"]`)).toBeVisible();
    expect((await page.getByRole('table').boundingBox())!.width).toBeGreaterThan(1200);
    await api.dispose();
  });
});
