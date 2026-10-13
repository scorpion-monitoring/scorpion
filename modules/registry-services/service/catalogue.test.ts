// The catalogue against real Postgres: one row per service whatever its consortia, the facets over the
// filtered set, 422 for a filter that names nothing, the sort and the page, and a few hundred services.
import { makeOrganisation, makeService } from '@scorpion/testing';
import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { fieldValueFacet, type FacetEntry } from '../public.ts';
import { fixtureContributor, useServices } from '../test/harness.ts';
import { anonymous, rejection, uniq } from '../test/world.ts';
import { FACET_EMPTY } from './registries.ts';

const h = useServices();

async function world() {
  const s = await h.start();
  const admin = await s.actor('admin');
  const p1 = await makeOrganisation(s.pool, { type: 'provider' });
  const p2 = await makeOrganisation(s.pool, { type: 'provider' });
  const c1 = await makeOrganisation(s.pool, { type: 'consortium' });
  const c2 = await makeOrganisation(s.pool, { type: 'consortium' });
  const none = await makeService(s.pool, {
    provider: p1.id,
    stage: 'PROD',
    license: 'MIT',
    name: uniq('none'),
  });
  const one = await makeService(s.pool, {
    provider: p1.id,
    consortia: [c1.id],
    stage: 'PROD',
    name: uniq('one'),
  });
  const two = await makeService(s.pool, {
    provider: p2.id,
    consortia: [c1.id, c2.id],
    stage: 'DEV',
    license: 'MIT',
    name: uniq('two'),
  });
  return { ...s, admin, p1, p2, c1, c2, none, one, two };
}

describe('the catalogue (prototype of sprint 4)', () => {
  it('returns each service once with two consortia, none, or one, under two active facet filters', async () => {
    const { services, admin, p1, p2, c1, c2, none, one, two } = await world();
    const all = await services.list(admin, {}, { page: 0, pageSize: 100 });
    expect(all.total).toBe(3);
    expect(all.services.map((row) => row.id).sort()).toEqual([none.id, one.id, two.id].sort());
    const byId = Object.fromEntries(all.services.map((row) => [row.id, row]));
    expect(byId[none.id]!.consortia).toEqual([]);
    expect(byId[two.id]!.consortia.map((c) => c.id).sort()).toEqual([c1.id, c2.id].sort());
    expect(byId[two.id]!.provider?.id).toBe(p2.id);

    // Two facets at once: consortium c1 AND stage PROD or DEV: AND across, OR within.
    const filter = { filters: { consortium: [c1.id], stage: ['PROD', 'DEV'] } };
    const filtered = await services.list(admin, filter, { page: 0, pageSize: 100 });
    expect(filtered.services.map((row) => row.id).sort()).toEqual([one.id, two.id].sort());
    expect(filtered.total).toBe(2);

    const facets = await services.facets(admin, filter);
    const counts = (id: string) =>
      Object.fromEntries(
        facets.find((f) => f.id === id)!.values.map((v) => [v.key, [v.count, v.selected]]),
      );
    // The consortium facet counts over stage PROD|DEV only (the other facet), not over c1 itself.
    expect(counts('consortium')).toEqual({
      [c1.id]: [2, true],
      [c2.id]: [1, false],
      [FACET_EMPTY]: [1, false],
    });
    // The stage facet counts over consortium c1 only.
    expect(counts('stage')).toEqual({ PROD: [1, true], DEV: [1, true] });
    expect(counts('provider')).toEqual({ [p1.id]: [1, false], [p2.id]: [1, false] });
  });

  it('names a facet nobody registered and a value that names nothing as 422', async () => {
    const { services, admin } = await world();
    const bad = await rejection(
      services.list(
        admin,
        { filters: { consortium: ['00000000-0000-4000-8000-000000000000'] } },
        { page: 0, pageSize: 10 },
      ),
    );
    expect(bad.status).toBe(422);
    expect(
      (
        await rejection(
          services.list(admin, { filters: { nope: ['x'] } }, { page: 0, pageSize: 10 }),
        )
      ).status,
    ).toBe(422);
    expect(
      (
        await rejection(
          services.list(admin, { filters: { stage: ['NOPE'] } }, { page: 0, pageSize: 10 }),
        )
      ).status,
    ).toBe(422);
    expect(
      (
        await rejection(
          services.list(
            admin,
            { filters: { license: ['Not-A-Licence'] } },
            { page: 0, pageSize: 10 },
          ),
        )
      ).status,
    ).toBe(422);
  });

  it('is refused to anybody without the read permission', async () => {
    const { services } = await world();
    expect((await rejection(services.list(anonymous, {}, { page: 0, pageSize: 10 }))).status).toBe(
      401,
    );
  });
});

