import { activeUser, adminApi, newPerson } from './support/admin.ts';
import { makeOrg, pageAs, uniqueAbbreviation } from './support/members.ts';
import { expect, test } from './support/fixtures.ts';

// M12a sprint 5 findings: a page button pressed while a search is still loading built its address from the data of the
// page on screen, so "Next" asked for page 2 of the old query. The pager is disabled while a navigation is pending.

test.describe('the pager of the organisation search while a search is loading', () => {
  test('is disabled until the search has loaded, and "Next" then asks for page 2 of the new search', async ({
    browser,
    playwright,
    baseURL,
    at,
  }) => {
    test.slow();
    const api = await adminApi(playwright, baseURL, at);
    const group = uniqueAbbreviation('PGR');
    for (const letter of 'ABCDEF') await makeOrg(api, `${group}${letter}`);
    const who = newPerson('pager');
    await activeUser(api, at, who);
    const person = await pageAs(browser, baseURL, at, who);
    const page = person.page;
    await page.goto(at('/account/organisations'));
    await expect(page.getByRole('heading', { name: 'Organisations', level: 1 })).toBeVisible();

    // Hold back the answer to the search until the test lets it go.
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => (release = resolve));
    await page.route(
      (address) =>
        address.pathname.endsWith('/organisations') && address.searchParams.get('q') === group,
      async (route) => {
        await gate;
        await route.continue();
      },
    );

    await page.getByLabel('Search by abbreviation or name').fill(group);
    await page.getByRole('button', { name: 'Search' }).click();
    const next = page.getByRole('button', { name: 'Next' });
    // Still the page of the unfiltered list on screen, and the pager does not answer.
    await expect(next).toBeDisabled();
    expect(new URL(page.url()).searchParams.get('q')).toBeNull();

    release();
    await page.waitForURL((address) => address.searchParams.get('q') === group);
    await expect(page.getByRole('rowheader')).toHaveCount(5);
    await expect(next).toBeEnabled();
    await next.click();
    await expect(page).toHaveURL((address) => address.searchParams.get('page') === '1');
    expect(new URL(page.url()).searchParams.get('q')).toBe(group);
    await expect(page.getByRole('rowheader')).toHaveCount(1);

    await person.close();
    await api.dispose();
  });
});
