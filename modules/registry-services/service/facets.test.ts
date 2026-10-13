// The four seeded facets and `fieldValueFacet` against real Postgres: counts over a set of services, a
// service once whatever its number of consortia, the services with none counted under `null`, and the
// condition of a selection (OR within the facet, "none" as a choice of its own).
import { makeOrganisation, makeService } from '@scorpion/testing';
import { sql, type SQL } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { service } from '../db/schema.ts';
import { useServices } from '../test/harness.ts';
import { fieldValueFacet, SEED_FACETS } from './facets.ts';
import type { FacetEntry, FacetSelection } from './registries.ts';

const h = useServices();
const facet = (id: string) => SEED_FACETS.find((f) => f.id === id)!;
const pick = (...keys: string[]): FacetSelection => ({ keys, empty: false });
const id = sql`${service.id}`;
const everything = sql`(select ${service.id} from ${service})`;

async function world() {
  const s = await h.start();
  const p1 = await makeOrganisation(s.pool, { type: 'provider' });
  const p2 = await makeOrganisation(s.pool, { type: 'provider' });
  const c1 = await makeOrganisation(s.pool, { type: 'consortium' });
  const c2 = await makeOrganisation(s.pool, { type: 'consortium' });
  const none = await makeService(s.pool, { provider: p1.id, stage: 'PROD', license: 'MIT' });
  const one = await makeService(s.pool, { provider: p1.id, consortia: [c1.id], stage: 'PROD' });
  const two = await makeService(s.pool, {
    provider: p2.id,
    consortia: [c1.id, c2.id],
    stage: 'DEV',
    license: 'MIT',
  });
  return { ...s, db: s.kernel.db, p1, p2, c1, c2, none, one, two };
}
const byKey = (values: { key: string | null; count: number }[]) =>
  Object.fromEntries(values.map((v) => [String(v.key), v.count]));
/** The set of services a condition leaves, as the subquery the facets count over. */
const matching = (condition: SQL) => sql`(select ${service.id} from ${service} where ${condition})`;

describe('the seeded facets', () => {
  it('count each service once per consortium and the services with none under null', async () => {
    const { db, c1, c2 } = await world();
    const values = await facet('consortium').values(everything, db);
    expect(byKey(values)).toEqual({ [c1.id]: 2, [c2.id]: 1, null: 1 });
    expect(values.at(-1)).toEqual({ key: null, count: 1 }); // the services with none come last
  });

  it('count the providers, the stages and the licences, an unset licence under null', async () => {
    const { db, p1, p2 } = await world();
    expect(byKey(await facet('provider').values(everything, db))).toEqual({
      [p1.id]: 2,
      [p2.id]: 1,
    });
    expect(byKey(await facet('stage').values(everything, db))).toEqual({ DEV: 1, PROD: 2 });
    expect(byKey(await facet('license').values(everything, db))).toEqual({ MIT: 2, null: 1 });
  });

  it('count over the set they are given, which is how the catalogue filters by the other facets', async () => {
    const { db, c1, c2 } = await world();
    const devOnly = matching(facet('stage').where(pick('DEV'), id));
    expect(byKey(await facet('consortium').values(devOnly, db))).toEqual({
      [c1.id]: 1,
      [c2.id]: 1,
    });
    const c2Only = matching(facet('consortium').where(pick(c2.id), id));
    expect(byKey(await facet('stage').values(c2Only, db))).toEqual({ DEV: 1 });
  });

  it('turn a selection into a condition: OR within the facet, "none" as a choice, and nothing for an empty one', async () => {
    const { db, c1, c2, one, two, none } = await world();
    const ids = async (condition: SQL) =>
      (await db.select({ id: service.id }).from(service).where(condition)).map((r) => r.id).sort();
    const sorted = (...rows: { id: string }[]) => rows.map((r) => r.id).sort();
    expect(await ids(facet('consortium').where(pick(c1.id), id))).toEqual(sorted(one, two));
    expect(await ids(facet('consortium').where(pick(c2.id), id))).toEqual(sorted(two));
    expect(await ids(facet('consortium').where(pick(c1.id, c2.id), id))).toEqual(sorted(one, two));
    expect(await ids(facet('consortium').where({ keys: [], empty: true }, id))).toEqual(
      sorted(none),
    );
    expect(await ids(facet('consortium').where({ keys: [c2.id], empty: true }, id))).toEqual(
      sorted(none, two),
    );
    expect(await ids(facet('consortium').where(pick(), id))).toEqual([]);
    expect(await ids(facet('stage').where(pick('DEV', 'PROD'), id))).toHaveLength(3);
    expect(await ids(facet('license').where(pick('MIT'), id))).toHaveLength(2);
    expect(await ids(facet('license').where({ keys: [], empty: true }, id))).toEqual(sorted(one));
    expect(await ids(facet('provider').where(pick(), id))).toEqual([]);
  });

  it('carry an empty label where a service can have no value', () => {
    expect(facet('consortium').emptyLabel).toBeDefined();
    expect(facet('license').emptyLabel).toBeDefined();
  });
});

describe('fieldValueFacet: a value kept in svc_field_value', () => {
  const category: FacetEntry = fieldValueFacet('category', 'category', {
    labels: { en: 'Category' },
    order: 50,
    emptyLabel: { en: 'Uncategorized', de: 'Ohne Kategorie' },
  });

  it('counts a text and a list once per service, and the services with no value under null', async () => {
    const { db, pool, p1 } = await world();
    await makeService(pool, { provider: p1.id, values: { category: 'data' } });
    const both = await makeService(pool, {
      provider: p1.id,
      values: { category: ['data', 'compute', 'data'] },
    });
    await makeService(pool, { provider: p1.id, values: { category: [] } });
    const counts = byKey(await category.values(everything, db));
    // The three services of `world()` have no category, and neither has the one with an empty list.
    expect(counts).toMatchObject({ data: 2, compute: 1, null: 4 });
    const ids = await db
      .select({ id: service.id })
      .from(service)
      .where(category.where(pick('compute'), id));
    expect(ids.map((r) => r.id)).toEqual([both.id]);
  });

  it('selects by value (OR) and by none', async () => {
    const { db, pool, p1 } = await world();
    const a = await makeService(pool, { provider: p1.id, values: { category: 'data' } });
    const b = await makeService(pool, { provider: p1.id, values: { category: ['compute'] } });
    const ids = async (selection: FacetSelection) =>
      (await db.select({ id: service.id }).from(service).where(category.where(selection, id)))
        .map((r) => r.id)
        .sort();
    expect(await ids(pick('data', 'compute'))).toEqual([a.id, b.id].sort());
    expect(await ids({ keys: [], empty: true })).toHaveLength(3);
  });
});