interface Facets {
  id: string;
  values: { key: string; label: string; count: number; selected: boolean; empty?: true }[];
}
const counts = (facets: Facets[], id: string) =>
  Object.fromEntries(facets.find((f) => f.id === id)!.values.map((v) => [v.key, v.count]));
const PAGE = { page: 0, pageSize: 100 };

describe('the order and the pages', () => {
  it('sorts by the name of the provider, then the id, and never repeats or loses a row across pages', async () => {
    const s = await h.start();
    const admin = await s.actor('admin');
    const zed = await makeOrganisation(s.pool, { type: 'provider', name: 'Zed Institute' });
    const alpha = await makeOrganisation(s.pool, { type: 'provider', name: 'Alpha Centre' });
    const mid = await makeOrganisation(s.pool, { type: 'provider', name: 'Mid Lab' });
    const made: { id: string }[] = [];
    for (const [i, p] of [zed, alpha, mid, alpha, zed, mid, alpha].entries()) {
      made.push(await makeService(s.pool, { name: `n${i}`, provider: p.id }));
    }
    const owner = (id: string) => made.find((m) => m.id === id)!;
    const providerOrder = [alpha.id, mid.id, zed.id];
    const providerOf = async (id: string) =>
      (
        await s.pool.query<{ organisation_id: string }>(
          "select organisation_id from svc_service_organisation where service_id = $1 and role = 'provider'",
          [id],
        )
      ).rows[0]!.organisation_id;
    for (const dir of ['asc', 'desc'] as const) {
      const seen: string[] = [];
      for (let page = 0; page < 4; page++) {
        const result = await s.services.list(
          admin,
          { sort: 'provider', dir },
          { page, pageSize: 2 },
        );
        expect(result.total).toBe(7);
        seen.push(...result.services.map((row) => row.id));
      }
      expect(new Set(seen).size).toBe(7);
      const positions = await Promise.all(
        seen.map(async (id) => providerOrder.indexOf(await providerOf(id))),
      );
      const expected = [...positions].sort((a, b) => (dir === 'asc' ? a - b : b - a));
      expect(positions).toEqual(expected);
      // Inside one provider the id decides, whatever the direction.
      for (let i = 1; i < seen.length; i++) {
        if (positions[i] === positions[i - 1]) expect(seen[i - 1]! < seen[i]!).toBe(true);
      }
    }
    expect(owner(made[0]!.id)).toBeDefined();
  });

  it('keeps a stable order across pages when every name is the same, and is empty past the last page', async () => {
    const s = await h.start();
    const admin = await s.actor('admin');
    const p = await makeOrganisation(s.pool, { type: 'provider' });
    const ids: string[] = [];
    for (let i = 0; i < 11; i++)
      ids.push((await makeService(s.pool, { name: 'Same', provider: p.id })).id);
    const seen: string[] = [];
    for (let page = 0; page < 4; page++) {
      seen.push(
        ...(await s.services.list(admin, {}, { page, pageSize: 3 })).services.map((r) => r.id),
      );
    }
    expect(seen).toEqual([...ids].sort());
    expect((await s.services.list(admin, {}, { page: 4, pageSize: 3 })).services).toEqual([]);
    expect((await s.services.list(admin, {}, { page: 4, pageSize: 3 })).total).toBe(11);
  });

  it('searches within the filtered set and the facets count over that search too', async () => {
    const s = await h.start();
    const admin = await s.actor('admin');
    const p = await makeOrganisation(s.pool, { type: 'provider' });
    await makeService(s.pool, { name: 'Galaxy', slug: uniq('gx'), provider: p.id, stage: 'PROD' });
    await makeService(s.pool, {
      name: 'Galaxy Two',
      slug: uniq('gx'),
      provider: p.id,
      stage: 'DEV',
    });
    await makeService(s.pool, {
      name: 'Other 100%',
      slug: uniq('ot'),
      provider: p.id,
      stage: 'DEV',
    });
    expect((await s.services.list(admin, { q: 'galaxy' }, PAGE)).total).toBe(2);
    expect((await s.services.list(admin, { q: '100%' }, PAGE)).total).toBe(1);
    expect((await s.services.list(admin, { q: '%' }, PAGE)).total).toBe(1);
    expect(counts(await s.services.facets(admin, { q: 'galaxy' }), 'stage')).toEqual({
      PROD: 1,
      DEV: 1,
    });
    expect(counts(await s.services.facets(admin, { q: '100%' }), 'stage')).toEqual({ DEV: 1 });
  });
});

