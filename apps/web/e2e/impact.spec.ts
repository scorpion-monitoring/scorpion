import type { Page } from '@playwright/test';
import { violations } from './support/a11y.ts';
import { activeUser, adminApi, apiAs, newPerson, unique, type AdminApi } from './support/admin.ts';
import { report } from './support/dashboard.ts';
import { admin, expect, signInThroughPage, test } from './support/fixtures.ts';
import { makeOrg, pageAs, uniqueAbbreviation, type Org } from './support/members.ts';
import { makeCatalogueService, makeConsortium, makeReviewer } from './support/services.ts';

// M12 sprint 4: the impact page at /services/evaluate. A Reviewer picks a consortium and sees the counts of its services (a stage that was
// deactivated, with its label, and a service with no licence), changes the year and sees the table change, and reads every state of a row in
// words. A plain User and an anonymous visitor cannot open the page or call the routes. A measurement that is reported shows on the page after
// a reload. The keyboard reaches everything, axe finds nothing serious in either theme, and the page's own requests are counted
// (`[impact-calls]`). Every test makes its own data under names of its own (the specs of a run share one database) and runs under both base paths.
//
// Rows that are `error` (a text headline, an aggregate with no function) cannot be made through the API: the keys of the database and the checks of
// kpi.framework refuse them, so `service/rows.test.ts` covers them with faked reads and `ui.test.ts` checks that every code has a sentence.

const YEAR = new Date().getUTCFullYear();
const BEFORE = YEAR - 1;

interface Made {
  id: string;
  slug: string;
  name: string;
}

interface World {
  api: AdminApi;
  tag: string;
  consortium: Org;
  /** What the picker shows: the name and the abbreviation. */
  option: string;
  stageKey: string;
  stageLabel: string;
  /** Published: alpha (sum of downloads, three months of last year), beta (no values), gamma (the sunset stage, durations), delta (no KPI set), epsilon (no headline). */
  alpha: Made;
  beta: Made;
  gamma: Made;
  delta: Made;
  epsilon: Made;
  /** Not published, in the consortium too. */
  hidden: Made;
  indicators: { downloads: string; uptime: string };
  reviewer: ReturnType<typeof newPerson>;
  plain: ReturnType<typeof newPerson>;
}

async function make(api: AdminApi, path: string, body: unknown, status = 201) {
  const made = await api.send('POST', path, body);
  expect(made.status, `${path} ${JSON.stringify(made.body)}`).toBe(status);
  return (made.body as { id: string }).id;
}

