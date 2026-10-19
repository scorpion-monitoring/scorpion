import type { Page } from '@playwright/test';
import { violations } from './support/a11y.ts';
import { adminApi, unique } from './support/admin.ts';
import { admin, expect, signInThroughPage, test } from './support/fixtures.ts';
import { makeOrg, memberOf, pageAs, uniqueAbbreviation } from './support/members.ts';
import { newPerson } from './support/admin.ts';
import { callFromReference, openReference } from './support/reference.ts';

// M9 sprint 2: an Admin looks after the indicators and the KPI sets in the browser. The journey creates an
// indicator with a unit and bounds and a qualitative one, builds a KPI set with them (the paginated picker, a
// necessity per row), sets the evaluation, sees that an indicator in use cannot be deleted, and cleans up. Every
// test makes its own data under a name of its own (specs of a run share one database, a retry must not meet what
// its first try left). Under both base paths, in both themes for axe.

const toast = (page: Page) => page.getByRole('region', { name: 'Notifications' });

test.describe('journey: create an indicator, build a set, set the evaluation', () => {
  test('works from the empty form to the saved evaluation, and refuses to delete what a set uses', async ({
    page,
    at,
  }) => {
    test.slow();
    await signInThroughPage(page, at, admin);
    const tag = unique('kpi');
    const views = `Views ${tag}`;
    const comment = `Comment ${tag}`;
    const setName = `Set ${tag}`;

    // The list, then the new form: a unit-bearing indicator with bounds.
    await page.goto(at('/kpi/indicators'));
    await expect(page.getByRole('heading', { name: 'Indicators', level: 1 })).toBeVisible();
    await page.getByRole('link', { name: 'New indicator' }).click();
    await expect(page.getByRole('heading', { name: 'New indicator', level: 1 })).toBeVisible();
    await page.getByLabel(/^Name/).fill(views);
    await page.getByLabel('Description').fill('How often a page was opened');
    await page.getByLabel('Example').fill('120');
    await page.getByLabel(/^Thematic category/).selectOption({ label: 'Usage' });
    await page.getByLabel(/^Value type/).selectOption({ label: 'Whole number' });
    await page.getByLabel('Unit').selectOption({ label: 'Count' });
    await page.getByLabel('Smallest value').fill('0');
    await page.getByLabel('Largest value').fill('abc');
    await page.getByRole('button', { name: 'Create the indicator' }).click();
    await expect(page.getByText('Enter a number, for example 0 or 12.5.')).toBeVisible();
    await page.getByLabel('Largest value').fill('1000');
    await page.getByRole('button', { name: 'Create the indicator' }).click();
    await expect(toast(page).getByText(`${views} was created.`)).toBeVisible();
    await expect(page.getByRole('heading', { name: views, level: 1 })).toBeVisible();
    await expect(page.getByText('Used in 0 KPI sets.')).toBeVisible();

    // A qualitative indicator: the type is fixed to text and the bounds are gone.
    await page.goto(at('/kpi/indicators/new'));
    await page.getByLabel(/^Name/).fill(comment);
    await page.getByLabel(/^Thematic category/).selectOption({ label: 'Satisfaction' });
    await page.getByLabel('Qualitative indicator').check();
    await expect(page.getByLabel(/^Value type/)).toBeDisabled();
    await expect(page.getByLabel('Smallest value')).toHaveCount(0);
    await page.getByRole('button', { name: 'Create the indicator' }).click();
    await expect(toast(page).getByText(`${comment} was created.`)).toBeVisible();

    // A duplicate name is shown on its field.
    await page.goto(at('/kpi/indicators/new'));
    await page.getByLabel(/^Name/).fill(views.toUpperCase());
    await page.getByLabel(/^Thematic category/).selectOption({ label: 'Usage' });
    await page.getByLabel(/^Value type/).selectOption({ label: 'Whole number' });
    await page.getByRole('button', { name: 'Create the indicator' }).click();
    await expect(page.getByText('This name is already taken.').first()).toBeVisible();

    // The list finds both by their tag, and a filter narrows it.
    await page.goto(at(`/kpi/indicators?q=${tag}`));
    await expect(page.getByRole('rowheader', { name: views })).toBeVisible();
    await expect(page.getByRole('rowheader', { name: comment })).toBeVisible();
    await page.getByLabel('Kind').selectOption({ label: 'Qualitative' });
    await expect(page.getByRole('rowheader', { name: comment })).toBeVisible();
    await expect(page.getByRole('rowheader', { name: views })).toHaveCount(0);

    // The set: create it with a RIMO category, then add both indicators through the picker.
    await page.goto(at('/kpi/sets'));
    await page.getByRole('link', { name: 'New KPI set' }).click();
    await page.getByLabel(/^Name/).fill(setName);
    await page.getByLabel('RIMO category').selectOption({ label: 'Web application' });
    await page.getByRole('button', { name: 'Create the KPI set' }).click();
    await expect(toast(page).getByText(`${setName} was created.`)).toBeVisible();
    await expect(page.getByRole('heading', { name: setName, level: 1 })).toBeVisible();
    await expect(page.getByText('The set has no indicators.')).toBeVisible();

    await page.getByLabel('Search indicators').fill(tag);
    await page.getByRole('button', { name: 'Search', exact: true }).last().click();
    await page.getByRole('button', { name: `Add ${views}` }).click();
    await page.getByRole('button', { name: `Add ${comment}` }).click();
    await expect(page.getByText('There are unsaved changes.').first()).toBeVisible();
    await page.getByLabel(`Necessity of ${views}`).selectOption({ label: 'Mandatory' });
    await page.getByLabel(`Necessity of ${comment}`).selectOption({ label: 'Recommended' });
    await page.getByRole('button', { name: 'Save the indicators' }).click();
    await expect(toast(page).getByText('The indicators were saved.')).toBeVisible();

    // The evaluation: the headline is a saved row; a text indicator has no aggregate.
    await page.getByLabel('Headline indicator').selectOption({ label: comment });
    await expect(page.getByLabel('Aggregate')).toBeDisabled();
    await expect(page.getByText('This value type has no aggregate.')).toBeVisible();
    await page.getByLabel('Headline indicator').selectOption({ label: views });
    await page.getByLabel('Aggregate').selectOption({ label: 'Sum' });
    await page.getByRole('button', { name: 'Save the evaluation' }).click();
    await expect(toast(page).getByText('The evaluation was saved.')).toBeVisible();

    // After a reload everything is as saved, and the list shows the badges.
    await page.reload();
    await expect(page.getByLabel(`Necessity of ${views}`)).toHaveValue('mandatory');
    await expect(page.getByLabel(`Necessity of ${comment}`)).toHaveValue('recommended');
    await expect(page.getByLabel('Headline indicator')).toHaveValue(/.+/);
    await expect(page.getByLabel('Aggregate')).toHaveValue('sum');
    await page.goto(at(`/kpi/sets?q=${tag}`));
    await expect(page.getByRole('rowheader', { name: setName })).toBeVisible();
    await expect(page.getByText('1 Mandatory')).toBeVisible();
    await expect(page.getByText('1 Recommended')).toBeVisible();

    // An indicator a set uses cannot be deleted; the page says where it is used.
    await page.goto(at(`/kpi/indicators?q=${tag}`));
    await page.getByRole('link', { name: views }).click();
    await expect(page.getByText('Used in 1 KPI set.')).toBeVisible();
    await page.getByRole('button', { name: 'Delete…' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Delete', exact: true }).click();
    await expect(page.getByText(/while it is in use: 1 KPI set, 1 evaluation/)).toBeVisible();

    // Removing the headline from the set clears the evaluation; then the set and the indicators can go.
    await page.goto(at(`/kpi/sets?q=${tag}`));
    await page.getByRole('link', { name: setName }).click();
    await page.getByRole('button', { name: `Remove ${views}` }).click();
    await expect(
      page.getByText('Removing the headline indicator also clears the evaluation.'),
    ).toBeVisible();
    await page.getByRole('button', { name: 'Save the indicators' }).click();
    await expect(toast(page).getByText('The indicators were saved.')).toBeVisible();
    await page.getByRole('button', { name: 'Delete…' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Delete', exact: true }).click();
    await expect(toast(page).getByText(`${setName} was deleted.`)).toBeVisible();
    for (const name of [views, comment]) {
      await page.goto(at(`/kpi/indicators?q=${tag}`));
      await page.getByRole('link', { name }).click();
      await page.getByRole('button', { name: 'Delete…' }).click();
      await page.getByRole('dialog').getByRole('button', { name: 'Delete', exact: true }).click();
      await expect(toast(page).getByText(`${name} was deleted.`)).toBeVisible();
    }
  });
});

for (const scheme of ['light', 'dark'] as const) {
  test.describe(`the screens of the indicators and KPI sets, ${scheme} theme`, () => {
    test.use({ reducedMotion: 'reduce' });
    test('have no serious accessibility violation', async ({ page, playwright, baseURL, at }) => {
      test.slow();
      const api = await adminApi(playwright, baseURL, at);
      const tag = unique(`ax${scheme.slice(0, 1)}`);
      const ind = await api.send('POST', '/kpi/indicators', {
        name: `Accessible ${tag}`,
        description: 'Plain text',
        valueType: 'integer',
        unit: 'count',
        min: 0,
        thematic: 'Usage',
      });
      expect(ind.status, JSON.stringify(ind.body)).toBe(201);
      const indicatorId = (ind.body as { id: string }).id;
      const set = await api.send('POST', '/kpi/sets', {
        name: `Accessible set ${tag}`,
        rimoCategory: 'Web_application',
      });
      const setId = (set.body as { id: string }).id;
      expect(
        (
          await api.send('PUT', `/kpi/sets/${setId}/indicators`, {
            indicators: [{ indicatorId, necessity: 'mandatory' }],
          })
        ).status,
      ).toBe(200);
      expect(
        (await api.send('PUT', `/kpi/sets/${setId}/evaluation`, { indicatorId, aggregate: 'sum' }))
          .status,
      ).toBe(200);

      await page.emulateMedia({ colorScheme: scheme, reducedMotion: 'reduce' });
      await signInThroughPage(page, at, admin);
      const clean = async (what: string) => expect(await violations(page), what).toEqual([]);

      await page.goto(at(`/kpi/indicators?q=${tag}`));
      await expect(page.getByRole('rowheader', { name: `Accessible ${tag}` })).toBeVisible();
      await clean('the indicator list');
      await page.goto(at('/kpi/indicators?q=no-such-indicator-xyz'));
      await expect(page.getByText('No indicator matches.')).toBeVisible();
      await clean('the empty indicator list');

      await page.goto(at('/kpi/indicators/new'));
      await expect(page.getByRole('heading', { name: 'New indicator', level: 1 })).toBeVisible();
      await clean('the new indicator form');
      await page.getByRole('button', { name: 'Create the indicator' }).click();
      await expect(page.getByText('must not be empty').first()).toBeVisible();
      await clean('the new indicator form with its errors');

      await page.goto(at(`/kpi/indicators/${indicatorId}`));
      await expect(
        page.getByRole('heading', { name: `Accessible ${tag}`, level: 1 }),
      ).toBeVisible();
      await clean('the indicator editor');
      await page.getByRole('button', { name: 'Delete…' }).click();
      await expect(page.getByRole('dialog')).toBeVisible();
      await clean('the delete dialog');
      await page.getByRole('button', { name: 'Cancel' }).click();

      await page.goto(at(`/kpi/sets?q=${tag}`));
      await expect(page.getByRole('rowheader', { name: `Accessible set ${tag}` })).toBeVisible();
      await clean('the set list');
      await page.goto(at('/kpi/sets/new'));
      await clean('the new set form');

      await page.goto(at(`/kpi/sets/${setId}`));
      await expect(
        page.getByRole('heading', { name: `Accessible set ${tag}`, level: 1 }),
      ).toBeVisible();
      await expect(
        page
          .getByRole('button', { name: `Add Accessible ${tag}` })
          .or(page.getByText('In the set').first()),
      ).toBeVisible();
      await clean('the set editor with its picker, rows and evaluation');
      await api.dispose();
    });
  });
}

// M9 sprint 3: a service has a KPI set and may opt into extra indicators. The journey creates a service through the wizard
// with a set and an extra (the last step), then changes the set and removes the extra on the page, as a manager of the
// provider; a member of another provider sees the section and cannot change it; the catalogue filters by the set.

/** Sets and indicators for one run, each under a name of its own; the API is the administrator's. */
async function kpiWorld(api: Awaited<ReturnType<typeof adminApi>>, tag: string) {
  const indicator = async (name: string, unit: string | null = 'count') => {
    const made = await api.send('POST', '/kpi/indicators', {
      name: `${name} ${tag}`,
      valueType: 'integer',
      thematic: 'Usage',
      ...(unit && { unit }),
    });
    expect(made.status, JSON.stringify(made.body)).toBe(201);
    return { id: (made.body as { id: string }).id, name: `${name} ${tag}` };
  };
  const [views, downloads, citations, users] = [
    await indicator('Views'),
    await indicator('Downloads'),
    await indicator('Citations'),
    await indicator('Users'),
  ];
  const set = async (name: string, rows: { id: string; necessity: string }[]) => {
    const made = await api.send('POST', '/kpi/sets', { name: `${name} ${tag}` });
    expect(made.status, JSON.stringify(made.body)).toBe(201);
    const id = (made.body as { id: string }).id;
    const saved = await api.send('PUT', `/kpi/sets/${id}/indicators`, {
      indicators: rows.map((row) => ({ indicatorId: row.id, necessity: row.necessity })),
    });
    expect(saved.status, JSON.stringify(saved.body)).toBe(200);
    return { id, name: `${name} ${tag}` };
  };
  const first = await set('Data portals', [
    { id: views.id, necessity: 'mandatory' },
    { id: downloads.id, necessity: 'optional' },
  ]);
  const second = await set('Tools', [{ id: citations.id, necessity: 'recommended' }]);
  return { views, downloads, citations, users, first, second };
}

test.describe('journey: a service with a KPI set and an extra', () => {
  test('is created in the wizard, then its set is changed and its extra removed on the page', async ({
    browser,
    playwright,
    baseURL,
    at,
  }) => {
    test.slow();
    const api = await adminApi(playwright, baseURL, at);
    const tag = unique('kj');
    const w = await kpiWorld(api, tag);
    const provider = await makeOrg(api, uniqueAbbreviation('KJA'));
    const elsewhere = await makeOrg(api, uniqueAbbreviation('KJB'));
    const member = newPerson('kpimem');
    await memberOf(api, playwright, baseURL, at, member, provider, 'manager');
    const plain = newPerson('kpiplain');
    await memberOf(api, playwright, baseURL, at, plain, provider);
    const stranger = newPerson('kpistr');
    await memberOf(api, playwright, baseURL, at, stranger, elsewhere);
    const opened = await pageAs(browser, baseURL, at, member);
    const page = opened.page;
    const name = `${tag} KPI service`;

    // The wizard: the KPIs are its last step, after the contact point.
    await page.goto(at('/services/new'));
    await page.getByLabel(/^Short name/).fill(`${tag}-svc`);
    await page.getByLabel(/^Name/).fill(name);
    await page.getByRole('button', { name: 'Next' }).click();
    await page.getByLabel(/^Operated by/).selectOption(provider.id);
    await page.getByRole('button', { name: 'Next' }).click();
    await page.getByRole('button', { name: 'Next' }).click();
    await expect(page.getByRole('heading', { name: 'Step 4 of 4: KPIs' })).toBeVisible();
    await expect(page.getByText('No KPIs yet.')).toBeVisible();

    // A set shows its indicators locked, with the necessity in the words of the vocabulary.
    await page.getByLabel('KPI set', { exact: true }).selectOption({ label: w.first.name });
    const viewsRow = page.getByRole('row').filter({ hasText: w.views.name });
    await expect(viewsRow).toContainText('Mandatory');
    await expect(viewsRow).toContainText('Count');
    await expect(viewsRow).toContainText('From the KPI set (fixed)');
    await expect(viewsRow.getByRole('button')).toHaveCount(0);
    await expect(page.getByRole('row').filter({ hasText: w.downloads.name })).toContainText(
      'Optional',
    );

    // An extra: found by its name, added as optional, and it can be removed again before the service exists.
    await page.getByLabel('Search indicators').fill(w.citations.name);
    await page.getByRole('button', { name: 'Search', exact: true }).click();
    await page.getByRole('button', { name: `Add ${w.citations.name} to this service` }).click();
    const extra = page.getByRole('row').filter({ hasText: w.citations.name });
    await expect(extra).toContainText('Optional');
    await expect(extra).toContainText('Added for this service');
    await page
      .getByRole('button', { name: `Remove ${w.citations.name} from this service` })
      .click();
    await expect(page.getByRole('row').filter({ hasText: w.citations.name })).toHaveCount(0);
    await page.getByRole('button', { name: `Add ${w.citations.name} to this service` }).click();
    await expect(page.getByRole('row').filter({ hasText: w.citations.name })).toHaveCount(1);
    await page.getByRole('button', { name: 'Create service' }).click();
    await expect(page.getByRole('heading', { name: 'Service created' })).toBeVisible();

    // The service page has the section: the set, the rows with their necessity, the extra, and the way to change them.
    await page.goto(at(`/services/${tag}-svc`));
    const section = page.getByTestId('service-kpis');
    await expect(section.getByRole('heading', { name: 'KPIs' })).toBeVisible();
    await expect(section.getByText(w.first.name)).toBeVisible();
    await expect(section.getByRole('row').filter({ hasText: w.views.name })).toContainText(
      'Mandatory',
    );
    await expect(section.getByRole('row').filter({ hasText: w.citations.name })).toContainText(
      'Added for this service',
    );

    // Change the set (the extra stays), then remove the extra, and save once.
    await section.getByRole('button', { name: 'Change KPIs' }).click();
    await section.getByLabel('KPI set', { exact: true }).selectOption({ label: w.second.name });
    await expect(section.getByRole('row').filter({ hasText: w.views.name })).toHaveCount(0);
    // The extra is the new set's own row now: it is listed once, from the set, and cannot be removed.
    await expect(section.getByRole('row').filter({ hasText: w.citations.name })).toContainText(
      'From the KPI set (fixed)',
    );
    await section.getByLabel('Search indicators').fill(w.users.name);
    await section.getByRole('button', { name: 'Search', exact: true }).click();
    await section.getByRole('button', { name: `Add ${w.users.name} to this service` }).click();
    await section.getByRole('button', { name: `Remove ${w.users.name} from this service` }).click();
    await section.getByRole('button', { name: 'Save KPIs' }).click();
    await expect(section.getByText('The KPIs were saved.')).toBeVisible();
    await expect(section.getByText(w.second.name)).toBeVisible();
    await expect(section.getByRole('row').filter({ hasText: w.views.name })).toHaveCount(0);
    await expect(section.getByRole('row').filter({ hasText: w.users.name })).toHaveCount(0);

    // What the person saw is what the server has: the set replaced, the extra the set contains dropped, none added.
    const kpis = await api.get<{
      set: { id: string };
      extras: unknown[];
      rows: { name: string; source: string }[];
    }>(`/kpi/services/${(await api.get<{ id: string }>(`/services/by-slug/${tag}-svc`)).id}/kpis`);
    expect(kpis.set.id).toBe(w.second.id);
    expect(kpis.extras).toEqual([]);
    expect(kpis.rows.map((row) => row.name)).toEqual([w.citations.name]);

    // The catalogue has the facet and the filter, in words: the name of the set, and "No KPI set".
    await page.goto(at(`/services?q=${tag}`));
    await expect(page.getByRole('row').filter({ hasText: name })).toBeVisible();
    await page.goto(at(`/services?f.kpi-set=${w.second.id}`));
    await expect(page.getByRole('row').filter({ hasText: name })).toBeVisible();
    await page.goto(at(`/services?f.kpi-set=${w.first.id}`));
    await expect(page.getByRole('row').filter({ hasText: name })).toHaveCount(0);
    await opened.close();

    // A plain member of the provider and a member of another provider read the section and are not offered the change.
    const plainPage = await pageAs(browser, baseURL, at, plain);
    await plainPage.page.goto(at(`/services/${tag}-svc`));
    await expect(plainPage.page.getByTestId('service-kpis').getByText(w.second.name)).toBeVisible();
    await expect(
      plainPage.page.getByTestId('service-kpis').getByRole('button', { name: 'Change KPIs' }),
    ).toHaveCount(0);
    await plainPage.close();
    const other = await pageAs(browser, baseURL, at, stranger);
    await other.page.goto(at(`/services/${tag}-svc`));
    const theirs = other.page.getByTestId('service-kpis');
    await expect(theirs.getByText(w.second.name)).toBeVisible();
    await expect(theirs.getByRole('button', { name: 'Change KPIs' })).toHaveCount(0);
    await other.close();
    await api.dispose();
  });
});

for (const scheme of ['light', 'dark'] as const) {
  test.describe(`the wizard step and the service section of the KPIs, ${scheme} theme`, () => {
    test.use({ reducedMotion: 'reduce' });
    test('have no serious accessibility violation', async ({
      browser,
      playwright,
      baseURL,
      at,
    }) => {
      test.slow();
      const api = await adminApi(playwright, baseURL, at);
      const tag = unique(`kx${scheme.slice(0, 1)}`);
      const w = await kpiWorld(api, tag);
      const provider = await makeOrg(api, uniqueAbbreviation('KXA'));
      const member = newPerson('kpiax');
      await memberOf(api, playwright, baseURL, at, member, provider, 'manager');
      const made = await api.send('POST', '/services', {
        slug: `${tag}-svc`,
        name: `${tag} service`,
        provider: provider.id,
        kpiSet: { setId: w.first.id, extras: [w.citations.id] },
      });
      expect(made.status, JSON.stringify(made.body)).toBe(201);
      const opened = await pageAs(browser, baseURL, at, member);
      const page = opened.page;
      await page.emulateMedia({ colorScheme: scheme, reducedMotion: 'reduce' });
      const clean = async (what: string) => expect(await violations(page), what).toEqual([]);

      await page.goto(at('/services/new'));
      await page.getByLabel(/^Short name/).fill(`${tag}-new`);
      await page.getByLabel(/^Name/).fill(`${tag} new`);
      await page.getByRole('button', { name: 'Next' }).click();
      await page.getByLabel(/^Operated by/).selectOption(provider.id);
      await page.getByRole('button', { name: 'Next' }).click();
      await page.getByRole('button', { name: 'Next' }).click();
      await expect(page.getByRole('heading', { name: 'Step 4 of 4: KPIs' })).toBeVisible();
      await clean('the wizard step without a set');
      await page.getByLabel('KPI set', { exact: true }).selectOption({ label: w.first.name });
      await expect(page.getByRole('row').filter({ hasText: w.views.name })).toBeVisible();
      await page.getByLabel('Search indicators').fill(w.users.name);
      await page.getByRole('button', { name: 'Search', exact: true }).click();
      await expect(
        page.getByRole('button', { name: `Add ${w.users.name} to this service` }),
      ).toBeVisible();
      await clean('the wizard step with a set, its rows and a search');
      await page.getByRole('button', { name: `Add ${w.users.name} to this service` }).click();
      await clean('the wizard step with an extra added');

      await page.goto(at(`/services/${tag}-svc`));
      const section = page.getByTestId('service-kpis');
      await expect(section.getByText(w.first.name)).toBeVisible();
      await clean('the service page with the KPIs section');
      await section.getByRole('button', { name: 'Change KPIs' }).click();
      await expect(section.getByLabel('KPI set', { exact: true })).toBeVisible();
      await clean('the section in edit mode');
      await opened.close();
      await api.dispose();
    });
  });
}

// The calls the KPI parts add to pages that already load (plan §0 item 5, §10). The loaders of the pages run on the server
// and are unchanged; what the browser sends itself is counted here and written into the report of the run.
test.describe('the calls the KPI parts add', () => {
  test('are one for the service page (and two vocabulary reads, once), and none for the wizard step until a set is chosen or a search is made', async ({
    browser,
    playwright,
    baseURL,
    at,
  }) => {
    test.slow();
    const api = await adminApi(playwright, baseURL, at);
    const tag = unique('kc');
    const w = await kpiWorld(api, tag);
    const provider = await makeOrg(api, uniqueAbbreviation('KCA'));
    const member = newPerson('kpicall');
    await memberOf(api, playwright, baseURL, at, member, provider);
    const made = await api.send('POST', '/services', {
      slug: `${tag}-svc`,
      name: `${tag} service`,
      provider: provider.id,
      kpiSet: { setId: w.first.id, extras: [] },
    });
    expect(made.status, JSON.stringify(made.body)).toBe(201);
    const opened = await pageAs(browser, baseURL, at, member);
    const page = opened.page;
    const seen: string[] = [];
    page.on('request', (request) => {
      const path = new URL(request.url()).pathname;
      if (path.includes('/api/internal/'))
        seen.push(`${request.method()} ${path.slice(path.indexOf('/api/internal/') + 13)}`);
    });
    const kpiCalls = () => seen.filter((call) => /\/kpi\/|\/vocabularies\//.test(call));

    // The service page: the one read of the KPIs and the two vocabularies for the words.
    await page.goto(at(`/services/${tag}-svc`));
    await expect(page.getByTestId('service-kpis').getByText(w.first.name)).toBeVisible();
    const onPage = kpiCalls();
    test.info().annotations.push({ type: 'service page', description: onPage.join(' | ') });
    console.log(`[kpi-calls] service page: ${onPage.join(' | ')}`);
    expect(onPage.filter((call) => call.includes('/kpi/services/'))).toHaveLength(1);
    expect(onPage.filter((call) => call.includes('/vocabularies/')).length).toBeLessThanOrEqual(2);
    expect(onPage.filter((call) => !/\/kpi\/services\/|\/vocabularies\//.test(call))).toEqual([]);

    // A second visit asks for the vocabularies of nobody (kept for the session): the client navigates inside the app.
    seen.length = 0;
    await page.getByRole('link', { name: 'Services' }).first().click();
    await page.getByRole('searchbox', { name: 'Search by name or short name' }).fill(tag);
    await page.getByRole('button', { name: 'Search' }).click();
    await page.getByRole('link', { name: `${tag} service` }).click();
    await expect(page.getByTestId('service-kpis').getByText(w.first.name)).toBeVisible();
    test.info().annotations.push({
      type: 'service page, second visit',
      description: kpiCalls().join(' | '),
    });
    console.log(`[kpi-calls] service page, second visit: ${kpiCalls().join(' | ')}`);
    expect(kpiCalls().filter((call) => call.includes('/vocabularies/'))).toEqual([]);
    expect(kpiCalls().filter((call) => call.includes('/kpi/services/'))).toHaveLength(1);

    // The wizard step: nothing of the KPI parts is asked for until a set is chosen.
    seen.length = 0;
    await page.goto(at('/services/new'));
    await page.getByLabel(/^Short name/).fill(`${tag}-new`);
    await page.getByLabel(/^Name/).fill(`${tag} new`);
    await page.getByRole('button', { name: 'Next' }).click();
    await page.getByLabel(/^Operated by/).selectOption(provider.id);
    await page.getByRole('button', { name: 'Next' }).click();
    await page.getByRole('button', { name: 'Next' }).click();
    await expect(page.getByRole('heading', { name: 'Step 4 of 4: KPIs' })).toBeVisible();
    await expect(page.getByLabel('KPI set', { exact: true })).toBeVisible();
    const onStep = kpiCalls();
    test.info().annotations.push({
      type: 'wizard step, on arrival',
      description: onStep.join(' | ') || 'none',
    });
    console.log(`[kpi-calls] wizard step, on arrival: ${onStep.join(' | ') || 'none'}`);
    // On arrival nothing of the KPI parts is asked for: the sets came with the schema.
    expect(onStep).toEqual([]);
    seen.length = 0;
    await page.getByLabel('KPI set', { exact: true }).selectOption({ label: w.first.name });
    await expect(page.getByRole('row').filter({ hasText: w.views.name })).toBeVisible();
    await expect(page.getByRole('row').filter({ hasText: w.views.name })).toContainText(
      'Mandatory',
    );
    const onChoice = kpiCalls();
    test
      .info()
      .annotations.push({ type: 'wizard step, a set chosen', description: onChoice.join(' | ') });
    console.log(`[kpi-calls] wizard step, a set chosen: ${onChoice.join(' | ')}`);
    // The set's rows, and the words of the necessity and the unit (once per session).
    expect(onChoice.filter((call) => call.includes('/kpi/sets/'))).toHaveLength(1);
    expect(onChoice.filter((call) => call.includes('/vocabularies/')).length).toBeLessThanOrEqual(
      2,
    );
    expect(onChoice).toHaveLength(
      onChoice.filter((call) => /\/kpi\/sets\/|\/vocabularies\//.test(call)).length,
    );
    seen.length = 0;
    await page.getByLabel('Search indicators').fill(w.citations.name);
    await page.getByRole('button', { name: 'Search', exact: true }).click();
    await expect(
      page.getByRole('button', { name: `Add ${w.citations.name} to this service` }),
    ).toBeVisible();
    test
      .info()
      .annotations.push({ type: 'wizard step, a search', description: kpiCalls().join(' | ') });
    console.log(`[kpi-calls] wizard step, a search: ${kpiCalls().join(' | ')}`);
    expect(kpiCalls()).toHaveLength(1);
    await opened.close();
    await api.dispose();
  });
});

// M9 sprint 4: the whole road of an indicator, from the form to the API. An administrator creates an indicator with a unit,
// builds a KPI set mapped to a RIMO category, creates a service with that set in the wizard, changes the set on the service
// page, then reads the indicators and the RDF through the reference page with a token, and without one where the reads are
// public. Under both base paths.

/** Makes a token on the profile page, as a person does, and returns its secret. */
async function makeToken(page: Page, name: string, scope: string): Promise<string> {
  const tokens = page.getByRole('region', { name: 'Access tokens' });
  await tokens.getByLabel('Name', { exact: true }).fill(name);
  await tokens.getByRole('checkbox', { name: scope }).check();
  await tokens.getByRole('button', { name: 'Create the token' }).click();
  const secret = (await page.getByTestId('token-secret').textContent())!;
  await page.getByRole('button', { name: 'I have copied it' }).click();
  await tokens.getByRole('checkbox', { name: scope }).uncheck();
  return secret;
}

test.describe('journey: from the indicator form to the RDF read', () => {
  test('an indicator with a unit reaches a service through a set, and the API and the RDF say so', async ({
    page,
    playwright,
    baseURL,
    at,
  }) => {
    test.slow();
    const api = await adminApi(playwright, baseURL, at);
    const tag = unique('kr');
    const views = `Views ${tag}`;
    const setName = `Set ${tag}`;
    const otherSet = await api.send('POST', '/kpi/sets', { name: `Other set ${tag}` });
    expect(otherSet.status, JSON.stringify(otherSet.body)).toBe(201);
    const provider = await makeOrg(api, uniqueAbbreviation('KRA'));
    await signInThroughPage(page, at, admin);

    // The indicator, with a unit and a bound.
    await page.goto(at('/kpi/indicators/new'));
    await page.getByLabel(/^Name/).fill(views);
    await page.getByLabel(/^Thematic category/).selectOption({ label: 'Usage' });
    await page.getByLabel(/^Value type/).selectOption({ label: 'Whole number' });
    await page.getByLabel('Unit').selectOption({ label: 'Count' });
    await page.getByLabel('Smallest value').fill('0');
    await page.getByRole('button', { name: 'Create the indicator' }).click();
    await expect(toast(page).getByText(`${views} was created.`)).toBeVisible();

    // The set, mapped to a RIMO category, with the indicator as mandatory.
    await page.goto(at('/kpi/sets/new'));
    await page.getByLabel(/^Name/).fill(setName);
    await page.getByLabel('RIMO category').selectOption({ label: 'Web application' });
    await page.getByRole('button', { name: 'Create the KPI set' }).click();
    await expect(toast(page).getByText(`${setName} was created.`)).toBeVisible();
    await page.getByLabel('Search indicators').fill(tag);
    await page.getByRole('button', { name: 'Search', exact: true }).last().click();
    await page.getByRole('button', { name: `Add ${views}` }).click();
    await page.getByLabel(`Necessity of ${views}`).selectOption({ label: 'Mandatory' });
    await page.getByRole('button', { name: 'Save the indicators' }).click();
    await expect(toast(page).getByText('The indicators were saved.')).toBeVisible();

    // A service with that set, made in the wizard.
    await page.goto(at('/services/new'));
    await page.getByLabel(/^Short name/).fill(`${tag}-svc`);
    await page.getByLabel(/^Name/).fill(`${tag} service`);
    await page.getByRole('button', { name: 'Next' }).click();
    await page.getByLabel(/^Operated by/).selectOption(provider.id);
    await page.getByRole('button', { name: 'Next' }).click();
    await page.getByRole('button', { name: 'Next' }).click();
    await page.getByLabel('KPI set', { exact: true }).selectOption({ label: setName });
    await expect(page.getByRole('row').filter({ hasText: views })).toContainText('Mandatory');
    await page.getByRole('button', { name: 'Create service' }).click();
    await expect(page.getByRole('heading', { name: 'Service created' })).toBeVisible();

    // The set is changed on the service page.
    await page.goto(at(`/services/${tag}-svc`));
    const section = page.getByTestId('service-kpis');
    await expect(section.getByText(setName)).toBeVisible();
    await section.getByRole('button', { name: 'Change KPIs' }).click();
    await section
      .getByLabel('KPI set', { exact: true })
      .selectOption({ label: `Other set ${tag}` });
    await section.getByRole('button', { name: 'Save KPIs' }).click();
    await expect(section.getByText('The KPIs were saved.')).toBeVisible();
    const service = await api.get<{ id: string }>(`/services/by-slug/${tag}-svc`);
    const kpis = await api.get<{ set: { id: string } }>(`/kpi/services/${service.id}/kpis`);
    expect(kpis.set.id).toBe((otherSet.body as { id: string }).id);

    // A token with the scope of the KPI reads; the reference page makes the calls.
    await page.goto(at('/profile'));
    const good = await makeToken(page, `kr${tag}`, 'kpi.framework.v1.read');
    await openReference(page, at);
    const indicators = await callFromReference(page, 'List the indicators', good);
    expect(indicators.status).toMatch(/^200\b/);
    const turtle = await callFromReference(
      page,
      'Read the indicators and KPI sets as RDF (Turtle)',
      good,
    );
    expect(turtle.status).toMatch(/^200\b/);
    // Scalar does not draw a Turtle answer, so the text is checked by the plain request below; the status is the server's.
    const jsonLd = await callFromReference(
      page,
      'Read the indicators and KPI sets as RDF (JSON-LD)',
      good,
    );
    expect(jsonLd.status).toMatch(/^200\b/);

    // The same through plain requests: the indicator with its unit, the RDF with the mapped category and no service.
    const program = await playwright.request.newContext({
      baseURL,
      extraHTTPHeaders: { authorization: `Bearer ${good}` },
    });
    const list = await program.get(
      at(`/api/v1/indicators?category=${encodeURIComponent(setName)}`),
    );
    expect(list.status()).toBe(200);
    const { result, metadata } = (await list.json()) as {
      metadata: { totalCount: number };
      result: { name: string; unit: { key: string; symbol: string | null }; necessity: string }[];
    };
    expect(metadata.totalCount).toBe(1);
    expect(result[0]).toMatchObject({
      name: views,
      unit: { key: 'count' },
      necessity: 'mandatory',
    });
    const ttl = await program.get(at('/api/v1/kpi/rimo.ttl'));
    expect(ttl.status()).toBe(200);
    expect(ttl.headers()['content-type']).toBe('text/turtle; charset=utf-8');
    expect(ttl.headers()['cache-control']).toBe('private, no-cache');
    const body = await ttl.text();
    expect(body).toContain(`rimo:KPIName "${views}"`);
    expect(body).toContain('rimo:mandatoryFor rimo:Web_application');
    expect(body).toContain('rimo:hasUnit uo:0000189');
    expect(body).not.toContain(`${tag}-svc`);
    expect(body).not.toContain(`${tag} service`);
    expect((await program.get(at('/api/v1/kpi/rimo.jsonld'))).status()).toBe(200);
    const anonymous = await playwright.request.newContext({ baseURL });
    expect((await anonymous.get(at('/api/v1/kpi/rimo.ttl'))).status()).toBe(401);

    // Without a token: the public definitions are the same document, with an ETag that gets 304.
    const open = await anonymous.get(at('/api/internal/public/kpi/rimo.ttl'));
    expect(open.status()).toBe(200);
    expect(await open.text()).toBe(body);
    expect(open.headers()['cache-control']).toBe('public, max-age=300');
    const etag = open.headers().etag!;
    expect(etag).toMatch(/^"[0-9a-f]{32}"$/);
    const again = await anonymous.get(at('/api/internal/public/kpi/rimo.ttl'), {
      headers: { 'if-none-match': etag },
    });
    expect(again.status()).toBe(304);
    const openJson = await anonymous.get(at('/api/internal/public/kpi/rimo.jsonld'));
    expect(openJson.status()).toBe(200);
    expect(openJson.headers()['content-type']).toBe('application/ld+json; charset=utf-8');

    // Clean up what this run made that others could trip over: the service stays (nothing deletes a service), the set goes.
    await program.dispose();
    await anonymous.dispose();
    await api.dispose();
  });
});

// The reads and the landing page speak to a person who is not signed in: the page lists the routes and the reference shows them.
test.describe('the landing page and the reference list the RDF reads', () => {
  test('the routes are on /docs with their scope, and the reference has them with the token scheme', async ({
    page,
    at,
  }) => {
    await signInThroughPage(page, at, admin);
    await page.goto(at('/docs'));
    for (const path of ['/kpi/rimo.ttl', '/kpi/rimo.jsonld']) {
      const row = page
        .getByRole('row')
        .filter({ has: page.getByRole('cell', { name: path, exact: true }) });
      await expect(row).toContainText('kpi.framework.v1.read');
    }
    await openReference(page, at);
    await expect(
      page.getByRole('link', { name: 'Read the indicators and KPI sets as RDF (Turtle)' }),
    ).toBeVisible();
    await expect(
      page.getByRole('link', { name: 'Read the indicators and KPI sets as RDF (JSON-LD)' }),
    ).toBeVisible();
    await expect(page.getByRole('textbox', { name: 'Token' }).first()).toBeVisible();
  });
});
