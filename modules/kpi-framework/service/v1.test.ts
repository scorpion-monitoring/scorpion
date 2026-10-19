// The two reads of the public API at the service layer (M9 sprint 3): `categories` and `indicators`, with the legacy shape
// and what is added, the filters that filter the rows and the count alike (defect 15), the stable order, and the 422 that
// names the parameter. The routes, the token scope and the envelope are `apps/server/src/kpi.contract.test.ts`.
import {
  makeIndicator,
  makeKpiSet,
  makeServiceKpis,
  makeService,
  makeOrganisation,
} from '@scorpion/testing';
import { describe, expect, it } from 'vitest';
import { legacyType } from './v1.ts';
import { useKpi } from '../test/harness.ts';
import { rejection, uniq } from '../test/world.ts';

const h = useKpi();
const PAGE = { page: 0, pageSize: 100 };

async function start() {
  const s = await h.start();
  const admin = await s.actor('admin');
  const plain = await s.actor('user');
  const provider = await makeOrganisation(s.pool, { type: 'provider' });
  const service = await makeService(s.pool, { provider: provider.id, slug: uniq('v1svc') });
  const prefix = uniq('v1');
  const [alpha, beta, gamma, delta] = await Promise.all(
    [
      { name: `${prefix} alpha`, unit: 'count' as string | null, min: 0 },
      { name: `${prefix} Beta`, unit: 'percent' as string | null, valueType: 'percentage' },
      { name: `${prefix} gamma`, unit: 'my-own-unit' as string | null },
      { name: `${prefix} delta`, unit: null, qualitative: true },
    ].map((overrides) => makeIndicator(s.pool, overrides)),
  );
  const set = await makeKpiSet(s.pool, {
    name: `${prefix} set`,
    rimoCategory: 'Web_application',
    indicators: [
      { indicatorId: alpha!.id, necessity: 'mandatory' },
      { indicatorId: beta!.id, necessity: 'optional' },
    ],
  });
  const empty = await makeKpiSet(s.pool, { name: `${prefix} empty` });
  return {
    s,
    admin,
    plain,
    service,
    prefix,
    alpha: alpha!,
    beta: beta!,
    gamma: gamma!,
    delta: delta!,
    set,
    empty,
  };
}

describe('categories', () => {
  it('lists every set with the legacy name, the additive fields, the RIMO IRI and the count, by name then id', async () => {
    const { s, plain, set, empty, prefix } = await start();
    const { categories, total } = await s.kpi.v1.categories(plain, PAGE);
    expect(total).toBeGreaterThanOrEqual(2);
    const mine = categories.filter((category) => category.name.startsWith(prefix));
    expect(mine.map((category) => category.name)).toEqual([`${prefix} empty`, `${prefix} set`]);
    expect(mine[1]).toMatchObject({
      id: set.id,
      indicators: 2,
      rimoCategory: 'http://w3id.org/RIMO#Web_application',
    });
    expect(mine[1]!.iri).toMatch(new RegExp(`/kpi/set/${set.slug}$`));
    expect(mine[0]).toMatchObject({ id: empty.id, indicators: 0, rimoCategory: null });
    const names = categories.map((category) => category.name.toLowerCase());
    expect(names).toEqual([...names].sort());
  });

  it('pages without overlap and counts every set', async () => {
    const { s, plain } = await start();
    const all = await s.kpi.v1.categories(plain, PAGE);
    const pages = [];
    for (let page = 0; page * 2 < all.total; page++)
      pages.push(...(await s.kpi.v1.categories(plain, { page, pageSize: 2 })).categories);
    expect(pages.map((category) => category.id)).toEqual(
      all.categories.map((category) => category.id),
    );
    expect((await s.kpi.v1.categories(plain, { page: 99, pageSize: 2 })).categories).toEqual([]);
  });

  it('needs the v1 permission: an anonymous caller is refused', async () => {
    const { s } = await start();
    expect((await rejection(s.kpi.v1.categories({ kind: 'anonymous' }, PAGE))).status).toBe(401);
  });
});

