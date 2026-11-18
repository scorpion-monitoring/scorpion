import { makePng } from '@scorpion/testing';
import { admin, expect, signInThroughPage, test } from './support/fixtures.ts';
import { profileOf } from './support/profile.ts';

// The profile picture beside a name: in the header once it is uploaded, beside the same name in the user table of
// an Admin, and the stand-in icon for an account without one or for a file that does not load.

test.describe('the profile picture beside a name', () => {
  test('shows in the header after the upload and in the user table of an Admin', async ({
    page,
    browser,
    baseURL,
    at,
  }) => {
    const who = await profileOf(page, at, 'ava');
    const menu = page.getByRole('button', { name: 'Account menu' });
    await expect(menu.getByTestId('user-avatar-fallback')).toBeVisible();

    await page.getByLabel('Choose a picture').setInputFiles({
      name: 'me.png',
      mimeType: 'image/png',
      buffer: makePng(32),
    });
    const picture = menu.getByTestId('user-avatar');
    await expect(picture).toBeVisible();
    await expect(picture).toHaveAttribute('alt', '');
    const src = await picture.getAttribute('src');
    expect(src).toMatch(/\/api\/internal\/files\/[0-9a-f]{64}$/);
    await expect.poll(() => picture.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(32);

    const context = await browser.newContext({ baseURL });
    try {
      const other = await context.newPage();
      await signInThroughPage(other, at, admin);
      // The Admin has no picture: the icon stands in.
      await expect(
        other.getByRole('button', { name: 'Account menu' }).getByTestId('user-avatar-fallback'),
      ).toBeVisible();
      await other.goto(at('/admin/users'));
      await other.getByLabel('Search by username or address').fill(who.username);
      await other.getByRole('button', { name: 'Search' }).click();
      const row = other.getByRole('row').filter({ hasText: who.username });
      await expect(row.getByTestId('user-avatar')).toHaveAttribute('src', src!);
    } finally {
      await context.close();
    }
  });

  test('falls back to the icon when the file does not load', async ({
    page,
    browser,
    baseURL,
    at,
  }) => {
    const who = await profileOf(page, at, 'bea');
    await page.getByLabel('Choose a picture').setInputFiles({
      name: 'me.png',
      mimeType: 'image/png',
      buffer: makePng(33),
    });
    await expect(
      page.getByRole('button', { name: 'Account menu' }).getByTestId('user-avatar'),
    ).toBeVisible();

    // A second browser with an empty cache, where every file fails from the first page on.
    const context = await browser.newContext({ baseURL });
    try {
      await context.route('**/api/internal/files/**', (route) => route.abort());
      const other = await context.newPage();
      await signInThroughPage(other, at, who);
      const menu = other.getByRole('button', { name: 'Account menu' });
      await expect(menu.getByTestId('user-avatar-fallback')).toBeVisible();
      await expect(menu.getByTestId('user-avatar')).toHaveCount(0);
      // Also on a page the server renders with the picture in it.
      await other.reload();
      await expect(menu.getByTestId('user-avatar-fallback')).toBeVisible();
    } finally {
      await context.close();
    }
  });
});
