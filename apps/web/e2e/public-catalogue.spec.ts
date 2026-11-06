import { adminApi } from './support/admin.ts';
import { violations } from './support/a11y.ts';
import { expect, test } from './support/fixtures.ts';
import { choice, params, range, rows, seedCatalogue } from './support/services.ts';

// The public list of services (M12a, sprint 1, item 3): an anonymous visitor searches, filters and pages through the
// services that were made public, and never sees a private one. The page lives at `/catalog/services`, the pages
// of one service and of one organisation below it; there is no redirect from `/public/...`.
test.describe('the public service catalogue', () => {
  test('lists only the published services, searches, filters by stage, pages and links to the public pages', async ({
    browser,
    playwright,
    baseURL,
    at,
  }) => {
    test.slow();
    const api = await adminApi(playwright, baseURL, at);
    const c = await seedCatalogue(api);
    // Everything except one filler is published: 23 of 24, the page size is 20.
    const hidden = c.fillers[0]!;
    for (const service of [c.zeta, c.alpha, ...c.fillers.slice(1)]) {
      const made = await api.send('PUT', `/services/${service.id}/publication`, { public: true });
      expect(made.status, JSON.stringify(made.body)).toBe(200);
    }

    const visitor = await browser.newContext({ baseURL, reducedMotion: 'reduce' });
    const page = await visitor.newPage();
    await page.goto(at(`/catalog/services?q=${c.tag}`));
    await expect(page.getByRole('heading', { name: 'Service catalogue', level: 1 })).toBeVisible();

    await test.step('Page through the published services only', async () => {
      await expect(rows(page)).toHaveCount(20);
      await range(page, `1–20 of ${c.total - 1}`);
      await page.getByRole('button', { name: 'Next' }).click();
      await expect(rows(page)).toHaveCount(3);
      await range(page, `21–23 of ${c.total - 1}`);
      expect(params(page).get('page')).toBe('1');
      // The one that was not published is on no page.
      await expect(page.getByText(hidden.name)).toHaveCount(0);
    });

    await test.step('Filter by stage and read the counts over the published services', async () => {
      await choice(page, /^Development \(1\)/).check();
      await expect(page).toHaveURL(/f\.stage=DEV/);
      await expect(rows(page)).toHaveCount(1);
      await expect(rows(page).first()).toContainText(c.zeta.name);
      await expect(rows(page).first()).toContainText(c.consortia[1].name);
      await expect(
        page.getByRole('button', { name: 'Remove the filter Stage: Development' }),
      ).toBeVisible();
      await page.getByRole('button', { name: 'Remove the filter Stage: Development' }).click();
      await expect(page).not.toHaveURL(/f\.stage/);
    });

    await test.step('Search by name', async () => {
      await page.getByLabel('Search by name or short name').fill(`${c.tag} Alpha`);
      await page.getByRole('button', { name: 'Search', exact: true }).click();
      await expect(rows(page)).toHaveCount(1);
      await expect(rows(page).first()).toContainText(c.alpha.name);
    });

    await test.step('Open the public page of a service and of its provider', async () => {
      await page.getByRole('link', { name: c.alpha.name }).click();
      await expect(page).toHaveURL(at(`/catalog/services/${c.alpha.slug}`));
      await expect(page.getByRole('heading', { name: c.alpha.name, level: 1 })).toBeVisible();
      await page.getByRole('link', { name: c.providers[1].name }).click();
      await expect(page).toHaveURL(at(`/catalog/organisations/${c.providers[1].id}`));
      await expect(
        page.getByRole('heading', { name: c.providers[1].name, level: 1 }),
      ).toBeVisible();
    });

    await test.step('Meet the 404 of an address nobody has for an unpublished service and for the old address', async () => {
      const privateService = await page.goto(at(`/catalog/services/${hidden.slug}`));
      expect(privateService?.status()).toBe(404);
      const unknown = await page.goto(at(`/catalog/services/${c.tag}-nobody`));
      expect(unknown?.status()).toBe(404);
      // The pages were never shown to people; there is no redirect from the old prefix.
      const old = await page.goto(at(`/public/services/${c.alpha.slug}`));
      expect(old?.status()).toBe(404);
      expect(page.url()).toBe(new URL(at(`/public/services/${c.alpha.slug}`), baseURL).toString());
    });

    await visitor.close();
    await api.dispose();
  });

  test('has no serious accessibility violation, and shows nothing of a session', async ({
    browser,
    playwright,
    baseURL,
    at,
  }) => {
    const api = await adminApi(playwright, baseURL, at);
    const c = await seedCatalogue(api);
    await api.send('PUT', `/services/${c.alpha.id}/publication`, { public: true });
    const visitor = await browser.newContext({ baseURL, reducedMotion: 'reduce' });
    const page = await visitor.newPage();
    await page.goto(at(`/catalog/services?q=${c.tag}`));
    await expect(rows(page)).toHaveCount(1);
    expect(await violations(page), 'the public catalogue').toEqual([]);
    await expect(page.getByRole('button', { name: 'Account menu' })).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'New service' })).toHaveCount(0);
    await visitor.close();
    await api.dispose();
  });
});