describe('indicators', () => {
  it('has the legacy fields and what is added, with a unit as key, symbol and IRI', async () => {
    const { s, plain, alpha, beta, gamma, delta, prefix } = await start();
    const { indicators } = await s.kpi.v1.indicators(plain, {}, PAGE);
    const mine = indicators.filter((indicator) => indicator.name.startsWith(prefix));
    expect(mine.map((indicator) => indicator.name)).toEqual([
      `${prefix} alpha`,
      `${prefix} Beta`,
      `${prefix} delta`,
      `${prefix} gamma`,
    ]);
    const byId = new Map(mine.map((indicator) => [indicator.id, indicator]));
    expect(byId.get(alpha.id)).toMatchObject({
      type: 'number',
      valueType: 'integer',
      thematicCategory: 'Usage',
      selected: false,
      necessity: null,
      qualitative: false,
      min: 0,
      max: null,
      measuredBy: [],
      canBeAutomatedBy: [],
      unit: { key: 'count', symbol: null, iri: 'http://purl.obolibrary.org/obo/UO_0000189' },
    });
    expect(byId.get(beta.id)).toMatchObject({
      type: 'percentage',
      unit: { key: 'percent', symbol: '%' },
    });
    // An administrator's own unit has no UO term: its IRI is minted here.
    expect(byId.get(gamma.id)?.unit).toMatchObject({ key: 'my-own-unit', symbol: null });
    expect(byId.get(gamma.id)?.unit?.iri).toMatch(/\/kpi\/unit\/my-own-unit$/);
    expect(byId.get(delta.id)).toMatchObject({ qualitative: true, type: 'text', unit: null });
    expect(byId.get(alpha.id)?.iri).toMatch(/\/kpi\/indicator\//);
  });

  it('keeps only the indicators of a category, with their necessity there; the name is compared without case', async () => {
    const { s, plain, alpha, beta, set, prefix } = await start();
    const { indicators, total } = await s.kpi.v1.indicators(
      plain,
      { category: `${prefix} SET` },
      PAGE,
    );
    expect(total).toBe(2);
    expect(
      indicators.map((indicator) => [indicator.id, indicator.necessity, indicator.selected]),
    ).toEqual([
      [alpha.id, 'mandatory', false],
      [beta.id, 'optional', false],
    ]);
    void set;
  });

  it('totalCount respects the filters, and a page past the end is empty (defect 15)', async () => {
    const { s, plain, empty, prefix } = await start();
    expect((await s.kpi.v1.indicators(plain, { category: empty.name }, PAGE)).total).toBe(0);
    const some = await s.kpi.v1.indicators(
      plain,
      { category: `${prefix} set` },
      { page: 0, pageSize: 1 },
    );
    expect(some.total).toBe(2);
    expect(some.indicators).toHaveLength(1);
    expect(
      (await s.kpi.v1.indicators(plain, { category: `${prefix} set` }, { page: 5, pageSize: 1 }))
        .indicators,
    ).toEqual([]);
    const all = await s.kpi.v1.indicators(plain, {}, PAGE);
    expect(all.total).toBeGreaterThan(some.total);
  });

  it('marks the indicators of the effective set of a service as selected, with the necessity there', async () => {
    const { s, plain, service, alpha, gamma, delta, set } = await start();
    await makeServiceKpis(s.pool, { serviceId: service.id, setId: set.id, extras: [gamma.id] });
    const { indicators, total } = await s.kpi.v1.indicators(
      plain,
      { service: service.slug.toUpperCase() },
      PAGE,
    );
    const by = new Map(indicators.map((indicator) => [indicator.id, indicator]));
    expect(by.get(alpha.id)).toMatchObject({ selected: true, necessity: 'mandatory' });
    expect(by.get(gamma.id)).toMatchObject({ selected: true, necessity: 'optional' });
    expect(by.get(delta.id)).toMatchObject({ selected: false, necessity: null });
    // `service` marks, it does not remove: every indicator is still listed.
    expect(total).toBe((await s.kpi.v1.indicators(plain, {}, PAGE)).total);
  });

  it('gives the category necessity when both filters are used, and selected from the service', async () => {
    const { s, plain, service, alpha, beta, gamma, set, prefix } = await start();
    await makeServiceKpis(s.pool, { serviceId: service.id, extras: [alpha.id, gamma.id] });
    const { indicators } = await s.kpi.v1.indicators(
      plain,
      { category: `${prefix} set`, service: service.slug },
      PAGE,
    );
    const by = new Map(indicators.map((indicator) => [indicator.id, indicator]));
    expect(by.get(alpha.id)).toMatchObject({ selected: true, necessity: 'mandatory' });
    expect(by.get(beta.id)).toMatchObject({ selected: false, necessity: 'optional' });
    expect(by.has(gamma.id)).toBe(false);
    void set;
  });

  it('is 422 for an unknown category and an unknown service, naming each parameter', async () => {
    const { s, plain } = await start();
    const both = await rejection(
      s.kpi.v1.indicators(plain, { category: 'No such set', service: 'no-such-service' }, PAGE),
    );
    expect(both.status).toBe(422);
    expect((both.errors ?? []).map((e) => [e.in, e.path]).sort()).toEqual([
      ['query', 'category'],
      ['query', 'service'],
    ]);
  });

  it('is ordered by name without case, then id, and stable across pages', async () => {
    const { s, plain } = await start();
    const all = await s.kpi.v1.indicators(plain, {}, PAGE);
    const names = all.indicators.map((indicator) => indicator.name.toLowerCase());
    expect(names).toEqual([...names].sort());
    const walked = [];
    for (let page = 0; page * 3 < all.total; page++)
      walked.push(...(await s.kpi.v1.indicators(plain, {}, { page, pageSize: 3 })).indicators);
    expect(walked.map((indicator) => indicator.id)).toEqual(
      all.indicators.map((indicator) => indicator.id),
    );
  });
});

describe('legacyType', () => {
  it.each([
    ['integer', 'number'],
    ['float', 'float'],
    ['text', 'text'],
    ['duration', 'duration'],
    ['percentage', 'percentage'],
  ])('maps %s to %s', (valueType, expected) => {
    expect(legacyType(valueType)).toBe(expected);
  });
});
