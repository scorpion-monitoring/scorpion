import type { Page } from '@playwright/test';
import { makePng } from '@scorpion/testing';
import { activeUser, adminApi, apiAs, newPerson, unique } from './support/admin.ts';
import { admin, expect, signInThroughPage, test } from './support/fixtures.ts';
import { makeOrg, memberOf, pageAs, uniqueAbbreviation } from './support/members.ts';
import { makeCatalogueService, makeConsortium, seedCatalogue } from './support/services.ts';
import { fillBasics, openWizard } from './support/wizard.ts';

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

// M7 sprint 5, journey 1 (plan §10 item 8): a member of a provider creates a service through the wizard. A
// licence is searched and chosen, a consortium, a description, a link and a contact point are given, the icon is
// uploaded once the service exists, and the service is in the catalogue. A duplicate short name and an unknown
// licence show their errors on their fields and keep what was typed; a person who is not a member of a provider
// is not offered it, and a direct request for it answers 403 and creates nothing. Every test makes its own
// organisations, accounts and short names (the specs of a run share one database).

test.describe('journey 1: the create wizard', () => {
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

    // From the catalogue, which offers the wizard to a person who may create.
    await page.goto(at('/services'));
    await page.getByRole('link', { name: 'New service' }).click();
    await expect(page).toHaveURL(at('/services/new'));
    await expect(page.getByRole('heading', { name: 'New service', level: 1 })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Step 1 of 3: Basics' })).toBeVisible();
    // The intro of the step is above its fields.
    await expect(page.getByText('Give the service a short name')).toBeVisible();

    // Step 1: names, a licence searched in the SPDX list and chosen, the stage as the vocabulary words it.
    await page.getByLabel(/^Short name/).fill(slug);
    await page.getByLabel(/^Name/).fill(name);
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
    await page.getByLabel('Description', { exact: true }).fill(`The wizard journey ${tag}`);
    const links = page.getByRole('group', { name: 'Further links' });
    await links.getByRole('button', { name: 'Add' }).click();
    await links.getByRole('textbox').fill(`https://example.org/${tag}`);
    // The icon is not asked for here: the stored file refers to the service, which does not exist yet.
    await expect(page.getByText('You can add the icon on the next screen')).toBeVisible();
    await expect(page.locator('input[type="file"]')).toHaveCount(0);
    await page.getByRole('button', { name: 'Next' }).click();

    // Step 2: only the organisation this person is a member of is offered, never the other provider.
    await expect(page.getByRole('heading', { name: 'Step 2 of 3: Who runs it' })).toBeVisible();
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

    // Step 3: the contact point is a role address, and the step says so.
    await expect(page.getByRole('heading', { name: 'Step 3 of 3: Contact' })).toBeVisible();
    await expect(page.getByText('not a personal one').first()).toBeVisible();
    await page.getByLabel(/^Contact address/).fill(`helpdesk-${tag}@example.org`);
    await page.getByLabel('Kind of contact').fill('support');

    // Going back keeps what was typed: nothing is saved yet, and nothing is lost.
    await page.getByRole('button', { name: 'Back' }).click();
    await page.getByRole('button', { name: 'Back' }).click();
    await expect(page.getByLabel(/^Short name/)).toHaveValue(slug);
    await expect(page.getByText('Chosen licence: MIT License')).toBeVisible();
    await page.getByRole('button', { name: 'Next' }).click();
    await page.getByRole('button', { name: 'Next' }).click();
    await expect(page.getByLabel(/^Contact address/)).toHaveValue(`helpdesk-${tag}@example.org`);

    // One request creates the service; the next screen offers the icon.
    await page.getByRole('button', { name: 'Create service' }).click();
    await expect(page.getByRole('heading', { name: 'Service created' })).toBeFocused();
    await expect(page.getByText(`${name} was created.`).first()).toBeVisible();
    await page.getByLabel('Upload an icon').setInputFiles({
      name: 'icon.png',
      mimeType: 'image/png',
      buffer: makePng(32),
    });
    await expect(page.getByRole('img', { name: `Icon of ${name}` })).toBeVisible();

    // The catalogue shows it, with its provider, its consortium and its icon.
    await page.getByRole('link', { name: 'Back to the services' }).click();
    await page.getByLabel('Search by name or short name').fill(tag);
    await page.getByRole('button', { name: 'Search', exact: true }).click();
    const row = page.getByRole('row').filter({ hasText: name });
    await expect(row).toHaveCount(1);
    await expect(row).toContainText(provider.name);
    await expect(row).toContainText(consortium.abbreviation);
    await expect(row.getByRole('img', { name: `Icon of ${name}` })).toBeVisible();

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

  test('a duplicate short name and an unknown licence show their errors on their fields, and nothing typed is lost', async ({
    browser,
    playwright,
    baseURL,
    at,
  }) => {
    test.slow();
    const api = await adminApi(playwright, baseURL, at);
    const provider = await makeOrg(api, uniqueAbbreviation('WZD'));
    const member = newPerson('wizdup');
    await memberOf(api, playwright, baseURL, at, member, provider);
    const tag = unique('wd');
    const taken = await makeCatalogueService(api, `${tag}-taken`, {
      name: `${tag} Taken`,
      provider: provider.id,
    });
    const opened = await pageAs(browser, baseURL, at, member);
    const page = opened.page;

    await openWizard(page, at);
    // The browser checks a step before it lets the person go on: nothing is sent for an empty step.
    await page.getByRole('button', { name: 'Next' }).click();
    await expect(page.getByRole('heading', { name: 'Step 1 of 3: Basics' })).toBeVisible();
    await expect(page.getByText('Some answers need attention')).toBeVisible();
    await expect(page.getByText('This field is required.')).toHaveCount(2);
    await expect(page.getByLabel(/^Short name/)).toHaveAttribute('aria-invalid', 'true');

    // The same short name as the service that exists: the server says 409, and the field says so in words,
    // without the value.
    await fillBasics(page, { slug: taken.slug, name: `${tag} Duplicate` });
    await page.getByRole('button', { name: 'Next' }).click();
    await page.getByLabel(/^Operated by/).selectOption(provider.id);
    await page.getByRole('button', { name: 'Next' }).click();
    await page.getByRole('button', { name: 'Create service' }).click();
    await expect(page.getByRole('heading', { name: 'Step 1 of 3: Basics' })).toBeVisible();
    const slugField = page.getByLabel(/^Short name/);
    await expect(slugField).toHaveAttribute('aria-invalid', 'true');
    const slugError = page.getByText('This short name is already taken');
    await expect(slugError).toBeVisible();
    await expect(slugError).not.toContainText(taken.slug);
    // Nothing typed is lost.
    await expect(slugField).toHaveValue(taken.slug);
    await expect(page.getByLabel(/^Name/)).toHaveValue(`${tag} Duplicate`);

    // Changing the field takes its error away; the console (outside production) shows the form as JSON and takes
    // edits back, which are checked like a field edit: an unknown licence is the server's 422, on the licence.
    const fresh = `${tag}-fresh`;
    await slugField.fill(fresh);
    await expect(slugError).toHaveCount(0);
    const console = page.getByLabel('The form as JSON');
    await expect(console).toHaveValue(new RegExp(`"slug": "${fresh}"`));
    await console.fill(
      JSON.stringify({
        slug: fresh,
        name: `${tag} Duplicate`,
        license: 'No-Such-Licence-1.0',
        stage: 'DEV',
        provider: provider.id,
      }),
    );
    await expect(page.getByText('Chosen licence: No-Such-Licence-1.0')).toBeVisible();
    await page.getByRole('button', { name: 'Next' }).click();
    await page.getByRole('button', { name: 'Next' }).click();
    await page.getByRole('button', { name: 'Create service' }).click();
    await expect(page.getByRole('heading', { name: 'Step 1 of 3: Basics' })).toBeVisible();
    await expect(page.getByText(/is not an SPDX licence id/)).toBeVisible();
    await expect(page.getByLabel(/^Short name/)).toHaveValue(fresh);
    await expect(page.getByLabel(/^Name/)).toHaveValue(`${tag} Duplicate`);
    // No service was made by either failure.
    const missing = await api.request.get(at(`/api/internal/services/by-slug/${fresh}`));
    expect(missing.status()).toBe(404);

    // Remove the licence and the same form is created.
    await page.getByRole('button', { name: 'Remove the licence' }).click();
    await page.getByRole('button', { name: 'Next' }).click();
    await page.getByRole('button', { name: 'Next' }).click();
    await page.getByRole('button', { name: 'Create service' }).click();
    await expect(page.getByRole('heading', { name: 'Service created' })).toBeVisible();
    await opened.close();
    await api.dispose();
  });

  test('a person who is not a member of a provider is not offered it, and a direct request for it is 403 and creates nothing', async ({
    browser,
    playwright,
    baseURL,
    at,
  }) => {
    test.slow();
    const api = await adminApi(playwright, baseURL, at);
    const mine = await makeOrg(api, uniqueAbbreviation('WZE'));
    const theirs = await makeOrg(api, uniqueAbbreviation('WZF'));
    const member = newPerson('wizout');
    await memberOf(api, playwright, baseURL, at, member, mine);
    const nobody = newPerson('wizno');
    await activeUser(api, at, nobody);
    const tag = unique('wo');

    // A direct request for the other provider answers 403, and so does one for an organisation nobody has
    // (the membership is checked before the body); nothing is created.
    const asMember = await apiAs(playwright, baseURL, at, member);
    for (const provider of [theirs.id, '0197a1b2-c3d4-7e5f-8a6b-7c8d9e0f1a2b']) {
      const refused = await asMember.send('POST', '/services', {
        slug: `${tag}-direct`,
        name: `${tag} Direct`,
        provider,
      });
      expect(refused.status, JSON.stringify(refused.body)).toBe(403);
    }
    const none = await api.request.get(at(`/api/internal/services/by-slug/${tag}-direct`));
    expect(none.status()).toBe(404);
    await asMember.dispose();

    // The member's own list holds only their organisation.
    const opened = await pageAs(browser, baseURL, at, member);
    await openWizard(opened.page, at);
    await fillBasics(opened.page, { slug: `${tag}-m`, name: `${tag} M` });
    await opened.page.getByRole('button', { name: 'Next' }).click();
    const operated = opened.page.getByLabel(/^Operated by/);
    await expect(operated.getByRole('option')).toHaveCount(2); // "Choose…" and their own
    await expect(
      operated.getByRole('option', { name: new RegExp(theirs.abbreviation) }),
    ).toHaveCount(0);
    await opened.close();

    // A person who belongs to no organisation sees the wizard with nothing to choose, and is told what to do.
    const lonely = await pageAs(browser, baseURL, at, nobody);
    await openWizard(lonely.page, at);
    await fillBasics(lonely.page, { slug: `${tag}-n`, name: `${tag} N` });
    await lonely.page.getByRole('button', { name: 'Next' }).click();
    await expect(lonely.page.getByText('There is no organisation to choose from')).toBeVisible();
    await lonely.page.getByRole('button', { name: 'Next' }).click();
    await expect(lonely.page.getByText('This field is required.')).toBeVisible();
    await lonely.close();
    await api.dispose();
  });
});
