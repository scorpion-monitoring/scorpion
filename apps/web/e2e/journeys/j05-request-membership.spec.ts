import { activeUser, adminApi, newPerson } from '../support/admin.ts';
import { mailTo } from '../support/db.ts';
import {
  makeOrg,
  organisationLink,
  pageAs,
  prefixOf,
  rowOfTable,
  toast,
  uniqueAbbreviation,
  waitingOnCard,
} from '../support/members.ts';
import { admin, expect, test } from '../support/fixtures.ts';
import { docShot } from '../support/doc-shot.ts';

// J05: request membership in a provider. Moved from organisations.spec.ts ("journey 2") with every assertion.
test.describe('J05: request membership in a provider', () => {
  test('searches 5 per page, asks, an Admin approves in a second browser, the mail links under the base path, the person leaves', async ({
    browser,
    playwright,
    baseURL,
    at,
    basePath,
  }) => {
    test.slow();
    const api = await adminApi(playwright, baseURL, at);
    const group = uniqueAbbreviation('SRC');
    const orgs = [];
    for (const letter of 'ABCDEF') orgs.push(await makeOrg(api, `${group}${letter}`));
    const target = orgs[1]!;
    const who = newPerson('joiner');
    await activeUser(api, at, who);

    const person = await pageAs(browser, baseURL, at, who);
    const page = person.page;
    await test.step('Open the page of your organisations', async () => {
      await page.goto(at('/account/organisations'));
      await expect(page.getByRole('heading', { name: 'Organisations', level: 1 })).toBeVisible();
      await expect(page.getByText('You are not a member of any organisation yet.')).toBeVisible();
      await expect(page.getByRole('heading', { name: 'My organisations' })).toHaveCount(0);
    });

    await test.step('Search for an organisation and page through the results', async () => {
      // The search: 5 per page, and a change of the search starts again on the first page.
      const search = page.getByLabel('Search by abbreviation or name');
      await search.fill(group);
      await page.getByRole('button', { name: 'Search' }).click();
      await expect(page.getByRole('rowheader')).toHaveCount(5);
      await page.getByRole('button', { name: 'Next' }).click();
      await expect(page).toHaveURL(/page=1/);
      await expect(page.getByRole('rowheader')).toHaveCount(1);
      await search.fill(target.abbreviation);
      await page.getByRole('button', { name: 'Search' }).click();
      await expect(page).not.toHaveURL(/page=/);
      await expect(page.getByRole('rowheader')).toHaveCount(1);
      await docShot(page, 'j05', 'organisation-search');
    });

    await test.step('Ask to become a member', async () => {
      // Ask: the row says "Pending" at once.
      await page
        .getByRole('button', { name: `Ask to become a member of ${target.abbreviation}` })
        .click();
      await expect(
        rowOfTable(page, target.abbreviation).getByText('Pending', { exact: true }),
      ).toBeVisible();
      await expect(
        page.getByRole('button', { name: `Ask to become a member of ${target.abbreviation}` }),
      ).toHaveCount(0);
      await docShot(page, 'j05', 'membership-pending');
    });

    // The Admin decides in a second browser; the card of the dashboard counts down.
    const boss = await pageAs(browser, baseURL, at, admin);
    let before = 0;
    await test.step('An administrator sees the request on the dashboard card', async () => {
      await boss.page.goto(at('/'));
      await expect.poll(() => waitingOnCard(boss.page)).toBeGreaterThan(0);
      before = (await waitingOnCard(boss.page))!;
    });
    const request = rowOfTable(boss.page, who.username);
    await test.step('An administrator opens the membership requests of the organisation', async () => {
      await boss.page
        .getByRole('region', { name: 'Membership requests' })
        .getByRole('link')
        .click();
      await expect(boss.page).toHaveURL(new RegExp(`${prefixOf(basePath)}/admin/memberships$`));
      await boss.page.getByLabel('Organisation').selectOption({ value: target.id });
      await expect(request.getByText('Pending')).toBeVisible();
    });
    await test.step('An administrator approves the request', async () => {
      await request.getByRole('button', { name: `Approve the request of ${who.username}` }).click();
      await expect(boss.page.getByText(`${who.username} was approved.`).first()).toBeVisible();
      await expect(request).toHaveCount(0);
      await boss.page.goto(at('/'));
      await expect.poll(async () => (await waitingOnCard(boss.page)) ?? 0).toBe(before - 1);
    });
    await boss.close();

    await test.step('Read the decision mail, which links to the organisation', async () => {
      // The requester has the decision mail, with a link under the base path.
      const mail = await mailTo(
        basePath,
        `${who.username}@example.org`,
        'registry.membership-decided',
      );
      expect(mail.text).toContain(target.name);
      expect(organisationLink(mail.text, target.id)).toBe(
        `${prefixOf(basePath)}/organisations/${target.id}`,
      );
    });

    await page.reload();
    const own = page.getByRole('listitem').filter({ hasText: target.abbreviation });
    await test.step('See the organisation as a membership', async () => {
      // An approved row says "Member"; the person leaves after the confirm.
      await expect(own.getByText('Member', { exact: true })).toBeVisible();
    });
    await test.step('Leave the organisation and confirm', async () => {
      await page
        .getByRole('button', { name: `Leave the organisation ${target.abbreviation}` })
        .click();
      const dialog = page.getByRole('dialog', { name: `Leave ${target.name}?` });
      await dialog.getByRole('button', { name: 'Leave the organisation' }).click();
      await expect(toast(page).getByText('You left the organisation.')).toBeVisible();
      await expect(own.getByText('Left', { exact: true })).toBeVisible();
    });
    await person.close();
    await api.dispose();
  });
});