/** A consortium of five published services, one that is not published and, when asked, `fillers` more published ones (for a second page). */
async function world(
  playwright: Parameters<typeof adminApi>[0],
  baseURL: string | undefined,
  at: (path: string) => string,
  fillers = 0,
): Promise<World> {
  const api = await adminApi(playwright, baseURL, at);
  const tag = unique('im');
  const abbreviation = uniqueAbbreviation('IMC');
  const consortium = await makeConsortium(api, abbreviation);
  const provider = await makeOrg(api, uniqueAbbreviation('IMP'));

  const stageKey = `IMP${unique('s').toUpperCase()}`;
  const stageLabel = `Sunset ${tag}`;
  const term = await api.send('POST', '/vocabularies/stage/terms', {
    key: stageKey,
    labels: { en: stageLabel },
  });
  expect(term.status, JSON.stringify(term.body)).toBe(201);

  const downloads = await make(api, '/kpi/indicators', {
    name: `Downloads ${tag}`,
    thematic: 'Usage',
    valueType: 'integer',
    unit: 'count',
  });
  const uptime = await make(api, '/kpi/indicators', {
    name: `Uptime ${tag}`,
    thematic: 'Technical',
    valueType: 'duration',
  });
  const setOf = async (name: string, indicator: string | undefined, aggregate?: string) => {
    const id = await make(api, '/kpi/sets', { name: `${name} ${tag}` });
    const rows = await api.send('PUT', `/kpi/sets/${id}/indicators`, {
      indicators: [downloads, uptime].map((indicatorId) => ({
        indicatorId,
        necessity: 'optional',
      })),
    });
    expect(rows.status, JSON.stringify(rows.body)).toBe(200);
    if (indicator) {
      const headline = await api.send('PUT', `/kpi/sets/${id}/evaluation`, {
        indicatorId: indicator,
        aggregate,
      });
      expect(headline.status, JSON.stringify(headline.body)).toBe(200);
    }
    return id;
  };
  const sumSet = await setOf('Sum set', downloads, 'sum');
  const timeSet = await setOf('Time set', uptime, 'avg');
  const bareSet = await setOf('Bare set', undefined);

  const service = async (
    suffix: string,
    over: { stage: string; license?: string; setId?: string },
  ): Promise<Made> => {
    const made = await makeCatalogueService(api, `${tag}-${suffix}`, {
      name: `${tag} ${suffix}`,
      provider: provider.id,
      consortia: [consortium.id],
      stage: over.stage,
      ...(over.license ? { license: over.license } : {}),
      ...(over.setId ? { kpiSet: { setId: over.setId, extras: [] } } : {}),
    });
    return made;
  };
  const alpha = await service('alpha', { stage: 'PROD', license: 'MIT', setId: sumSet });
  const beta = await service('beta', { stage: 'DEV', setId: sumSet });
  const gamma = await service('gamma', { stage: stageKey, license: 'MIT', setId: timeSet });
  const delta = await service('delta', { stage: 'PROD', license: 'MIT' });
  const epsilon = await service('epsilon', { stage: 'PROD', license: 'MIT', setId: bareSet });
  const hidden = await service('hidden', { stage: 'PROD', license: 'MIT', setId: sumSet });
  const published = [alpha, beta, gamma, delta, epsilon];
  for (let index = 1; index <= fillers; index++)
    published.push(
      await service(`fill-${String(index).padStart(2, '0')}`, { stage: 'PROD', license: 'MIT' }),
    );
  for (const made of published) {
    const done = await api.send('PUT', `/services/${made.id}/publication`, { public: true });
    expect(done.status, JSON.stringify(done.body)).toBe(200);
  }
  // The stage is deactivated after a service has it: the vocabulary keeps the term, the page must still count and name it.
  const off = await api.send('PATCH', `/vocabularies/stage/terms/${stageKey}`, { active: false });
  expect(off.status, JSON.stringify(off.body)).toBe(200);

  // Last year: alpha has 5, 7 and 9 in January, February and March (sum 21 over three months); gamma has one and two hours (average 1:30:00).
  for (const [month, value] of [
    ['01', '5'],
    ['02', '7'],
    ['03', '9'],
  ] as const)
    await report(api, alpha.id, `${BEFORE}-${month}`, { [downloads]: value });
  await report(api, gamma.id, `${BEFORE}-01`, { [uptime]: '01-00-00' });
  await report(api, gamma.id, `${BEFORE}-02`, { [uptime]: '02-00-00' });
  // A value of an unpublished service never shows by default.
  await report(api, hidden.id, `${BEFORE}-01`, { [downloads]: '1000' });

  const reviewer = newPerson('imrev');
  await makeReviewer(api, at, reviewer);
  const plain = newPerson('impln');
  await activeUser(api, at, plain);
  return {
    api,
    tag,
    consortium,
    option: `${consortium.name} (${consortium.abbreviation})`,
    stageKey,
    stageLabel,
    alpha,
    beta,
    gamma,
    delta,
    epsilon,
    hidden,
    indicators: { downloads, uptime },
    reviewer,
    plain,
  };
}

const PAGE = '/services/evaluate';
const picker = (page: Page) => page.getByRole('combobox', { name: 'Consortium', exact: true });
const yearSelect = (page: Page) => page.getByRole('combobox', { name: 'Year', exact: true });
const unpublished = (page: Page) =>
  page.getByRole('checkbox', { name: 'Include unpublished services' });