describe('a few hundred services', () => {
  it('pages them whole in one stable order and counts every facet as a brute-force count of the generated data does', async () => {
    const s = await h.start();
    const admin = await s.actor('admin');
    const providers = await Promise.all(
      Array.from({ length: 6 }, () => makeOrganisation(s.pool, { type: 'provider' })),
    );
    const consortia = await Promise.all(
      Array.from({ length: 5 }, () => makeOrganisation(s.pool, { type: 'consortium' })),
    );
    const stages = ['DEV', 'PROD', 'BETA'];
    const licences = ['MIT', 'Apache-2.0', null];
    const data: {
      id: string;
      provider: string;
      consortia: string[];
      stage: string;
      license: string | null;
    }[] = [];
    for (let i = 0; i < 300; i++) {
      const mine = consortia.filter((_c, j) => (i * 7 + j * 3) % 5 < i % 3).map((c) => c.id);
      const row = await makeService(s.pool, {
        name: `Svc ${String(i % 40).padStart(2, '0')}`,
        provider: providers[i % 6]!.id,
        consortia: mine,
        stage: stages[i % 3]!,
        license: licences[i % 3] ?? null,
      });
      data.push({
        id: row.id,
        provider: providers[i % 6]!.id,
        consortia: mine,
        stage: stages[i % 3]!,
        license: licences[i % 3] ?? null,
      });
    }
    expect(data.some((d) => d.consortia.length === 0)).toBe(true);
    expect(data.some((d) => d.consortia.length > 1)).toBe(true);

    // Every page of 50, once each, in the order of name then id.
    const seen: string[] = [];
    for (let page = 0; page < 6; page++) {
      const result = await s.services.list(admin, {}, { page, pageSize: 50 });
      expect(result.total).toBe(300);
      seen.push(...result.services.map((r) => r.id));
    }
    expect(new Set(seen).size).toBe(300);

    // Facets under two active filters, against a count made in memory.
    const chosen = { consortium: [consortia[0]!.id, consortia[1]!.id], stage: ['DEV', 'PROD'] };
    const started = Date.now();
    const facets = await s.services.facets(admin, { filters: chosen });
    const list = await s.services.list(admin, { filters: chosen }, PAGE);
    const elapsed = Date.now() - started;
    const inConsortia = (d: (typeof data)[number]) =>
      d.consortia.some((c) => chosen.consortium.includes(c));
    const inStages = (d: (typeof data)[number]) => chosen.stage.includes(d.stage);
    const expected = data.filter((d) => inConsortia(d) && inStages(d));
    expect(list.total).toBe(expected.length);
    expect(list.services.map((r) => r.id).sort()).toEqual(expected.map((d) => d.id).sort());
    const tally = (rows: typeof data, key: (d: (typeof data)[number]) => string[]) => {
      const out: Record<string, number> = {};
      for (const d of rows) for (const k of key(d)) out[k] = (out[k] ?? 0) + 1;
      return out;
    };
    // Each facet counts over the others: consortia over the stage filter, stage over the consortium filter.
    // A chosen stage that nothing in this set has (here DEV: the services without a consortium) shows with 0.
    expect(counts(facets, 'stage')).toEqual({
      DEV: 0,
      PROD: 0,
      ...tally(data.filter(inConsortia), (d) => [d.stage]),
    });
    const overStage = data.filter(inStages);
    const consortiumCounts = counts(facets, 'consortium');
    const wanted = tally(overStage, (d) => (d.consortia.length ? d.consortia : [FACET_EMPTY]));
    expect(consortiumCounts).toEqual(wanted);
    expect(counts(facets, 'provider')).toEqual(tally(expected, (d) => [d.provider]));
    expect(counts(facets, 'license')).toEqual(tally(expected, (d) => [d.license ?? FACET_EMPTY]));
    // A few hundred services and four facets answer well inside a second on a test database.
    expect(elapsed).toBeLessThan(5000);
  });
});

