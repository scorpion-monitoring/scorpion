import type { Page } from '@playwright/test';
import { activeUser, adminApi, newPerson } from './support/admin.ts';
import { admin, expect, signInThroughPage, test } from './support/fixtures.ts';
import { seedCatalogue } from './support/services.ts';

// M7 sprint 4, journey 2 (plan §10 item 8): the catalogue. A person searches, chooses a facet and a second
// facet (the counts change over the filtered set), sees the page reset, removes a filter badge by a click,
// sorts, pages 20 to a page, and finds a service with two consortia once and a service with none as well (the
// defect-2 journey). Each test makes its own organisations, services and account under a tag of its own and
// searches for it, so the counts it reads are its own whatever other specs left in the database.

const rows = (page: Page) => page.getByRole('row').filter({ has: page.getByRole('rowheader') });
const range = (page: Page, text: string | RegExp) =>
  expect(page.getByRole('status').filter({ hasText: /–.* of / })).toContainText(text);
const params = (page: Page) => new URL(page.url()).searchParams;

/** The checkbox of a facet value, named by its label and count: `Development (1)`. */
const choice = (page: Page, label: string | RegExp) => page.getByRole('checkbox', { name: label });

test.describe('journey 2: the catalogue', () => {
  test('searches, filters by two facets whose counts follow the filtered set, resets the page, removes a badge, sorts and pages by 20', async ({
    page,
    playwright,
    baseURL,
    at,
  }) => {
    test.slow();
    const api = await adminApi(playwright, baseURL, at);
    const c = await seedCatalogue(api);
    const reader = newPerson('reader');
    await activeUser(api, at, reader);
    await signInThroughPage(page, at, reader);

    // The navigation leads to the catalogue, and the search narrows it to this journey's services.
    await page.getByRole('link', { name: 'Services' }).first().click();
    await expect(page.getByRole('heading', { name: 'Services', level: 1 })).toBeVisible();
    await page.getByLabel('Search by name or short name').fill(c.tag);
    await page.getByRole('button', { name: 'Search', exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`q=${c.tag}`));
    // 20 to a page by default: the first page is full, the second holds the other four.
    await expect(rows(page)).toHaveCount(20);
    await range(page, `1–20 of ${c.total}`);
    await page.getByRole('button', { name: 'Next' }).click();
    await expect(rows(page)).toHaveCount(4);
    await range(page, `21–24 of ${c.total}`);
    expect(params(page).get('page')).toBe('1');

    // A facet resets the page: the filter is in the address and the page is not.
    await choice(page, /^Production/).check();
    await expect(page).toHaveURL(/f\.stage=PROD/);
    expect(params(page).get('page')).toBeNull();
    await expect(rows(page)).toHaveCount(20);
    await range(page, `1–20 of ${c.total - 1}`);
    await expect(
      page.getByRole('button', { name: 'Remove the filter Stage: Production' }),
    ).toBeVisible();
    // Zeta is the only service in development: it is not in the list now, and the stage facet still counts
    // it (a facet counts over the set the *other* facets leave). In the consortium facet, which counts over
    // production, consortium A has the 22 fillers and "No consortium" has Alpha; consortium B (Zeta's) has no
    // service in production, so it is not offered at all.
    await expect(choice(page, /^Development \(1\)/)).toBeVisible();
    await expect(choice(page, new RegExp(`^${c.consortia[0].name} \\(22\\)`))).toBeVisible();
    await expect(choice(page, /^No consortium \(1\)/)).toBeVisible();
    await expect(choice(page, new RegExp(`^${c.consortia[1].name} `))).toHaveCount(0);

    // A badge comes off with one click, and the page goes back to what it was.
    await page.getByRole('button', { name: 'Remove the filter Stage: Production' }).click();
    await expect(page).not.toHaveURL(/f\.stage/);
    await expect(rows(page)).toHaveCount(20);
    await range(page, `1–20 of ${c.total}`);

    // A second facet over the first: development, then consortium B. Zeta is the one service that has both,
    // and now consortium B is offered, with the count of the development set.
    await choice(page, /^Development/).check();
    await expect(rows(page)).toHaveCount(1);
    await expect(choice(page, new RegExp(`^${c.consortia[1].name} \\(1\\)`))).toBeVisible();
    await expect(choice(page, new RegExp(`^${c.consortia[0].name} \\(1\\)`))).toBeVisible();
    await choice(page, new RegExp(`^${c.consortia[1].name} `)).check();
    await expect(rows(page)).toHaveCount(1);
    await expect(rows(page).first()).toContainText(`${c.tag} Zeta`);
    await expect(page.getByRole('button', { name: /^Remove the filter/ })).toHaveCount(2);
    // The stage facet ignores its own choice: over consortium B it still counts Development, and Production
    // has nothing there. Taking the consortium badge off leaves the stage filter.
    await page
      .getByRole('button', { name: new RegExp(`Remove the filter .*: ${c.consortia[1].name}`) })
      .click();
    await expect(page).not.toHaveURL(/f\.consortium/);
    await expect(page).toHaveURL(/f\.stage=DEV/);
    await page.getByRole('button', { name: /^Remove the filter Stage/ }).click();
    await expect(page).not.toHaveURL(/f\./);
    await expect(rows(page)).toHaveCount(20);

    // A chosen value that nothing in the set has is shown with 0 (and a made-up combination matches nothing):
    // Zeta is in development and has consortia, so "No consortium" in development is empty.
    await page.goto(at(`/services?q=${c.tag}&f.stage=DEV&f.consortium=:none`));
    await expect(page.getByText('No service matches.')).toBeVisible();
    await expect(choice(page, /^Development \(0\)/)).toBeChecked();
    await expect(choice(page, /^No consortium \(0\)/)).toBeChecked();
    await page.goto(at(`/services?q=${c.tag}`));
    await expect(rows(page)).toHaveCount(20);

    // Sorting is the server's. The table starts sorted by name, ascending, so the first click on the heading
    // turns it round: descending, Zeta first; the sort is in the address and a reload keeps it.
    const nameHeader = page.getByRole('columnheader', { name: /Service/ });
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
    const c = await seedCatalogue(api);
    const reader = newPerson('reader');
    await activeUser(api, at, reader);
    await signInThroughPage(page, at, reader);

    await page.goto(at(`/services?q=${c.tag}&sort=name&pageSize=50`));
    await expect(rows(page)).toHaveCount(c.total);
    // Zeta: once in the table, with both its consortia as badges.
    const zeta = rows(page).filter({ hasText: `${c.tag} Zeta` });
    await expect(zeta).toHaveCount(1);
    await expect(zeta).toContainText(c.consortia[0].abbreviation);
    await expect(zeta).toContainText(c.consortia[1].abbreviation);
    // Alpha has no consortium and is in the table all the same.
    const alpha = rows(page).filter({ hasText: `${c.tag} Alpha` });
    await expect(alpha).toHaveCount(1);
    await expect(alpha.getByRole('listitem')).toHaveCount(0);

    // Each consortium counts Zeta once: A has the 22 fillers and Zeta, B has Zeta; "No consortium" has Alpha.
    await expect(choice(page, new RegExp(`^${c.consortia[0].name} \\(23\\)`))).toBeVisible();
    await expect(choice(page, new RegExp(`^${c.consortia[1].name} \\(1\\)`))).toBeVisible();
    await expect(choice(page, /^No consortium \(1\)/)).toBeVisible();

    // Both consortia chosen: Zeta once and the 22 fillers (consortium A), never Alpha.
    await choice(page, new RegExp(`^${c.consortia[0].name} `)).check();
    await choice(page, new RegExp(`^${c.consortia[1].name} `)).check();
    await expect(rows(page)).toHaveCount(23);
    await expect(rows(page).filter({ hasText: `${c.tag} Zeta` })).toHaveCount(1);
    await expect(rows(page).filter({ hasText: `${c.tag} Alpha` })).toHaveCount(0);

    // Consortium B alone is exactly Zeta; "No consortium" alone is exactly Alpha.
    await choice(page, new RegExp(`^${c.consortia[0].name} `)).uncheck();
    await expect(rows(page)).toHaveCount(1);
    await expect(rows(page).first()).toContainText(`${c.tag} Zeta`);
    await page.getByRole('button', { name: /^Clear all filters/ }).click();
    await choice(page, /^No consortium/).check();
    await expect(rows(page)).toHaveCount(1);
    await expect(rows(page).first()).toContainText(`${c.tag} Alpha`);
    await api.dispose();
  });

  test('shows a service of another provider by its licence, and says so when nothing matches a search', async ({
    page,
    playwright,
    baseURL,
    at,
  }) => {
    const api = await adminApi(playwright, baseURL, at);
    const c = await seedCatalogue(api);
    await signInThroughPage(page, at, admin);
    await page.goto(at(`/services?q=${c.tag}`));
    // The licence facet: one service has MIT, the others have none ("Unknown").
    await expect(choice(page, /^MIT \(1\)/)).toBeVisible();
    await expect(choice(page, /^Unknown \(23\)/)).toBeVisible();
    await choice(page, /^MIT/).check();
    await expect(rows(page)).toHaveCount(1);
    await expect(rows(page).first()).toContainText(`${c.tag} Alpha`);
    await expect(rows(page).first()).toContainText(c.providers[1].name);
    // Nothing matches a search for something else: the empty state, and a way back.
    await page.getByLabel('Search by name or short name').fill(`${c.tag}-no-such-service`);
    await page.getByRole('button', { name: 'Search', exact: true }).click();
    await expect(page.getByText('No service matches.')).toBeVisible();
    await api.dispose();
  });

  test('answers a made-up filter in the address with an error, not an empty list', async ({
    page,
    at,
  }) => {
    await signInThroughPage(page, at, admin);
    const response = await page.goto(at('/services?f.stage=NO-SUCH-STAGE'));
    expect(response?.status()).toBe(422);
  });
});
