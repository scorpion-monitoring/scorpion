import { activeUser, adminApi, newPerson } from '../support/admin.ts';
import { expect, signInThroughPage, test } from '../support/fixtures.ts';
import { docShot } from '../support/doc-shot.ts';
import {
  choose,
  clearFilters,
  expectChosen,
  expectChosenFacets,
  facetValue,
  LOOKS,
  params,
  range,
  rows,
  sharedCatalogue,
  setLook,
  type Look,
} from '../support/services.ts';

// J08: find services in the catalogue. Moved from services.spec.ts ("journey 2: the catalogue") with every assertion: the
// search, the facets with their counts, the chosen values (badges until sprint 3 of M12a; each look draws them once), the
// sort and the paging; and a service with two consortia, which is
// shown once, and one with none. Each test makes its own services under a tag and searches for it.
// Sprint 3 of M12a: the journey runs once in each look of the filters (the setting `catalogueFilters`), under both
// base paths, with the same steps; the helpers of support/services.ts do each step in the look on the page.
for (const look of LOOKS) {
  test.describe(`J08: find services in the catalogue (look ${look})`, () => {
    // The stack is shared by the specs that follow: the look the test replaced is put back.
    let replaced: Look | undefined;
    test.afterEach(async ({ playwright, baseURL, at }) => {
      if (!replaced) return;
      const admin = await adminApi(playwright, baseURL, at);
      await setLook(admin, replaced);
      await admin.dispose();
    });

    test('searches, filters by two facets whose counts follow the filtered set, resets the page, removes a filter, sorts and pages by 20', async ({
      page,
      playwright,
      baseURL,
      at,
    }) => {
      test.slow();
      const api = await adminApi(playwright, baseURL, at);
      const c = await sharedCatalogue(api, baseURL!, 'j08');
      replaced = await setLook(api, look);
      const reader = newPerson('reader');
      await activeUser(api, at, reader);
      await signInThroughPage(page, at, reader);

      await test.step('Open the catalogue from the navigation and search by name', async () => {
        // The navigation leads to the catalogue, and the search narrows it to this journey's services.
        await page.getByRole('link', { name: 'Services' }).first().click();
        await expect(page.getByRole('heading', { name: 'Services', level: 1 })).toBeVisible();
        // The search runs as one types (sprint 3 of M12a): no button.
        await page.getByLabel('Search by name or short name').fill(c.tag);
        await expect(page).toHaveURL(new RegExp(`q=${c.tag}`));
      });
      await test.step('Page through the results, 20 to a page', async () => {
        // 20 to a page by default: the first page is full, the second holds the other four.
        await expect(rows(page)).toHaveCount(20);
        await range(page, `1–20 of ${c.total}`);
        await page.getByRole('button', { name: 'Next' }).click();
        await expect(rows(page)).toHaveCount(4);
        await range(page, `21–24 of ${c.total}`);
        expect(params(page).get('page')).toBe('1');
      });

      await test.step('Filter by stage and see the page start again', async () => {
        // A facet resets the page: the filter is in the address and the page is not.
        await choose(page, 'Stage', /^Production/);
        await expect(page).toHaveURL(/f\.stage=PROD/);
        expect(params(page).get('page')).toBeNull();
        await expect(rows(page)).toHaveCount(20);
        await range(page, `1–20 of ${c.total - 1}`);
        await expectChosen(page, 'Stage', /^Production/);
        await expect(page.locator('[data-facet-count]')).toContainText(
          `${c.total - 1} services match`,
        );
      });
      await test.step('Read the counts of the other facets over the filtered set', async () => {
        // Zeta is the only service in development: it is not in the list now, and the stage facet still counts
        // it (a facet counts over the set the *other* facets leave). In the consortium facet, which counts over
        // production, consortium A has the 22 fillers and "No consortium" has Alpha; consortium B (Zeta's) has no
        // service in production, so it is not offered at all.
        await expect(await facetValue(page, 'Stage', /^Development \(1\)/)).toBeVisible();
        await expect(
          await facetValue(page, 'Consortium', new RegExp(`^${c.consortia[0].name} \\(22\\)`)),
        ).toBeVisible();
        await expect(await facetValue(page, 'Consortium', /^No consortium \(1\)/)).toBeVisible();
        await expect(
          await facetValue(page, 'Consortium', new RegExp(`^${c.consortia[1].name} `)),
        ).toHaveCount(0);
        if (look === 'combined') await docShot(page, 'j08', 'facet-counts');
      });

      await test.step('Remove the filter', async () => {
        // A chosen value comes off with one click, and the page goes back to what it was.
        await choose(page, 'Stage', /^Production/, false);
        await expect(page).not.toHaveURL(/f\.stage/);
        await expect(rows(page)).toHaveCount(20);
        await range(page, `1–20 of ${c.total}`);
      });

      await test.step('Combine two facets', async () => {
        // A second facet over the first: development, then consortium B. Zeta is the one service that has both,
        // and now consortium B is offered, with the count of the development set.
        await choose(page, 'Stage', /^Development/);
        await expect(rows(page)).toHaveCount(1);
        await expect(
          await facetValue(page, 'Consortium', new RegExp(`^${c.consortia[1].name} \\(1\\)`)),
        ).toBeVisible();
        await expect(
          await facetValue(page, 'Consortium', new RegExp(`^${c.consortia[0].name} \\(1\\)`)),
        ).toBeVisible();
        await choose(page, 'Consortium', new RegExp(`^${c.consortia[1].name} `));
        await expect(rows(page)).toHaveCount(1);
        await expect(rows(page).first()).toContainText(`${c.tag} Zeta`);
        await expectChosenFacets(page, 2);
      });
      await test.step('Take the filters off one by one', async () => {
        // The stage facet ignores its own choice: over consortium B it still counts Development, and Production
        // has nothing there. Taking the consortium off leaves the stage filter.
        await choose(page, 'Consortium', new RegExp(`^${c.consortia[1].name} `), false);
        await expect(page).not.toHaveURL(/f\.consortium/);
        await expect(page).toHaveURL(/f\.stage=DEV/);
        await choose(page, 'Stage', /^Development/, false);
        await expect(page).not.toHaveURL(/f\./);
        await expect(rows(page)).toHaveCount(20);
      });

      await test.step('Open a filter that matches nothing', async () => {
        // A chosen value that nothing in the set has is shown with 0 (and a made-up combination matches nothing):
        // Zeta is in development and has consortia, so "No consortium" in development is empty.
        await page.goto(at(`/services?q=${c.tag}&f.stage=DEV&f.consortium=:none`));
        await expect(page.getByText('No service matches.')).toBeVisible();
        await expectChosen(page, 'Stage', /^Development \(0\)/);
        await expectChosen(page, 'Consortium', /^No consortium \(0\)/);
        await page.goto(at(`/services?q=${c.tag}`));
        await expect(rows(page)).toHaveCount(20);
      });

      const nameHeader = page.getByRole('columnheader', { name: /Service/ });
      await test.step('Sort by name and keep the sort after a reload', async () => {
        // Sorting is the server's. The table starts sorted by name, ascending, so the first click on the heading
        // turns it round: descending, Zeta first; the sort is in the address and a reload keeps it.
        await expect(nameHeader).toHaveAttribute('aria-sort', 'ascending');
        await expect(rows(page).first()).toContainText(`${c.tag} Alpha`);
        await page.getByRole('button', { name: /^Service/ }).click();
        await expect(page).toHaveURL(/dir=desc/);
        await expect(nameHeader).toHaveAttribute('aria-sort', 'descending');
        await expect(rows(page).first()).toContainText(`${c.tag} Zeta`);
        await page.reload();
        await expect(page.getByRole('columnheader', { name: /Service/ })).toHaveAttribute(
          'aria-sort',
          'descending',
        );
        await expect(rows(page).first()).toContainText(`${c.tag} Zeta`);
        await page.getByRole('button', { name: /^Service/ }).click();
        await expect(page).not.toHaveURL(/dir=/);
        await expect(nameHeader).toHaveAttribute('aria-sort', 'ascending');
        await expect(rows(page).first()).toContainText(`${c.tag} Alpha`);
      });
      await test.step('Sort by the organisation that runs the service', async () => {
        // By the provider's name: provider A (Zeta and the fillers) comes before provider B (Alpha), so Alpha is
        // first when the order is turned round.
        const ownerHeader = page.getByRole('columnheader', { name: /Operated by/ });
        await page.getByRole('button', { name: /^Operated by/ }).click();
        await expect(ownerHeader).toHaveAttribute('aria-sort', 'ascending');
        await expect(page).toHaveURL(/sort=provider/);
        await expect(rows(page).first()).not.toContainText(`${c.tag} Alpha`);
        await range(page, `1–20 of ${c.total}`);
        await page.getByRole('button', { name: /^Operated by/ }).click();
        await expect(ownerHeader).toHaveAttribute('aria-sort', 'descending');
        await expect(rows(page).first()).toContainText(`${c.tag} Alpha`);
      });
      await api.dispose();
    });

    test('shows a service with two consortia once, and a service with none, and filters to either', async ({
      page,
      playwright,
      baseURL,
      at,
    }) => {
      test.slow();
      const api = await adminApi(playwright, baseURL, at);
      const c = await sharedCatalogue(api, baseURL!, 'j08');
      replaced = await setLook(api, look);
      const reader = newPerson('reader');
      await activeUser(api, at, reader);
      await signInThroughPage(page, at, reader);

      await test.step('Open the catalogue with every service of the tag', async () => {
        await page.goto(at(`/services?q=${c.tag}&sort=name&pageSize=50`));
        await expect(rows(page)).toHaveCount(c.total);
      });
      await test.step('Find a service with two consortia once, and one with none', async () => {
        // Zeta: once in the table, with both its consortia as badges.
        const zeta = rows(page).filter({ hasText: `${c.tag} Zeta` });
        await expect(zeta).toHaveCount(1);
        await expect(zeta).toContainText(c.consortia[0].abbreviation);
        await expect(zeta).toContainText(c.consortia[1].abbreviation);
        // Alpha has no consortium and is in the table all the same.
        const alpha = rows(page).filter({ hasText: `${c.tag} Alpha` });
        await expect(alpha).toHaveCount(1);
        await expect(alpha.getByRole('listitem')).toHaveCount(0);
      });
      await test.step('Read the number of services per consortium', async () => {
        // Each consortium counts Zeta once: A has the 22 fillers and Zeta, B has Zeta; "No consortium" has Alpha.
        await expect(
          await facetValue(page, 'Consortium', new RegExp(`^${c.consortia[0].name} \\(23\\)`)),
        ).toBeVisible();
        await expect(
          await facetValue(page, 'Consortium', new RegExp(`^${c.consortia[1].name} \\(1\\)`)),
        ).toBeVisible();
        await expect(await facetValue(page, 'Consortium', /^No consortium \(1\)/)).toBeVisible();
      });
      await test.step('Choose both consortia', async () => {
        // Both consortia chosen: Zeta once and the 22 fillers (consortium A), never Alpha.
        await choose(page, 'Consortium', new RegExp(`^${c.consortia[0].name} `));
        await choose(page, 'Consortium', new RegExp(`^${c.consortia[1].name} `));
        await expect(rows(page)).toHaveCount(23);
        await expect(rows(page).filter({ hasText: `${c.tag} Zeta` })).toHaveCount(1);
        await expect(rows(page).filter({ hasText: `${c.tag} Alpha` })).toHaveCount(0);
      });
      await test.step('Narrow to one consortium, then to services with none', async () => {
        // Consortium B alone is exactly Zeta; "No consortium" alone is exactly Alpha.
        await choose(page, 'Consortium', new RegExp(`^${c.consortia[0].name} `), false);
        await expect(rows(page)).toHaveCount(1);
        await expect(rows(page).first()).toContainText(`${c.tag} Zeta`);
        await clearFilters(page);
        await choose(page, 'Consortium', /^No consortium/);
        await expect(rows(page)).toHaveCount(1);
        await expect(rows(page).first()).toContainText(`${c.tag} Alpha`);
      });
      await api.dispose();
    });
  });
}
