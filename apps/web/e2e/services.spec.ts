import type { Page } from '@playwright/test';
import { makePng } from '@scorpion/testing';
import { activeUser, adminApi, apiAs, newPerson, unique } from './support/admin.ts';
import { admin, expect, saveSettings, signInThroughPage, test } from './support/fixtures.ts';
import { alsoMemberOf, makeOrg, memberOf, pageAs, uniqueAbbreviation } from './support/members.ts';
import { jsonLd, watchCsp } from './support/page-checks.ts';
import {
  makeCatalogueService,
  makeConsortium,
  makeReviewer,
  seedCatalogue,
  serviceEvents,
} from './support/services.ts';
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

// M7 sprint 6, journey 3 (plan §10 item 8): a member edits a service in the browser, a manager renames it and
// moves it. The page draws its form from what the API says the caller may change, never from a role: a member
// has no short name and no owner to change (they are shown with the reason), a manager has both. Every test
// makes its own organisations, accounts and short names.

const toast = (page: Page) => page.getByRole('region', { name: 'Notifications' });
const IDENTITY_LINE = 'Only a manager of the provider or an administrator can change these.';

test.describe('journey 3: editing a service', () => {
  test('a member edits the description, links, contact point, icon, name, licence, stage and consortia, and cannot change the short name or the owner', async ({
    browser,
    playwright,
    baseURL,
    at,
    basePath,
  }) => {
    test.slow();
    const api = await adminApi(playwright, baseURL, at);
    const provider = await makeOrg(api, uniqueAbbreviation('EDA'));
    const first = await makeConsortium(api, uniqueAbbreviation('EDC'));
    const second = await makeConsortium(api, uniqueAbbreviation('EDD'));
    const member = newPerson('edmem');
    await memberOf(api, playwright, baseURL, at, member, provider);
    const tag = unique('ed');
    const slug = `${tag}-svc`;
    const name = `${tag} Edit service`;
    const made = await api.send('POST', '/services', {
      slug,
      name,
      provider: provider.id,
      consortia: [first.id],
      stage: 'DEV',
      license: 'MIT',
      description: 'Before',
      contact: { email: `before-${tag}@example.org`, type: 'support' },
    });
    expect(made.status, JSON.stringify(made.body)).toBe(201);
    const id = (made.body as { id: string }).id;

    const opened = await pageAs(browser, baseURL, at, member);
    const page = opened.page;
    await page.goto(at(`/services/${slug}`));
    // The words: the stage as the vocabulary words it, the licence by name, who runs it as a link.
    await expect(page.getByRole('heading', { name, level: 1 })).toBeVisible();
    await expect(page.getByText('Private', { exact: true })).toBeVisible();
    await expect(page.getByText('Development', { exact: true })).toBeVisible();
    await expect(page.getByText('MIT License')).toBeVisible();
    await expect(page.getByRole('link', { name: provider.name })).toHaveAttribute(
      'href',
      at(`/organisations/${provider.id}`),
    );
    await expect(page.getByRole('link', { name: `before-${tag}@example.org` })).toBeVisible();
    // A member may edit, and has no button to make it public.
    await expect(page.getByRole('button', { name: 'Make public' })).toHaveCount(0);
    await page.getByRole('button', { name: 'Edit', exact: true }).click();
    await expect(page.getByRole('heading', { name: `Edit ${name}`, level: 2 })).toBeVisible();

    // The short name and the owner are shown, read-only, with the reason; they are no controls.
    await expect(page.getByText(IDENTITY_LINE)).toBeVisible();
    await expect(page.getByLabel(/^Short name/)).toHaveCount(0);
    await expect(page.getByLabel(/^Operated by/)).toHaveCount(0);
    const fixed = page.getByRole('region', { name: 'Fixed values' });
    await expect(fixed).toContainText(slug);
    await expect(fixed).toContainText(provider.name);
    // A save is offered only when something changed.
    await expect(page.getByRole('button', { name: 'Save changes' })).toHaveCount(0);

    const renamed = `${name} v2`;
    await page.getByLabel(/^Name/).fill(renamed);
    await expect(page.getByRole('button', { name: 'Save changes' })).toBeVisible();
    await page.getByLabel(/^Name/).fill(name);
    await expect(page.getByRole('button', { name: 'Save changes' })).toHaveCount(0);
    await page.getByLabel(/^Name/).fill(renamed);
    await page.getByLabel('Description', { exact: true }).fill(`After ${tag}`);
    await page.getByLabel(/^Stage/).selectOption({ label: 'Production' });
    await page.getByRole('searchbox', { name: 'Licence' }).fill('Apache-2.0');
    await page.getByRole('button', { name: /^Apache License 2\.0 Apache-2\.0/ }).click();
    await expect(page.getByText('Chosen licence: Apache License 2.0')).toBeVisible();
    const links = page.getByRole('group', { name: 'Further links' });
    await links.getByRole('button', { name: 'Add' }).click();
    await links.getByRole('textbox').fill(`https://example.org/${tag}`);
    await page.getByLabel(/^Contact address/).fill(`after-${tag}@example.org`);
    await page.getByLabel('Kind of contact').fill('helpdesk');
    // Consortia: a member may change them: one off, one on.
    await page.getByRole('checkbox', { name: `${first.name} (${first.abbreviation})` }).uncheck();
    await page.getByRole('checkbox', { name: `${second.name} (${second.abbreviation})` }).check();
    // The icon has its own block and is saved on its own.
    await page.getByLabel('Upload an icon').setInputFiles({
      name: 'icon.png',
      mimeType: 'image/png',
      buffer: makePng(32),
    });
    await expect(toast(page).getByText('The icon was saved.')).toBeVisible();
    await page.getByRole('button', { name: 'Save changes' }).click();

    // The page says what happened, with the focus on that line, and shows the new record in words.
    const status = page.getByRole('status').filter({ hasText: 'Your changes were saved.' });
    await expect(status).toBeFocused();
    await expect(page.getByRole('heading', { name: renamed, level: 1 })).toBeVisible();
    await expect(page.getByText('Production', { exact: true })).toBeVisible();
    await expect(page.getByText('Apache License 2.0')).toBeVisible();
    await expect(page.getByText(`After ${tag}`)).toBeVisible();
    await expect(page.getByRole('link', { name: `https://example.org/${tag}` })).toHaveAttribute(
      'rel',
      'noopener noreferrer',
    );
    await expect(page.getByRole('link', { name: `after-${tag}@example.org` })).toBeVisible();
    await expect(page.getByRole('img', { name: `Icon of ${renamed}` })).toBeVisible();
    await expect(page.getByRole('link', { name: second.name })).toBeVisible();
    await expect(page.getByRole('link', { name: first.name })).toHaveCount(0);
    const stored = await api.get<{
      name: string;
      slug: string;
      stage: string;
      license: string;
      sameAs: string[];
      contactEmail: string;
      contactType: string;
      organisations: { role: string; id: string }[];
    }>(`/services/${id}`);
    expect(stored).toMatchObject({
      name: renamed,
      slug,
      stage: 'PROD',
      license: 'Apache-2.0',
      sameAs: [`https://example.org/${tag}`],
      contactEmail: `after-${tag}@example.org`,
      contactType: 'helpdesk',
    });
    expect(stored.organisations.map((o) => [o.role, o.id])).toEqual([
      ['provider', provider.id],
      ['consortium', second.id],
    ]);

    // A direct request for the short name or the owner is 403 and changes nothing (the whole request is refused).
    const asMember = await apiAs(playwright, baseURL, at, member);
    for (const change of [{ slug: `${tag}-sneaky` }, { name: 'Sneaky', slug: `${tag}-sneaky2` }]) {
      const refused = await asMember.send('PATCH', `/services/${id}`, change);
      expect(refused.status, JSON.stringify(refused.body)).toBe(403);
      expect(JSON.stringify(refused.body)).not.toContain('sneaky');
    }
    await asMember.dispose();
    expect(await api.get(`/services/${id}`)).toMatchObject({ slug, name: renamed });

    // The audit entry names who changed what: the actor, `by`, and the field names, never a value.
    const updated = await serviceEvents(basePath, 'registry.service.updated@1', id);
    const entry = updated.at(-1)!;
    expect(entry.payload.by).toBe('member');
    expect(entry.userId).not.toBeNull();
    expect(entry.payload.fields as string[]).toEqual(
      expect.arrayContaining(['name', 'description', 'stage', 'license', 'sameAs', 'consortia']),
    );
    expect(JSON.stringify(entry.payload)).not.toContain(`after-${tag}@example.org`);
    expect(JSON.stringify(entry.payload)).not.toContain(`After ${tag}`);
    await opened.close();
    await api.dispose();
  });

  test('a manager renames it (the old address still works, the new short name cannot be taken) and moves it to another organisation they manage', async ({
    browser,
    playwright,
    baseURL,
    at,
    basePath,
  }) => {
    test.slow();
    const api = await adminApi(playwright, baseURL, at);
    const home = await makeOrg(api, uniqueAbbreviation('MVA'));
    const other = await makeOrg(api, uniqueAbbreviation('MVB'));
    const foreign = await makeOrg(api, uniqueAbbreviation('MVX'));
    const manager = newPerson('mvmgr');
    await memberOf(api, playwright, baseURL, at, manager, home, 'manager');
    await alsoMemberOf(api, playwright, baseURL, at, manager, other, 'manager');
    const tag = unique('mv');
    const oldSlug = `${tag}-old`;
    const newSlug = `${tag}-new`;
    const name = `${tag} Moving service`;
    const service = await makeCatalogueService(api, oldSlug, { name, provider: home.id });
    const taken = await makeCatalogueService(api, `${tag}-taken`, {
      name: `${tag} Taken`,
      provider: home.id,
    });

    const opened = await pageAs(browser, baseURL, at, manager);
    const page = opened.page;
    await page.goto(at(`/services/${service.id}`));
    // An id resolves, and the address becomes the short name's.
    await expect(page).toHaveURL(at(`/services/${oldSlug}`));
    await page.getByRole('button', { name: 'Edit', exact: true }).click();
    // No fixed values and no reason: a manager may change both.
    await expect(page.getByText(IDENTITY_LINE)).toHaveCount(0);
    const slugField = page.getByLabel(/^Short name/);
    await expect(slugField).toHaveValue(oldSlug);

    // A short name that is taken is refused on its field, in words, without the value.
    await slugField.fill(taken.slug);
    await page.getByRole('button', { name: 'Save changes' }).click();
    await expect(slugField).toHaveAttribute('aria-invalid', 'true');
    const slugError = page.getByText('This short name is already taken');
    await expect(slugError).toBeVisible();
    await expect(slugError).not.toContainText(taken.slug);
    await expect(slugField).toHaveValue(taken.slug);
    // Changing the field takes the message away.
    await slugField.fill(newSlug);
    await expect(slugError).toHaveCount(0);

    // The owner: only the organisations this person manages are offered, never the other one.
    const operated = page.getByLabel(/^Operated by/);
    await expect(
      operated.getByRole('option', { name: new RegExp(foreign.abbreviation) }),
    ).toHaveCount(0);
    await expect(operated.getByRole('option', { name: new RegExp(home.abbreviation) })).toHaveCount(
      1,
    );
    await operated.selectOption(other.id);
    await page.getByRole('button', { name: 'Save changes' }).click();

    // The address is the new one, and the notice says the old one still works.
    await expect(page).toHaveURL(at(`/services/${newSlug}`));
    await expect(
      page.getByRole('status').filter({ hasText: 'The old address still works.' }).first(),
    ).toBeVisible();
    await expect(page.getByRole('heading', { name, level: 1 })).toBeVisible();
    await expect(page.getByRole('link', { name: other.name })).toBeVisible();
    await expect(page.getByRole('link', { name: home.name })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Edit', exact: true })).toBeVisible();

    // The old address redirects to the new one; so does the id; and nobody else can take the old short name.
    await page.goto(at(`/services/${oldSlug}`));
    await expect(page).toHaveURL(at(`/services/${newSlug}`));
    await page.goto(at(`/services/${service.id}`));
    await expect(page).toHaveURL(at(`/services/${newSlug}`));
    const reuse = await api.send('POST', '/services', {
      slug: oldSlug,
      name: `${tag} Reuse`,
      provider: home.id,
    });
    expect(reuse.status, JSON.stringify(reuse.body)).toBe(409);

    // A direct request to move it to an organisation the manager does not manage is 403, and nothing changes.
    await page.getByRole('button', { name: 'Edit', exact: true }).click();
    const asManager = await apiAs(playwright, baseURL, at, manager);
    const refused = await asManager.send('PATCH', `/services/${service.id}`, {
      provider: foreign.id,
    });
    expect(refused.status, JSON.stringify(refused.body)).toBe(403);
    await asManager.dispose();
    const stored = await api.get<{ organisations: { role: string; id: string }[] }>(
      `/services/${service.id}`,
    );
    expect(stored.organisations.map((o) => [o.role, o.id])).toEqual([['provider', other.id]]);

    // The audit entries: the rename and the move name the manager's group and the field names.
    const updated = await serviceEvents(basePath, 'registry.service.updated@1', service.id);
    expect(updated.at(-1)!.payload.by).toBe('manager');
    expect(updated.at(-1)!.payload.fields as string[]).toEqual(
      expect.arrayContaining(['slug', 'provider']),
    );
    const renamedEvents = await serviceEvents(
      basePath,
      'registry.service.slugChanged@1',
      service.id,
    );
    expect(renamedEvents).toHaveLength(1);
    await opened.close();
    await api.dispose();
  });

  test('a page that has gone out of date says so in words when a save is refused with 403, keeps what was typed and saves nothing', async ({
    browser,
    playwright,
    baseURL,
    at,
  }) => {
    test.slow();
    const api = await adminApi(playwright, baseURL, at);
    const provider = await makeOrg(api, uniqueAbbreviation('STA'));
    const member = newPerson('stamem');
    await memberOf(api, playwright, baseURL, at, member, provider);
    const tag = unique('st');
    const service = await makeCatalogueService(api, `${tag}-svc`, {
      name: `${tag} Stale service`,
      provider: provider.id,
    });
    const opened = await pageAs(browser, baseURL, at, member);
    const page = opened.page;
    await page.goto(at(`/services/${service.slug}`));
    await page.getByRole('button', { name: 'Edit', exact: true }).click();
    await page.getByLabel('Description', { exact: true }).fill(`Typed ${tag}`);

    // Meanwhile the person leaves the organisation (in another session): the page does not know yet.
    const elsewhere = await apiAs(playwright, baseURL, at, member);
    expect(
      (await elsewhere.send('DELETE', `/organisations/${provider.id}/membership`)).status,
    ).toBe(200);
    await elsewhere.dispose();

    await page.getByRole('button', { name: 'Save changes' }).click();
    await expect(page.getByRole('alert')).toContainText('You are not allowed to make this change.');
    await expect(page.getByRole('alert')).toContainText('nothing was saved');
    await expect(page.getByLabel('Description', { exact: true })).toHaveValue(`Typed ${tag}`);
    await expect(page.getByRole('button', { name: 'Save changes' })).toBeVisible();
    expect(await api.get(`/services/${service.id}`)).toMatchObject({ description: null });
    await opened.close();
    await api.dispose();
  });
});

// M7 sprint 6, journey 4 (plan §10 item 8): publication and the public pages. A Reviewer makes a service public
// and the provider's manager is told; an anonymous browser reads the public service and organisation (the
// Schema.org block parses and names the service, the logo is under the base path, no contact point, no CSP
// violation); the Reviewer makes it private and the next anonymous request is a 404 that is the 404 of an address
// nobody has; a manager and a member have no button and a direct PUT is 403; with `service.allowPublic` off every
// public address is 404 and the page explains why the button does nothing.

/** The text of the main content of a page, which the identical-404 rule compares. */
const mainOf = (page: Page) => page.getByRole('main').innerText();

test.describe('journey 4: publication and the public pages', () => {
  test('a Reviewer makes a service public and private again; anonymous visitors read the public pages; nobody else can change it', async ({
    browser,
    playwright,
    baseURL,
    at,
    basePath,
  }) => {
    test.slow();
    const api = await adminApi(playwright, baseURL, at);
    const provider = await makeOrg(api, uniqueAbbreviation('PBA'));
    const consortium = await makeConsortium(api, uniqueAbbreviation('PBC'));
    const manager = newPerson('pbmgr');
    const member = newPerson('pbmem');
    const reviewer = newPerson('pbrev');
    await memberOf(api, playwright, baseURL, at, manager, provider, 'manager');
    await memberOf(api, playwright, baseURL, at, member, provider);
    await makeReviewer(api, at, reviewer);
    const tag = unique('pb');
    const slug = `${tag}-svc`;
    const name = `${tag} Public service`;
    const secret = `private-${tag}@example.org`;
    const made = await api.send('POST', '/services', {
      slug,
      name,
      provider: provider.id,
      consortia: [consortium.id],
      description: `Open data ${tag}`,
      url: `https://example.org/${tag}`,
      license: 'MIT',
      contact: { email: secret, type: 'support' },
    });
    expect(made.status, JSON.stringify(made.body)).toBe(201);
    const id = (made.body as { id: string }).id;
    const icon = await api.request.put(at(`/api/internal/services/${id}/icon`), {
      headers: { 'x-csrf-token': api.csrf, 'content-type': 'application/octet-stream' },
      data: makePng(32),
    });
    expect(icon.status(), await icon.text()).toBe(200);

    // A manager and a member have no button, and a direct request is refused.
    for (const who of [manager, member]) {
      const opened = await pageAs(browser, baseURL, at, who);
      await opened.page.goto(at(`/services/${slug}`));
      await expect(opened.page.getByRole('heading', { name, level: 1 })).toBeVisible();
      await expect(opened.page.getByRole('button', { name: /Make (public|private)/ })).toHaveCount(
        0,
      );
      await opened.close();
      const direct = await apiAs(playwright, baseURL, at, who);
      const refused = await direct.send('PUT', `/services/${id}/publication`, { public: true });
      expect(refused.status, who.username).toBe(403);
      await direct.dispose();
    }
    // Nothing is public yet: an anonymous visitor gets the 404 of an address nobody has.
    const visitor = await browser.newContext({ baseURL, reducedMotion: 'reduce' });
    const anon = await visitor.newPage();
    const unknown = await anon.goto(at(`/public/services/${tag}-nobody`));
    expect(unknown?.status()).toBe(404);
    const nothing = await mainOf(anon);
    const closed = await anon.goto(at(`/public/services/${slug}`));
    expect(closed?.status()).toBe(404);
    expect(await mainOf(anon)).toBe(nothing);

    // The Reviewer: a confirm that says what the change means; Cancel keeps the focus on the button.
    const reviewing = await pageAs(browser, baseURL, at, reviewer);
    const page = reviewing.page;
    await page.goto(at(`/services/${slug}`));
    await expect(page.getByText('Private', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Edit', exact: true })).toHaveCount(0);
    const publish = page.getByRole('button', { name: 'Make public' });
    await publish.click();
    const dialog = page.getByRole('dialog', { name: `Make ${name} public?` });
    await expect(dialog).toContainText('Anyone, signed in or not, can then read');
    await expect(dialog).toContainText('The contact point is never public.');
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(dialog).toHaveCount(0);
    await expect(publish).toBeFocused();
    expect((await api.get<{ public: boolean }>(`/services/${id}`)).public).toBe(false);
    await publish.click();
    await dialog.getByRole('button', { name: 'Make public' }).click();
    // The state changes in place and the focus goes to the line that says what happened.
    await expect(
      page.getByRole('status').filter({ hasText: `${name} is now public.` }),
    ).toBeFocused();
    await expect(page.getByText('Public', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Make public' })).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Open the public page' })).toHaveAttribute(
      'href',
      at(`/public/services/${slug}`),
    );

    // The provider's manager got the inbox item (the service's id in its link resolves to the slug).
    const managing = await pageAs(browser, baseURL, at, manager);
    await managing.page.goto(at('/inbox'));
    await expect(managing.page.getByText(`${name} is now public`).first()).toBeVisible();
    await managing.close();

    // An anonymous browser reads the public service: words, links, the block in the head.
    const csp = await watchCsp(anon);
    const reading = await anon.goto(at(`/public/services/${slug}`));
    expect(reading?.status()).toBe(200);
    await expect(anon.getByRole('heading', { name, level: 1 })).toBeVisible();
    await expect(anon.getByText(`Open data ${tag}`)).toBeVisible();
    await expect(anon.getByRole('link', { name: `https://example.org/${tag}` })).toHaveAttribute(
      'rel',
      'noopener noreferrer',
    );
    await expect(anon.getByRole('img', { name: `Icon of ${name}` })).toBeVisible();
    // No contact point, no control, nothing of a person.
    await expect(anon.getByText(secret)).toHaveCount(0);
    await expect(anon.getByRole('main').getByRole('button')).toHaveCount(0);
    expect(await anon.content()).not.toContain(secret);
    const profile = await jsonLd(anon);
    expect(profile).toMatchObject({ '@type': 'Service', name, alternateName: slug });
    expect(profile.logo?.url).toContain(at('/api/internal/files/'));
    expect(JSON.stringify(profile)).not.toContain(secret);
    expect(JSON.stringify(profile)).not.toContain('contactPoint');
    expect(await csp()).toEqual([]);
    // An id and an old address go to the short name.
    await anon.goto(at(`/public/services/${id}`));
    await expect(anon).toHaveURL(at(`/public/services/${slug}`));

    // The provider and the consortium link to their public pages.
    await anon.getByRole('link', { name: provider.name }).click();
    await expect(anon).toHaveURL(at(`/public/organisations/${provider.id}`));
    await expect(anon.getByRole('heading', { name: provider.name, level: 1 })).toBeVisible();
    await expect(anon.getByRole('link', { name })).toHaveAttribute(
      'href',
      at(`/public/services/${slug}`),
    );
    const orgProfile = await jsonLd(anon);
    expect(orgProfile).toMatchObject({ name: provider.name });
    expect(JSON.stringify(orgProfile)).not.toContain('contactPoint');
    expect(await csp()).toEqual([]);
    await anon.goto(at(`/public/organisations/${consortium.id}`));
    await expect(anon.getByRole('heading', { name: consortium.name, level: 1 })).toBeVisible();

    // With public reads switched off every public address is a 404: the pages and the API.
    const off = async (allow: boolean) =>
      saveSettings(api.request, at, api.csrf, 'registry.services', (values) => ({
        ...values,
        allowPublic: allow,
      }));
    await off(false);
    try {
      for (const path of [`/public/services/${slug}`, `/public/organisations/${provider.id}`]) {
        expect((await anon.goto(at(path)))?.status(), path).toBe(404);
        expect(
          (await visitor.request.get(at(`/api/internal/${path.slice(1)}`))).status(),
          `API ${path}`,
        ).toBe(404);
      }
      expect(await mainOf(anon)).toBe(nothing);
    } finally {
      await off(true);
    }
    // Switched back on, what was marked public is served again.
    expect((await anon.goto(at(`/public/services/${slug}`)))?.status()).toBe(200);

    // The Reviewer makes it private again, and the next anonymous request is the 404 of an unknown address.
    await page.reload();
    await page.getByRole('button', { name: 'Make private' }).click();
    const unpublish = page.getByRole('dialog', { name: `Make ${name} private?` });
    await expect(unpublish).toContainText('Only signed-in people can then read this service.');
    await unpublish.getByRole('button', { name: 'Make private' }).click();
    await expect(
      page.getByRole('status').filter({ hasText: `${name} is now private.` }),
    ).toBeFocused();
    await expect(page.getByText('Private', { exact: true })).toBeVisible();
    for (const path of [`/public/services/${slug}`, `/public/organisations/${provider.id}`]) {
      expect((await anon.goto(at(path)))?.status(), path).toBe(404);
      expect(await mainOf(anon), path).toBe(nothing);
    }
    // Both changes were audited with the Reviewer as the actor.
    const published = await serviceEvents(basePath, 'registry.service.published@1', id);
    const unpublished = await serviceEvents(basePath, 'registry.service.unpublished@1', id);
    expect(published).toHaveLength(1);
    expect(unpublished).toHaveLength(1);
    expect(published[0]!.userId).not.toBeNull();
    expect(published[0]!.userId).toBe(unpublished[0]!.userId);
    await reviewing.close();
    await visitor.close();
    await api.dispose();
  });

  test('a Reviewer whose page is out of date meets the switched-off flag in words, and the button says why it does nothing', async ({
    browser,
    playwright,
    baseURL,
    at,
  }) => {
    test.slow();
    const api = await adminApi(playwright, baseURL, at);
    const provider = await makeOrg(api, uniqueAbbreviation('PBF'));
    const reviewer = newPerson('pbrev2');
    await makeReviewer(api, at, reviewer);
    const tag = unique('pf');
    const service = await makeCatalogueService(api, `${tag}-svc`, {
      name: `${tag} Flag service`,
      provider: provider.id,
    });
    const reviewing = await pageAs(browser, baseURL, at, reviewer);
    const page = reviewing.page;
    await page.goto(at(`/services/${service.slug}`));
    await expect(page.getByRole('button', { name: 'Make public' })).toBeEnabled();
    // The administrator switches public reads off on the settings form while the page is open.
    const settings = await pageAs(browser, baseURL, at, admin);
    try {
      await settings.page.goto(at('/admin/settings/registry.services'));
      await settings.page.getByLabel('Allow public services').uncheck();
      await settings.page.getByRole('button', { name: 'Save' }).click();
      await expect(toast(settings.page).getByText(/saved/i).first()).toBeVisible();

      await page.getByRole('button', { name: 'Make public' }).click();
      await page
        .getByRole('dialog', { name: `Make ${service.name} public?` })
        .getByRole('button', { name: 'Make public' })
        .click();
      await expect(page.getByRole('alert')).toContainText('switched off on this instance');
      const button = page.getByRole('button', { name: 'Make public' });
      await expect(button).toBeDisabled();
      await expect(button).toHaveAccessibleDescription('Switched off on this instance.');
      expect((await api.get<{ public: boolean }>(`/services/${service.id}`)).public).toBe(false);
      // Reloaded, the API no longer offers the action at all.
      await page.reload();
      await expect(page.getByRole('button', { name: 'Make public' })).toHaveCount(0);
    } finally {
      await saveSettings(api.request, at, api.csrf, 'registry.services', (values) => ({
        ...values,
        allowPublic: true,
      }));
      await settings.close();
    }
    await reviewing.close();
    await api.dispose();
  });
});

// M7 sprint 6, journey 5 (plan §10 item 8): what a plain User and an anonymous visitor can and cannot do. A
// plain User reads the catalogue and the page and has no edit, publish or administration entry and no write
// route; an anonymous visitor reaches the public pages and the sign-in page, and a private service is a 404.

test.describe('journey 5: a plain User and an anonymous visitor', () => {
  test('a plain User reads but changes nothing, and is offered no administration; an anonymous visitor sees only the public pages', async ({
    browser,
    playwright,
    baseURL,
    at,
  }) => {
    test.slow();
    const api = await adminApi(playwright, baseURL, at);
    const provider = await makeOrg(api, uniqueAbbreviation('PUA'));
    const tag = unique('pu');
    const service = await makeCatalogueService(api, `${tag}-svc`, {
      name: `${tag} Read-only service`,
      provider: provider.id,
    });
    const reader = newPerson('pureader');
    await activeUser(api, at, reader);

    const opened = await pageAs(browser, baseURL, at, reader);
    const page = opened.page;
    await page.goto(at(`/services?q=${tag}`));
    await expect(page.getByRole('row').filter({ hasText: service.name })).toHaveCount(1);
    await page.getByRole('link', { name: service.name }).click();
    await expect(page).toHaveURL(at(`/services/${service.slug}`));
    await expect(page.getByRole('heading', { name: service.name, level: 1 })).toBeVisible();
    // No edit, no publish, no form; the contact point of a service that has none is not asked for.
    await expect(page.getByRole('button', { name: /Edit|Make public|Make private/ })).toHaveCount(
      0,
    );
    await expect(page.getByRole('main').getByRole('button')).toHaveCount(0);
    // No administration anywhere in the shell.
    await expect(page.getByRole('link', { name: /Administration|Settings|Users/ })).toHaveCount(0);
    const navigation = await opened.page.request.get(at('/api/internal/ui/navigation'));
    expect(navigation.status()).toBe(200);
    const body = await navigation.text();
    expect(body).not.toMatch(/admin/i);
    expect((JSON.parse(body) as { routes: string[] }).routes).toEqual(
      expect.arrayContaining(['/services', '/services/:slug', '/public/services/:slug']),
    );

    // Every write route refuses: the person may read, nothing more.
    const csrf = (await (await opened.page.request.get(at('/api/internal/auth/me'))).json()) as {
      csrfToken: string;
    };
    const call = async (
      method: 'PATCH' | 'PUT' | 'DELETE' | 'POST',
      path: string,
      data?: unknown,
    ) => {
      const response = await opened.page.request.fetch(at(`/api/internal${path}`), {
        method,
        headers: { 'x-csrf-token': csrf.csrfToken, 'content-type': 'application/json' },
        data: data === undefined ? '{}' : JSON.stringify(data),
      });
      return response.status();
    };
    expect(await call('PATCH', `/services/${service.id}`, { name: 'Changed' })).toBe(403);
    expect(await call('PUT', `/services/${service.id}/publication`, { public: true })).toBe(403);
    expect(await call('DELETE', `/services/${service.id}/icon`)).toBe(403);
    expect(
      await opened.page.request
        .fetch(at(`/api/internal/services/${service.id}/icon`), {
          method: 'PUT',
          headers: { 'x-csrf-token': csrf.csrfToken, 'content-type': 'application/octet-stream' },
          data: makePng(32),
        })
        .then((response) => response.status()),
    ).toBe(403);
    expect(
      await call('POST', '/services', {
        slug: `${tag}-mine`,
        name: `${tag} Mine`,
        provider: provider.id,
      }),
    ).toBe(403);
    expect(await api.get(`/services/${service.id}`)).toMatchObject({ name: service.name });

    // An anonymous visitor: the sign-in page, never the catalogue or a private service.
    const visitor = await browser.newContext({ baseURL, reducedMotion: 'reduce' });
    const anon = await visitor.newPage();
    await anon.goto(at('/services'));
    await expect(anon).toHaveURL(
      (address) => address.pathname === at('/login') && address.searchParams.has('returnTo'),
    );
    await anon.goto(at(`/services/${service.slug}`));
    await expect(anon).toHaveURL(/\/login\?returnTo=/);
    await expect(anon.getByRole('heading', { name: /Sign in/ })).toBeVisible();
    expect((await anon.goto(at(`/public/services/${service.slug}`)))?.status()).toBe(404);
    expect((await visitor.request.get(at(`/api/internal/services/${service.id}`))).status()).toBe(
      401,
    );
    const open = await visitor.request.get(at('/api/internal/ui/navigation'));
    const routes = ((await open.json()) as { routes: string[] }).routes;
    expect(routes).toContain('/login');
    expect(routes).toContain('/public/services/:slug');
    expect(
      routes.filter((route) => /^\/(services|admin|account|profile|inbox)/.test(route)),
    ).toEqual([]);
    await visitor.close();
    await opened.close();
    await api.dispose();
  });
});

// M7 sprint 6, journey 6 (plan §10 item 8): an organisation that has a service cannot be deleted, which closes
// the `org.usage` journey that M6 could only test with a fixture. The 409 is shown on the page and names the module
// that still uses the organisation.

test.describe('journey 6: an organisation in use cannot be deleted', () => {
  test('an Admin who deletes the provider of a service is told which module still uses it, and the organisation stays', async ({
    page,
    playwright,
    baseURL,
    at,
  }) => {
    test.slow();
    const api = await adminApi(playwright, baseURL, at);
    const provider = await makeOrg(api, uniqueAbbreviation('USE'));
    const tag = unique('us');
    await makeCatalogueService(api, `${tag}-svc`, { name: `${tag} Used`, provider: provider.id });
    await signInThroughPage(page, at, admin);
    await page.goto(at(`/admin/organisations/${provider.id}`));
    await page.getByRole('button', { name: 'Delete…' }).click();
    const dialog = page.getByRole('dialog', { name: `Delete ${provider.name}?` });
    await dialog.getByRole('button', { name: 'Delete the organisation' }).click();
    await expect(page.getByRole('alert')).toContainText('Still in use by:');
    await expect(page.getByRole('alert')).toContainText(/registry\.services|Services/);
    expect((await api.request.get(at(`/api/internal/organisations/${provider.id}`))).status()).toBe(
      200,
    );
    await api.dispose();
  });
});