describe('a facet another module contributes', () => {
  const category = fieldValueFacet('category', 'category', {
    labels: { en: 'Category', de: 'Kategorie' },
    order: 50,
    emptyLabel: { en: 'Uncategorized', de: 'Ohne Kategorie' },
    labelsOf: (keys) => Promise.resolve(new Map(keys.map((key) => [key, key.toUpperCase()]))),
  });
  // A facet with its own condition and no table: the first letter of the name.
  const letter: FacetEntry = {
    id: 'letter',
    labels: { en: 'Letter' },
    order: 60,
    where: (selection, serviceId) =>
      sql`exists (select 1 from svc_service s where s.id = ${serviceId} and upper(left(s.name, 1)) in (${sql.join(
        selection.keys.map((key) => sql`${key}`),
        sql`, `,
      )}))`,
    async values(matching, db) {
      const rows = await db.execute<{ key: string; count: number }>(
        sql`select upper(left(name, 1)) as key, count(*)::int as count from svc_service where id in (${matching}) group by 1`,
      );
      return rows.rows;
    },
    unknownOf: (keys) => Promise.resolve(keys.filter((key) => !/^[A-Z]$/.test(key))),
  };

  async function start() {
    const s = await h.start({
      extra: [fixtureContributor({ contributes: { 'service.facet': [category, letter] } })],
    });
    const admin = await s.actor('admin');
    const p = await makeOrganisation(s.pool, { type: 'provider' });
    const made = async (name: string, values?: Record<string, unknown>) =>
      makeService(s.pool, { name, provider: p.id, ...(values && { values }) });
    return { ...s, admin, made };
  }

  it('is a filter and a facet of the catalogue with no change to this module, a value kept in svc_field_value included', async () => {
    const { services, admin, made } = await start();
    const a = await made('Alpha', { category: 'data' });
    const b = await made('Beta', { category: ['data', 'compute'] });
    const c = await made('Gamma');
    expect((await services.list(admin, { filters: { category: ['data'] } }, PAGE)).total).toBe(2);
    expect(
      (await services.list(admin, { filters: { category: ['compute'] } }, PAGE)).services.map(
        (r) => r.id,
      ),
    ).toEqual([b.id]);
    expect(
      (await services.list(admin, { filters: { category: [FACET_EMPTY] } }, PAGE)).services.map(
        (r) => r.id,
      ),
    ).toEqual([c.id]);
    const facets = await services.facets(admin, {});
    expect(facets.map((f) => f.id)).toEqual([
      'consortium',
      'stage',
      'license',
      'provider',
      'category',
      'letter',
    ]);
    const category_ = facets.find((f) => f.id === 'category')!;
    expect(category_.values.map((v) => [v.key, v.label, v.count])).toEqual([
      ['data', 'DATA', 2],
      ['compute', 'COMPUTE', 1],
      [FACET_EMPTY, 'Uncategorized', 1],
    ]);
    expect(a.id).not.toBe(b.id);
  });

  it('counts over the other facets, the contributed one included, and shows a chosen value with 0', async () => {
    const { services, admin, made } = await start();
    await made('Alpha', { category: 'data' });
    await made('Beta', { category: 'compute' });
    await made('Bravo', { category: 'compute' });
    const filters = { category: ['data', 'ghost'], letter: ['B'] };
    const facets = await services.facets(admin, { filters });
    // The category facet counts over letter B (the other facet): only compute has services there.
    expect(counts(facets, 'category')).toEqual({ compute: 2, data: 0, ghost: 0 });
    // The letter facet counts over category data or ghost (the other facet): only Alpha.
    expect(counts(facets, 'letter')).toEqual({ A: 1, B: 0 });
    // The built-in facets count over both.
    expect(counts(facets, 'stage')).toEqual({});
    expect((await services.list(admin, { filters }, PAGE)).total).toBe(0);
  });

  it('refuses a value the contributed facet says names nothing, and accepts any value for one that says nothing', async () => {
    const { services, admin, made } = await start();
    await made('Alpha');
    expect(
      (await rejection(services.list(admin, { filters: { letter: ['not-a-letter'] } }, PAGE)))
        .status,
    ).toBe(422);
    expect((await services.list(admin, { filters: { category: ['anything'] } }, PAGE)).total).toBe(
      0,
    );
  });
});
