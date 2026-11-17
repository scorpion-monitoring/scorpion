// What the service journeys need: organisations of both kinds with names that cannot clash, services made
// through the API as the administrator, and a catalogue of known shape. Each journey makes its own data
// under a tag of its own (the specs of a run share one database, and a retry must not meet what its first
// try left), and searches for the tag so that the counts it asserts are its own.
import type { Locator, Page } from '@playwright/test';
import { activeUser, unique, type AdminApi } from './admin.ts';
import { withDb } from './db.ts';
import { expect, type Credentials } from './fixtures.ts';
import { makeOrg, uniqueAbbreviation, type Org } from './members.ts';

/** A consortium with this abbreviation. */
export async function makeConsortium(api: AdminApi, abbreviation: string): Promise<Org> {
  const created = await api.send('POST', '/organisations', {
    type: 'consortium',
    abbreviation,
    name: `${abbreviation} consortium`,
  });
  expect(created.status, JSON.stringify(created.body)).toBe(201);
  return {
    id: (created.body as { id: string }).id,
    abbreviation,
    name: `${abbreviation} consortium`,
  };
}

export interface NewService {
  name: string;
  provider: string;
  consortia?: string[];
  stage?: string;
  license?: string;
}

/** Creates a service as the signed-in administrator; the slug is made from the tag. */
export async function makeCatalogueService(
  api: AdminApi,
  slug: string,
  service: NewService,
): Promise<{ id: string; slug: string; name: string }> {
  const created = await api.send('POST', '/services', { slug, ...service });
  expect(created.status, JSON.stringify(created.body)).toBe(201);
  return { id: (created.body as { id: string }).id, slug, name: service.name };
}

export interface Catalogue {
  tag: string;
  providers: [Org, Org];
  consortia: [Org, Org];
  /** The service with two consortia, the one with none, and the one in development. */
  zeta: { id: string; slug: string; name: string };
  alpha: { id: string; slug: string; name: string };
  /** The 22 services that fill the pages: all in production, provider 1, consortium 1. */
  fillers: { id: string; slug: string; name: string }[];
  total: number;
}

/**
 * 24 services under one tag: `Zeta` (in development, two consortia), `Alpha` (in production, no consortium, a
 * second provider, a licence) and 22 fillers (in production, one consortium). Searching the tag isolates them
 * from the services of other specs, and the facets count over that search too.
 */
export async function seedCatalogue(api: AdminApi, tag = unique('cat')): Promise<Catalogue> {
  const providers: [Org, Org] = [
    await makeOrg(api, uniqueAbbreviation('CPA')),
    await makeOrg(api, uniqueAbbreviation('CPB')),
  ];
  const consortia: [Org, Org] = [
    await makeConsortium(api, uniqueAbbreviation('CCA')),
    await makeConsortium(api, uniqueAbbreviation('CCB')),
  ];
  const zeta = await makeCatalogueService(api, `${tag}-zeta`, {
    name: `${tag} Zeta`,
    provider: providers[0].id,
    consortia: [consortia[0].id, consortia[1].id],
    stage: 'DEV',
  });
  const alpha = await makeCatalogueService(api, `${tag}-alpha`, {
    name: `${tag} Alpha`,
    provider: providers[1].id,
    stage: 'PROD',
    license: 'MIT',
  });
  const fillers = [];
  for (let i = 1; i <= 22; i++) {
    fillers.push(
      await makeCatalogueService(api, `${tag}-fill-${String(i).padStart(2, '0')}`, {
        name: `${tag} Fill ${String(i).padStart(2, '0')}`,
        provider: providers[0].id,
        consortia: [consortia[0].id],
        stage: 'PROD',
      }),
    );
  }
  return { tag, providers, consortia, zeta, alpha, fillers, total: 24 };
}

/** An active account with the Reviewer role (it may make a service public; it is no member of anything). */
export async function makeReviewer(
  api: AdminApi,
  at: (path: string) => string,
  who: Credentials,
): Promise<string> {
  const id = await activeUser(api, at, who);
  const given = await api.send('POST', `/users/${id}/roles`, { role: 'reviewer' });
  expect(given.status, JSON.stringify(given.body)).toBe(200);
  return id;
}

/** The audit entries of the event `action` about one service, oldest first. */
export async function serviceEvents(
  basePath: string,
  action: string,
  serviceId: string,
): Promise<{ payload: Record<string, unknown>; userId: string | null }[]> {
  return withDb(basePath, async (client) => {
    const { rows } = await client.query<{
      payload: Record<string, unknown>;
      user_id: string | null;
    }>(
      `select payload, user_id from audit_event
       where source = 'event' and action = $1 and payload->>'serviceId' = $2 order by occurred_at, id`,
      [action, serviceId],
    );
    return rows.map((row) => ({ payload: row.payload, userId: row.user_id }));
  });
}

/** The reason the edit form gives for the short name and the owner, which only a manager or an administrator may change. */
export const IDENTITY_LINE = 'Only a manager of the provider or an administrator can change these.';

// The catalogue page, as the specs read it.
export const rows = (page: Page) =>
  page.getByRole('row').filter({ has: page.getByRole('rowheader') });
export const range = (page: Page, text: string | RegExp) =>
  expect(page.getByRole('status').filter({ hasText: /–.* of / })).toContainText(text);
export const params = (page: Page) => new URL(page.url()).searchParams;

