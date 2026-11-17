import { expect, test } from './support/fixtures.ts';

// The built-in logos and the footer (M12a, sprint 1, item 7), for a visitor who is not signed in, under both base paths.
test.describe('the default logos and the footer', () => {
  test('draw the built-in logos from the web app, under the base path, until an operator uploads one', async ({
    page,
    at,
    baseURL,
  }) => {
    const bad: string[] = [];
    page.on('response', (response) => {
      if (response.status() >= 400) bad.push(`${response.status()} ${response.url()}`);
    });
    await page.goto(at('/'));
    for (const theme of ['logo-light', 'logo-dark']) {
      const image = page.locator(`header img.${theme}`);
      await expect(image).toHaveCount(1);
      const src = (await image.getAttribute('src'))!;
      // A small file is inlined by the build as a data address; a larger one is a hashed asset below the base path.
      expect(src.startsWith('data:image/png') || src.endsWith('.png'), theme).toBe(true);
      expect(src).not.toContain('/api/internal/files/');
      if (src.startsWith('data:')) continue;
      // The address is under the base path of the instance and the file is served with a picture in it.
      const reply = await page.request.get(new URL(src, baseURL).toString());
      expect(reply.status(), src).toBe(200);
      expect(reply.headers()['content-type']).toContain('image/png');
    }
    expect(bad).toEqual([]);
    // Exactly one of the two is shown for a theme.
    const shown = await page
      .locator('header img.logo-light, header img.logo-dark')
      .evaluateAll((images) => images.filter((image) => image.checkVisibility()).length);
    expect(shown).toBe(1);
  });

  test('show the copyright of the instance and the fixed attribution of the software, with a licence link', async ({
    page,
    at,
  }) => {
    await page.goto(at('/'));
    const footer = page.getByRole('contentinfo');
    await expect(footer).toContainText(`© ${new Date().getFullYear()} `);
    const attribution = footer.getByTestId('software-attribution');
    await expect(attribution).toContainText('Powered by Scorpion');
    await expect(attribution).toContainText(/\d+\.\d+\.\d+/);
    await expect(attribution.getByRole('link', { name: 'Scorpion' })).toHaveAttribute(
      'href',
      /^https:\/\/github\.com\/scorpion-monitoring\/scorpion$/,
    );
    await expect(attribution.getByRole('link', { name: 'ISC licence' })).toHaveAttribute(
      'href',
      /\/LICENSE$/,
    );
  });
});