/** The big number of a tile. */
const tileNumber = (page: Page, tile: string) => page.locator(`[data-tile="${tile}"] span`).first();
const sizeSelect = (page: Page) => page.getByRole('combobox', { name: 'Rows per page' });
const live = (page: Page) => page.getByRole('status').filter({ hasText: /^Table of \d{4} for / });
const rowOf = (page: Page, made: Made) =>
  page.getByRole('row').filter({ has: page.getByRole('link', { name: made.name, exact: true }) });
/** The cells of a row after its row header: 0 is the state, 1 the headline, 2 to 13 the months, 14 the year. */
const cells = (page: Page, made: Made) => rowOf(page, made).getByRole('cell');
const MONTH = (month: number) => 1 + month;
const YEARLY = 14;

async function open(page: Page, at: (path: string) => string, w: World) {
  await page.goto(at(PAGE));
  await expect(page.getByRole('heading', { name: 'Impact evaluation', level: 1 })).toBeVisible();
  await picker(page).selectOption({ label: w.option });
  await expect(page.getByRole('heading', { name: `Figures of ${w.option}` })).toBeVisible();
}

test.describe('the impact page', () => {
  test('a Reviewer picks a consortium and sees the counts: a deactivated stage with its label, a service with no licence, and what each line means', async ({
    browser,
    playwright,
    baseURL,
    at,
  }) => {
    test.slow();
    const w = await world(playwright, baseURL, at);
    const { page, close } = await pageAs(browser, baseURL, at, w.reviewer);
    await page.goto(at('/'));
    await page
      .getByRole('navigation', { name: 'Main navigation' })
      .getByRole('link', { name: 'Impact', exact: true })
      .click();
    await expect(page).toHaveURL(new RegExp(`${at(PAGE)}$`));
    await expect(page.getByText('Choose a consortium to see its figures.')).toBeVisible();
    await expect(page.getByText('computed when you open the page')).toBeVisible();
    await expect(page.getByText('today’s headline')).toBeVisible();

    await picker(page).selectOption({ label: w.option });
    await expect(page.getByRole('heading', { name: `Figures of ${w.option}` })).toBeVisible();
    await expect(page.getByText('The figures are for published services only.')).toBeVisible();

    // Five published services; the unpublished one is not counted. The licence lines and the stage lines each add up to the five.
    await expect(tileNumber(page, 'licence-openSource')).toHaveText('4');
    await expect(tileNumber(page, 'licence-unknown')).toHaveText('1');
    await expect(tileNumber(page, 'licence-deprecated')).toHaveText('0');
    await expect(tileNumber(page, 'licence-other')).toHaveText('0');
    await expect(
      page.getByRole('list', { name: 'Services' }).getByText('5', { exact: true }),
    ).toBeVisible();
    await expect(tileNumber(page, 'stage-PROD')).toHaveText('3');
    await expect(tileNumber(page, 'stage-DEV')).toHaveText('1');
    // A stage nobody has is listed with a zero, and a stage that was deactivated is listed with its label and says so.
    await expect(tileNumber(page, 'stage-DEMO')).toHaveText('0');
    const sunset = page.locator(`[data-tile="stage-${w.stageKey}"]`);
    await expect(sunset).toContainText(w.stageLabel);
    await expect(sunset).toContainText('deactivated');
    await expect(sunset.locator('span').first()).toHaveText('1');
    // Every line is also text, and each licence line says what it means.
    await expect(page.getByText(`${w.stageLabel} (deactivated): 1`)).toBeVisible();
    await expect(
      page.getByText('Not counted as open source. Open the service and enter an SPDX licence.'),
    ).toBeVisible();
    await expect(
      page.getByText('These four lines add up to the number of services.'),
    ).toBeVisible();

    // The label is the vocabulary's own: the vocabulary editor shows the same text for the same key (defect 9, end to end).
    const terms = await w.api.get<{ result: { key: string; labels: Record<string, string> }[] }>(
      '/vocabularies/stage/terms?page=0&pageSize=500&includeInactive=true',
    );
    expect(terms.result.find((term) => term.key === w.stageKey)?.labels.en).toBe(w.stageLabel);
    await close();
  });

  test('the vocabulary editor and the page show the same label for a stage, in both states of the term', async ({
    browser,
    playwright,
    baseURL,
    at,
  }) => {
    test.slow();
    const w = await world(playwright, baseURL, at);
    const { page, close } = await pageAs(browser, baseURL, at, w.reviewer);
    await open(page, at, w);
    await expect(page.locator(`[data-tile="stage-${w.stageKey}"]`)).toContainText(w.stageLabel);
    await close();

    // The administrator's vocabulary editor lists the term by key with the label of the page.
    const adminPage = await browser.newContext({ baseURL });
    const editor = await adminPage.newPage();
    await signInThroughPage(editor, at, admin);
    await editor.goto(at('/admin/settings/vocabularies'));
    await editor.getByLabel('Vocabulary').selectOption('stage');
    const table = editor.getByRole('table', { name: 'Terms of stage' });
    const row = table.getByRole('row').filter({ hasText: w.stageKey });
    await expect(row).toContainText(w.stageLabel);
    await expect(row).toContainText('Inactive');
    await adminPage.close();
  });

  test('changing the year changes the table; the words, the yearly figure with n of 12 months, a duration as HH:MM:SS and the live region', async ({
    browser,
    playwright,
    baseURL,
    at,
  }) => {
    test.slow();
    const w = await world(playwright, baseURL, at);
    const { page, close } = await pageAs(browser, baseURL, at, w.reviewer);
    await open(page, at, w);

    // The current year is chosen first and the services have no value in it.
    await expect(yearSelect(page)).toHaveValue(String(YEAR));
    await expect(page.getByRole('heading', { name: `Table of ${YEAR}`, level: 2 })).toBeVisible();
    await expect(live(page)).toHaveText(`Table of ${YEAR} for ${w.option}: 5 services`);
    await expect(cells(page, w.alpha).nth(0)).toContainText('No values');

    // Focus stays on the year select while the table changes under it.
    await yearSelect(page).focus();
    await yearSelect(page).selectOption(String(BEFORE));
    await expect(page.getByRole('heading', { name: `Table of ${BEFORE}`, level: 2 })).toBeVisible();
    await expect(yearSelect(page)).toBeFocused();
    await expect(live(page)).toHaveText(`Table of ${BEFORE} for ${w.option}: 5 services`);
    expect(new URL(page.url()).searchParams.get('year')).toBe(String(BEFORE));

    // The ten years the route offers.
    expect(await yearSelect(page).locator('option').allTextContents()).toEqual(
      Array.from({ length: 10 }, (_, index) => String(YEAR - index)),
    );

    // alpha: 5, 7, 9 in January to March, the sum with "3 of 12 months"; the other nine months say "no value".
    await expect(cells(page, w.alpha).nth(0)).toContainText('Figures available');
    await expect(cells(page, w.alpha).nth(1)).toContainText(`Downloads ${w.tag}`);
    await expect(cells(page, w.alpha).nth(1)).toContainText('Unit: Count');
    await expect(cells(page, w.alpha).nth(MONTH(1))).toHaveText('5');
    await expect(cells(page, w.alpha).nth(MONTH(2))).toHaveText('7');
    await expect(cells(page, w.alpha).nth(MONTH(3))).toHaveText('9');
    await expect(cells(page, w.alpha).nth(MONTH(4))).toHaveText(/–\s*no value/);
    await expect(cells(page, w.alpha).nth(YEARLY)).toContainText('21');
    await expect(cells(page, w.alpha).nth(YEARLY)).toContainText('3 of 12 months');
    await expect(cells(page, w.alpha).nth(YEARLY)).toContainText('Sum');
    // gamma: the durations are HH:MM:SS, and the yearly figure is the average of the two months.
    await expect(cells(page, w.gamma).nth(MONTH(1))).toHaveText('01:00:00');
    await expect(cells(page, w.gamma).nth(MONTH(2))).toHaveText('02:00:00');
    await expect(cells(page, w.gamma).nth(YEARLY)).toContainText('01:30:00');
    await expect(cells(page, w.gamma).nth(YEARLY)).toContainText('2 of 12 months');
    await expect(cells(page, w.gamma).nth(YEARLY)).toContainText('Average');
    // The unpublished service and its 1000 are not there.
    await expect(rowOf(page, w.hidden)).toHaveCount(0);

    // The service name links to the service page, under the base path.
    await expect(page.getByRole('link', { name: w.alpha.name, exact: true })).toHaveAttribute(
      'href',
      at(`/services/${w.alpha.slug}`),
    );
    await close();
  });

  test('every state says in words what to do, and no cell is blank', async ({
    browser,
    playwright,
    baseURL,
    at,
  }) => {
    test.slow();
    const w = await world(playwright, baseURL, at);
    const { page, close } = await pageAs(browser, baseURL, at, w.reviewer);
    await page.goto(at(`${PAGE}?consortium=${w.consortium.id}&year=${BEFORE}`));
    await expect(rowOf(page, w.alpha)).toBeVisible();

    await expect(cells(page, w.beta).nth(0)).toContainText('No values');
    await expect(cells(page, w.beta).nth(0)).toContainText(
      'No value was reported for the headline KPI in this year. Ask the service to report its values.',
    );
    await expect(cells(page, w.delta).nth(0)).toContainText('No headline');
    await expect(cells(page, w.delta).nth(0)).toContainText('This service has no KPI set.');
    await expect(cells(page, w.delta).nth(1)).toContainText('No headline');
    await expect(cells(page, w.epsilon).nth(0)).toContainText(
      'The KPI set of this service has no headline. Ask an administrator to set the evaluation of the set.',
    );
    await expect(cells(page, w.delta).nth(YEARLY)).toHaveText(/–\s*No yearly figure/);

    // A state is an icon and words, never colour alone: each state cell has an svg and its words.
    for (const made of [w.alpha, w.beta, w.delta, w.epsilon])
      await expect(cells(page, made).nth(0).locator('svg')).toHaveCount(1);

    // No cell of the body is blank, to a screen reader as well.
    const blank = await page
      .locator('tbody td')
      .evaluateAll((all) => all.filter((cell) => (cell.textContent ?? '').trim() === '').length);
    expect(blank).toBe(0);
    await close();
  });

  test('the switch counts unpublished services, says which set the figures are for, and the address keeps the choices', async ({
    browser,
    playwright,
    baseURL,
    at,
  }) => {
    test.slow();
    const w = await world(playwright, baseURL, at);
    const { page, close } = await pageAs(browser, baseURL, at, w.reviewer);
    await page.goto(at(`${PAGE}?consortium=${w.consortium.id}&year=${BEFORE}`));
    await expect(page.getByText('The figures are for published services only.')).toBeVisible();
    await expect(rowOf(page, w.hidden)).toHaveCount(0);
    await expect(tileNumber(page, 'stage-PROD')).toHaveText('3');

    await unpublished(page).check();
    await expect(
      page.getByText('The figures are for all services of the consortium, published or not.'),
    ).toBeVisible();
    await expect(tileNumber(page, 'stage-PROD')).toHaveText('4');
    await expect(cells(page, w.hidden).nth(MONTH(1))).toHaveText('1,000');
    await expect(live(page)).toHaveText(`Table of ${BEFORE} for ${w.option}: 6 services`);
    const params = new URL(page.url()).searchParams;
    expect(params.get('unpublished')).toBe('1');
    expect(params.get('consortium')).toBe(w.consortium.id);

    await page.reload();
    await expect(unpublished(page)).toBeChecked();
    await expect(rowOf(page, w.hidden)).toBeVisible();
    await close();
  });

  test('a measurement that is reported shows on the page after a reload', async ({
    browser,
    playwright,
    baseURL,
    at,
  }) => {
    test.slow();
    const w = await world(playwright, baseURL, at);
    const { page, close } = await pageAs(browser, baseURL, at, w.reviewer);
    await page.goto(at(`${PAGE}?consortium=${w.consortium.id}&year=${BEFORE}`));
    await expect(cells(page, w.alpha).nth(YEARLY)).toContainText('21');
    await expect(cells(page, w.alpha).nth(YEARLY)).toContainText('3 of 12 months');

    await report(w.api, w.alpha.id, `${BEFORE}-04`, { [w.indicators.downloads]: '4' });
    await page.reload();
    await expect(cells(page, w.alpha).nth(MONTH(4))).toHaveText('4');
    await expect(cells(page, w.alpha).nth(YEARLY)).toContainText('25');
    await expect(cells(page, w.alpha).nth(YEARLY)).toContainText('4 of 12 months');
    await close();
  });

  test('a plain User and an anonymous visitor cannot open the page or call its routes [ASVS-8.2.1] [ASVS-8.3.1]', async ({
    browser,
    playwright,
    baseURL,
    at,
  }) => {
    test.slow();
    const w = await world(playwright, baseURL, at);
    const routes = [
      '/api/internal/kpi/impact/consortia',
      `/api/internal/kpi/impact/summary?consortium=${w.consortium.id}`,
      `/api/internal/kpi/impact/table?consortium=${w.consortium.id}&year=${YEAR}`,
    ];

    // A plain User: no entry in the navigation, the page is refused (403), the routes answer 403.
    const user = await pageAs(browser, baseURL, at, w.plain);
    await user.page.goto(at('/'));
    const nav = user.page.getByRole('navigation', { name: 'Main navigation' });
    await expect(nav.getByRole('link', { name: 'Data Submission' })).toBeVisible();
    await expect(nav.getByRole('link', { name: 'Impact', exact: true })).toHaveCount(0);
    expect((await user.page.goto(at(PAGE)))?.status()).toBe(403);
    await expect(user.page.getByRole('heading', { name: 'Impact evaluation' })).toHaveCount(0);
    const mine = await apiAs(playwright, baseURL, at, w.plain);
    for (const route of routes)
      expect((await mine.request.get(at(route))).status(), route).toBe(403);
    await mine.dispose();
    await user.close();

    // An anonymous visitor is sent to sign in, and the routes answer 401.
    const anonymous = await browser.newContext({ baseURL });
    const visitor = await anonymous.newPage();
    await visitor.goto(at(PAGE));
    await expect(visitor).toHaveURL(new RegExp(`${at('/login')}\\?returnTo=`));
    await expect(visitor.getByRole('heading', { name: 'Impact evaluation' })).toHaveCount(0);
    for (const route of routes)
      expect((await anonymous.request.get(at(route))).status(), route).toBe(401);
    await anonymous.close();

    // The Reviewer and the Administrator have the entry.
    const reviewer = await pageAs(browser, baseURL, at, w.reviewer);
    await reviewer.page.goto(at('/'));
    await expect(
      reviewer.page
        .getByRole('navigation', { name: 'Main navigation' })
        .getByRole('link', { name: 'Impact', exact: true }),
    ).toBeVisible();
    await reviewer.close();
  });

  test('works with the keyboard alone: the picker, the year, the switch, the table and the pages', async ({
    browser,
    playwright,
    baseURL,
    at,
  }) => {
    test.setTimeout(400_000);
    const w = await world(playwright, baseURL, at, 21);
    const { page, close } = await pageAs(browser, baseURL, at, w.reviewer);
    await page.goto(at(PAGE));
    await expect(picker(page)).toBeVisible();

    const reach = async (target: ReturnType<typeof picker>) => {
      for (let step = 0; step < 60; step++) {
        if (await target.evaluate((element) => element === document.activeElement)) return;
        await page.keyboard.press('Tab');
      }
      throw new Error('the keyboard cannot reach the control');
    };
    await reach(picker(page));
    // Typing the start of a name chooses the option; the figures follow.
    await page.keyboard.type(w.consortium.name, { delay: 10 });
    await expect(page.getByRole('heading', { name: `Figures of ${w.option}` })).toBeVisible();
    await expect(live(page)).toHaveText(`Table of ${YEAR} for ${w.option}: 26 services`);

    // The order is the picker, the year, the switch.
    await page.keyboard.press('Tab');
    await expect(yearSelect(page)).toBeFocused();
    await page.keyboard.type(String(BEFORE));
    await expect(page.getByRole('heading', { name: `Table of ${BEFORE}`, level: 2 })).toBeVisible();
    await expect(yearSelect(page)).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(unpublished(page)).toBeFocused();
    await page.keyboard.press('Space');
    await expect(unpublished(page)).toBeChecked();
    await expect(live(page)).toHaveText(`Table of ${BEFORE} for ${w.option}: 27 services`);

    // A page of 50 holds all of them; the size select is reached by the keyboard and 25 makes a second page.
    await sizeSelect(page).focus();
    await page.keyboard.type('25');
    await expect(sizeSelect(page)).toBeFocused();
    await expect(page.getByRole('row').filter({ has: page.getByRole('rowheader') })).toHaveCount(
      25,
    );
    const next = page.getByRole('button', { name: /next/i });
    await next.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('status').filter({ hasText: /26–27 of 27/ })).toBeVisible();
    await close();
  });

  test('is in German for a person whose language is German, with the German labels of the aggregates', async ({
    browser,
    playwright,
    baseURL,
    at,
  }) => {
    test.slow();
    const w = await world(playwright, baseURL, at);
    const context = await browser.newContext({ baseURL, locale: 'de-DE' });
    const page = await context.newPage();
    // The sign-in page is German too, so the session is made through the API in the same context.
    const login = await context.request.post(at('/api/internal/auth/login'), { data: w.reviewer });
    expect(login.status(), await login.text()).toBe(200);
    await page.goto(at(`${PAGE}?consortium=${w.consortium.id}&year=${BEFORE}`));
    await expect(page.getByRole('heading', { name: 'Wirkungsbewertung', level: 1 })).toBeVisible();
    await expect(page.getByRole('heading', { name: `Tabelle ${BEFORE}`, level: 2 })).toBeVisible();
    await expect(cells(page, w.alpha).nth(YEARLY)).toContainText('3 von 12 Monaten');
    await expect(cells(page, w.alpha).nth(YEARLY)).toContainText('Summe');
    await expect(cells(page, w.gamma).nth(YEARLY)).toContainText('Durchschnitt');
    await expect(cells(page, w.beta).nth(0)).toContainText('Keine Werte');
    await expect(
      page
        .getByRole('navigation', { name: /Hauptnavigation/ })
        .getByRole('link', { name: 'Wirkung', exact: true }),
    ).toBeVisible();
    await context.close();
  });

  test('[impact-calls] the page reads the consortia on the server, a choice makes two reads, a year one, a page or a size the table only', async ({
    browser,
    playwright,
    baseURL,
    at,
  }) => {
    test.setTimeout(400_000);
    const w = await world(playwright, baseURL, at, 21);
    const { page, close } = await pageAs(browser, baseURL, at, w.reviewer);
    const seen: string[] = [];
    page.on('request', (request) => {
      const url = new URL(request.url());
      const found = url.pathname.indexOf('/api/internal/');
      if (found >= 0) seen.push(`${request.method()} ${url.pathname.slice(found + 13)}`);
    });
    const impact = () => seen.filter((call) => call.includes('/kpi/impact/'));
    const take = () => {
      const taken = impact().sort();
      seen.length = 0;
      return taken;
    };

    await page.goto(at(PAGE));
    await expect(picker(page)).toBeVisible();
    const arrival = take();
    console.log(
      `[impact-calls] arrival (a full page load, no consortium): ${arrival.join(' | ') || 'none'}`,
    );
    // The loader read the consortia on the server; the browser sends nothing of its own.
    expect(arrival).toEqual([]);

    await picker(page).selectOption({ label: w.option });
    await expect(live(page)).toHaveText(`Table of ${YEAR} for ${w.option}: 26 services`);
    const chosen = take();
    console.log(`[impact-calls] choosing a consortium: ${chosen.join(' | ')}`);
    expect(chosen).toEqual(['GET /kpi/impact/summary', 'GET /kpi/impact/table']);

    await yearSelect(page).selectOption(String(BEFORE));
    await expect(live(page)).toHaveText(`Table of ${BEFORE} for ${w.option}: 26 services`);
    const year = take();
    console.log(`[impact-calls] changing the year: ${year.join(' | ')}`);
    expect(year).toEqual(['GET /kpi/impact/table']);

    await sizeSelect(page).selectOption('25');
    await expect(page.getByRole('status').filter({ hasText: /1–25 of 26/ })).toBeVisible();
    const sized = take();
    console.log(`[impact-calls] the page size: ${sized.join(' | ')}`);
    expect(sized).toEqual(['GET /kpi/impact/table']);

    await page.getByRole('button', { name: /next/i }).click();
    await expect(page.getByRole('status').filter({ hasText: /26–26 of 26/ })).toBeVisible();
    const paged = take();
    console.log(`[impact-calls] the next page of the table: ${paged.join(' | ')}`);
    expect(paged).toEqual(['GET /kpi/impact/table']);

    await unpublished(page).check();
    await expect(live(page)).toHaveText(`Table of ${BEFORE} for ${w.option}: 27 services`);
    const switched = take();
    console.log(`[impact-calls] the switch for unpublished services: ${switched.join(' | ')}`);
    expect(switched).toEqual(['GET /kpi/impact/summary', 'GET /kpi/impact/table']);

    // A link that names the consortium reads the figures once on arrival: the two reads of a choice, no more.
    await page.goto(at(`${PAGE}?consortium=${w.consortium.id}&year=${BEFORE}`));
    await expect(live(page)).toHaveText(`Table of ${BEFORE} for ${w.option}: 26 services`);
    const linked = take();
    console.log(`[impact-calls] arrival with a consortium in the address: ${linked.join(' | ')}`);
    expect(linked).toEqual(['GET /kpi/impact/summary', 'GET /kpi/impact/table']);
    await close();
  });

  for (const scheme of ['light', 'dark'] as const)
    test(`has no serious accessibility violation, ${scheme} theme: before a choice, with figures, with the switch and with a failure`, async ({
      browser,
      playwright,
      baseURL,
      at,
    }) => {
      test.slow();
      const w = await world(playwright, baseURL, at);
      const { page, close } = await pageAs(browser, baseURL, at, w.reviewer);
      await page.emulateMedia({ colorScheme: scheme, reducedMotion: 'reduce' });
      const clean = async (what: string) => expect(await violations(page), what).toEqual([]);

      await page.goto(at(PAGE));
      await expect(picker(page)).toBeVisible();
      await clean('before a choice');
      await picker(page).selectOption({ label: w.option });
      await expect(live(page)).toHaveText(`Table of ${YEAR} for ${w.option}: 5 services`);
      await clean('the figures of the current year (every row without values)');
      await yearSelect(page).selectOption(String(BEFORE));
      await expect(
        page.getByRole('heading', { name: `Table of ${BEFORE}`, level: 2 }),
      ).toBeVisible();
      await expect(cells(page, w.alpha).nth(MONTH(1))).toHaveText('5');
      await clean('the figures of a year with values');
      await unpublished(page).check();
      await expect(live(page)).toHaveText(`Table of ${BEFORE} for ${w.option}: 6 services`);
      await clean('with the unpublished services');

      // The scrollable table can be reached with the keyboard.
      expect(
        await page.getByRole('region', { name: `Table of ${BEFORE}` }).getAttribute('tabindex'),
      ).toBe('0');

      // A failed read says so, with a button to try again.
      await page.route('**/api/internal/kpi/impact/table*', (route) =>
        route.fulfill({ status: 500, body: '{}', contentType: 'application/json' }),
      );
      await yearSelect(page).selectOption(String(YEAR));
      await expect(page.getByRole('alert')).toContainText('The figures could not be loaded.');
      await clean('a failed read');
      await page.unroute('**/api/internal/kpi/impact/table*');
      await page.getByRole('button', { name: 'Try again' }).click();
      await expect(live(page)).toHaveText(`Table of ${YEAR} for ${w.option}: 6 services`);
      await close();
    });
});