/** The checkbox of a facet value, named by its label and count: `Development (1)`. */
export const choice = (page: Page, label: string | RegExp) =>
  page.getByRole('checkbox', { name: label });

// ----- the faceted search in any look (sprint 3 of M12a) ----------------------------------------------------------
// The catalogues draw their filters in the look an administrator chose (`catalogueFilters`: `sidebar`, `bar` or
// `combined`). These helpers read the look from the page and do the same step in each: a value is a checkbox in
// `sidebar` and an option of the facet's panel in `bar` and `combined`, whose panel they open as needed.

export const LOOKS = ['sidebar', 'bar', 'combined'] as const;
export type Look = (typeof LOOKS)[number];
const SEARCH = 'Search by name or short name';
const escapeRe = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Sets the look of both catalogues (the setting of registry.services) as the administrator; returns the one it replaced. */
export async function setLook(api: AdminApi, look: Look): Promise<Look> {
  const now = await api.get<{ version: number; values: Record<string, unknown> }>(
    '/settings/registry.services',
  );
  const saved = await api.send('PUT', '/settings/registry.services', {
    version: now.version,
    values: { ...now.values, catalogueFilters: look },
  });
  expect(saved.status, JSON.stringify(saved.body)).toBe(200);
  return now.values.catalogueFilters as Look;
}

/** The look on the page. */
export async function lookOf(page: Page): Promise<Look> {
  const look = await page.locator('[data-facet-look]').getAttribute('data-facet-look');
  return look as Look;
}

/** The values of a facet, with its panel opened when the look has one. */
export async function facetValues(page: Page, facet: string): Promise<Locator> {
  const look = await lookOf(page);
  if (look === 'sidebar') return page.getByRole('group', { name: facet, exact: true });
  const values = page.getByRole('listbox', { name: facet, exact: true });
  if (await values.isVisible()) return values;
  const name = new RegExp(`^${escapeRe(facet)}(,? \\d+ chosen)?$`);
  if (look === 'bar') {
    await page.getByRole('group', { name: 'Filter by' }).getByRole('button', { name }).click();
  } else {
    const box = page.getByRole('combobox', { name: SEARCH });
    const list = page.getByRole('listbox', { name: 'Filter by' });
    // Another facet's panel is open: back to the facet list first.
    if ((await box.getAttribute('aria-expanded')) === 'true' && !(await list.isVisible())) {
      await box.press('Escape');
    }
    if (!(await list.isVisible())) await box.click();
    await list.getByRole('option', { name }).click();
  }
  await expect(values).toBeVisible();
  return values;
}

/** One value of a facet (named by its label and count, `Development (1)`), its panel opened as needed. */
export async function facetValue(page: Page, facet: string, name: string | RegExp) {
  const values = await facetValues(page, facet);
  return (await lookOf(page)) === 'sidebar'
    ? values.getByRole('checkbox', { name })
    : values.getByRole('option', { name });
}

/** Whether a value is chosen, in the look's terms (a checked box, a selected option). */
export async function expectChosen(
  page: Page,
  facet: string,
  name: string | RegExp,
  chosen = true,
) {
  const value = await facetValue(page, facet, name);
  if ((await lookOf(page)) === 'sidebar') {
    await (chosen ? expect(value).toBeChecked() : expect(value).not.toBeChecked());
  } else {
    await expect(value).toHaveAttribute('aria-selected', String(chosen));
  }
}

/** Chooses a value (or takes it away), and waits until the page shows it so. */
export async function choose(page: Page, facet: string, name: string | RegExp, on = true) {
  const value = await facetValue(page, facet, name);
  const look = await lookOf(page);
  const is =
    look === 'sidebar'
      ? await value.isChecked()
      : (await value.getAttribute('aria-selected')) === 'true';
  if (is !== on) await value.click();
  // A value that is no longer chosen and has no service leaves the list (the API's rule): nothing to wait for then.
  if (on || (await value.count()) > 0) await expectChosen(page, facet, name, on);
}

/** How many facets have a choice: the facets with a checked box, or the chips. */
export async function expectChosenFacets(page: Page, count: number) {
  if ((await lookOf(page)) === 'sidebar') {
    await expect(
      page.getByRole('group').filter({ has: page.getByRole('checkbox', { checked: true }) }),
    ).toHaveCount(count);
  } else {
    await expect(page.getByRole('button', { name: /^Remove / })).toHaveCount(count);
  }
}

/** Closes an open panel or list, so the table's own controls are reachable. */
export async function closeFacets(page: Page) {
  if ((await lookOf(page)) === 'sidebar') return;
  await page.getByRole('heading', { level: 1 }).click();
  await expect(page.getByRole('listbox')).toHaveCount(0);
}

/** Takes every filter off and keeps the search: "Clear all filters" in `sidebar`, every chip's × elsewhere. */
export async function clearFilters(page: Page) {
  if ((await lookOf(page)) === 'sidebar') {
    await page.getByRole('button', { name: 'Clear all filters' }).click();
  } else {
    await closeFacets(page);
    const chips = page.getByRole('button', { name: /^Remove / });
    while ((await chips.count()) > 0) await chips.first().click();
  }
  await expect(page).not.toHaveURL(/f\./);
}

/** Types a search into the catalogue's box, as a person does after leaving any open list (Escape). */
export async function searchFor(page: Page, text: string) {
  await closeFacets(page);
  await page.getByLabel(SEARCH).fill(text);
}
