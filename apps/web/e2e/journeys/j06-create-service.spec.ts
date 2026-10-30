import { makePng } from '@scorpion/testing';
import { adminApi, newPerson, unique } from '../support/admin.ts';
import { expect, test } from '../support/fixtures.ts';
import { makeOrg, memberOf, pageAs, uniqueAbbreviation } from '../support/members.ts';
import { makeConsortium } from '../support/services.ts';

// J06: create a service with the wizard. Moved from services.spec.ts ("journey 1: the create wizard") with every assertion.
test.describe('J06: create a service with the wizard', () => {
  test('a member creates a service: a licence searched and chosen, a consortium, a description, a link and a contact point; the icon follows; the catalogue shows it', async ({
    browser,
    playwright,
    baseURL,
    at,
  }) => {
    test.slow();
    const api = await adminApi(playwright, baseURL, at);
    const provider = await makeOrg(api, uniqueAbbreviation('WZA'));
    const outsider = await makeOrg(api, uniqueAbbreviation('WZB'));
    const consortium = await makeConsortium(api, uniqueAbbreviation('WZC'));
    const member = newPerson('wizmem');
    await memberOf(api, playwright, baseURL, at, member, provider);
    const opened = await pageAs(browser, baseURL, at, member);
    const page = opened.page;
    const tag = unique('wz');
    const slug = `${tag}-svc`;
    const name = `${tag} Wizard service`;

    await test.step('Open the wizard from the catalogue', async () => {
      // From the catalogue, which offers the wizard to a person who may create.
      await page.goto(at('/services'));
      await page.getByRole('link', { name: 'New service' }).click();
      await expect(page).toHaveURL(at('/services/new'));
      await expect(page.getByRole('heading', { name: 'New service', level: 1 })).toBeVisible();
      await expect(page.getByRole('heading', { name: 'Step 1 of 4: Basics' })).toBeVisible();
      // The intro of the step is above its fields.
      await expect(page.getByText('Give the service a short name')).toBeVisible();
    });

    await test.step('Enter the short name and the name', async () => {
      // Step 1: names, a licence searched in the SPDX list and chosen, the stage as the vocabulary words it.
      await page.getByLabel(/^Short name/).fill(slug);
      await page.getByLabel(/^Name/).fill(name);
    });
    await test.step('Search for a licence and choose it', async () => {
      const search = page.getByRole('searchbox', { name: 'Licence' });
      await search.fill('MIT');
      await expect(page.getByRole('status').filter({ hasText: /licences? found/ })).toBeVisible();
      // The result says in words that it is OSI approved.
      const mit = page.getByRole('button', { name: /^MIT License MIT/ });
      await expect(mit).toContainText('OSI approved');
      await mit.click();
      await expect(page.getByText('Chosen licence: MIT License')).toBeVisible();
      await expect(page.getByLabel(/^Stage/)).toHaveValue('DEV');
      await expect(page.getByLabel(/^Stage/).locator('option:checked')).toHaveText('Development');
    });
    await test.step('Write a description and add a further link', async () => {
      await page.getByLabel('Description', { exact: true }).fill(`The wizard journey ${tag}`);
      const links = page.getByRole('group', { name: 'Further links' });
      await links.getByRole('button', { name: 'Add' }).click();
      await links.getByRole('textbox').fill(`https://example.org/${tag}`);
      // The icon is not asked for here: the stored file refers to the service, which does not exist yet.
      await expect(page.getByText('You can add the icon on the next screen')).toBeVisible();
      await expect(page.locator('input[type="file"]')).toHaveCount(0);
      await page.getByRole('button', { name: 'Next' }).click();
    });

    await test.step('Choose the organisation that runs the service and a consortium', async () => {
      // Step 2: only the organisation this person is a member of is offered, never the other provider.
      await expect(page.getByRole('heading', { name: 'Step 2 of 4: Who runs it' })).toBeVisible();
      const operated = page.getByLabel(/^Operated by/);
      await expect(
        operated.getByRole('option', { name: `${provider.name} (${provider.abbreviation})` }),
      ).toHaveCount(1);
      await expect(
        operated.getByRole('option', { name: new RegExp(outsider.abbreviation) }),
      ).toHaveCount(0);
      await operated.selectOption(provider.id);
      await page
        .getByRole('checkbox', { name: `${consortium.name} (${consortium.abbreviation})` })
        .check();
      await page.getByRole('button', { name: 'Next' }).click();
    });

    await test.step('Enter a contact point', async () => {
      // Step 3: the contact point is a role address, and the step says so.
      await expect(page.getByRole('heading', { name: 'Step 3 of 4: Contact' })).toBeVisible();
      await expect(page.getByText('not a personal one').first()).toBeVisible();
      await page.getByLabel(/^Contact address/).fill(`helpdesk-${tag}@example.org`);
      await page.getByLabel('Kind of contact').fill('support');
    });

    await test.step('Go back and find what you typed kept', async () => {
      // Going back keeps what was typed: nothing is saved yet, and nothing is lost.
      await page.getByRole('button', { name: 'Back' }).click();
      await page.getByRole('button', { name: 'Back' }).click();
      await expect(page.getByLabel(/^Short name/)).toHaveValue(slug);
      await expect(page.getByText('Chosen licence: MIT License')).toBeVisible();
      await page.getByRole('button', { name: 'Next' }).click();
      await page.getByRole('button', { name: 'Next' }).click();
      await expect(page.getByLabel(/^Contact address/)).toHaveValue(`helpdesk-${tag}@example.org`);
    });

    await test.step('Go on to the KPIs step without choosing a set', async () => {
      // The last step is the KPIs: it is optional, so the person goes on without choosing a set.
      await page.getByRole('button', { name: 'Next' }).click();
      await expect(page.getByRole('heading', { name: 'Step 4 of 4: KPIs' })).toBeVisible();
    });

    await test.step('Create the service', async () => {
      // One request creates the service; the next screen offers the icon.
      await page.getByRole('button', { name: 'Create service' }).click();
      await expect(page.getByRole('heading', { name: 'Service created' })).toBeFocused();
      await expect(page.getByText(`${name} was created.`).first()).toBeVisible();
    });
    await test.step('Upload an icon', async () => {
      await page.getByLabel('Upload an icon').setInputFiles({
        name: 'icon.png',
        mimeType: 'image/png',
        buffer: makePng(32),
      });
      await expect(page.getByRole('img', { name: `Icon of ${name}` })).toBeVisible();
    });

    await test.step('Find the service in the catalogue', async () => {
      // The catalogue shows it, with its provider, its consortium and its icon.
      await page.getByRole('link', { name: 'Back to the services' }).click();
      await page.getByLabel('Search by name or short name').fill(tag);
      await page.getByRole('button', { name: 'Search', exact: true }).click();
      const row = page.getByRole('row').filter({ hasText: name });
      await expect(row).toHaveCount(1);
      await expect(row).toContainText(provider.name);
      await expect(row).toContainText(consortium.abbreviation);
      await expect(row.getByRole('img', { name: `Icon of ${name}` })).toBeVisible();
    });

    // What the server stored is what was typed, normalised.
    const stored = await api.get<{
      slug: string;
      license: string;
      stage: string;
      description: string;
      sameAs: string[];
      contactEmail: string;
      contactType: string;
      organisations: { role: string; id: string }[];
    }>(`/services/by-slug/${slug}`);
    expect(stored).toMatchObject({
      slug,
      license: 'MIT',
      stage: 'DEV',
      description: `The wizard journey ${tag}`,
      sameAs: [`https://example.org/${tag}`],
      contactEmail: `helpdesk-${tag}@example.org`,
      contactType: 'support',
    });
    expect(stored.organisations.map((o) => [o.role, o.id])).toEqual([
      ['provider', provider.id],
      ['consortium', consortium.id],
    ]);
    await opened.close();
    await api.dispose();
  });
});
