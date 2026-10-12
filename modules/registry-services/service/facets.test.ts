// The four seeded facets against real Postgres: counts over a scope, a service once whatever its number
// of consortia, the services with none counted under `null`, and the condition of a selection.
import { makeOrganisation, makeService } from '@scorpion/testing';
import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { service } from '../db/schema.ts';
import { useServices } from '../test/harness.ts';
import { SEED_FACETS } from './facets.ts';

const h = useServices();
const facet = (id: string) => SEED_FACETS.find((f) => f.id === id)!;

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

describe('the seeded facets', () => {
  it('count each service once per consortium and the services with none under null', async () => {
    const { db, c1, c2 } = await world();
    const values = await facet('consortium').values(undefined, db);
    expect(byKey(values)).toEqual({ [c1.id]: 2, [c2.id]: 1, null: 1 });
    expect(values.at(-1)).toEqual({ key: null, count: 1 }); // the services with none come last
  });

  it('count the providers, the stages and the licences, an unset licence under null', async () => {
    const { db, p1, p2 } = await world();
    expect(byKey(await facet('provider').values(undefined, db))).toEqual({
      [p1.id]: 2,
      [p2.id]: 1,
    });
    expect(byKey(await facet('stage').values(undefined, db))).toEqual({ DEV: 1, PROD: 2 });
    expect(byKey(await facet('license').values(undefined, db))).toEqual({ MIT: 2, null: 1 });
  });

  it('count over the scope they are given, which is how the catalogue filters by the other facets', async () => {
    const { db, c1, c2 } = await world();
    const devOnly = facet('stage').where(['DEV']);
    expect(byKey(await facet('consortium').values(devOnly, db))).toEqual({
      [c1.id]: 1,
      [c2.id]: 1,
    });
    const c2Only = facet('consortium').where([c2.id]);
    expect(byKey(await facet('stage').values(c2Only, db))).toEqual({ DEV: 1 });
  });

  it('turn a selection into a condition: OR within the facet, and nothing for an empty selection', async () => {
    const { db, c1, c2, one, two } = await world();
    const ids = async (condition: ReturnType<typeof sql>) =>
      (await db.select({ id: service.id }).from(service).where(condition)).map((r) => r.id).sort();
    expect(await ids(facet('consortium').where([c1.id]))).toEqual([one.id, two.id].sort());
    expect(await ids(facet('consortium').where([c2.id]))).toEqual([two.id]);
    expect(await ids(facet('consortium').where([c1.id, c2.id]))).toEqual([one.id, two.id].sort());
    expect(await ids(facet('consortium').where([]))).toEqual([]);
    expect(await ids(facet('stage').where(['DEV', 'PROD']))).toHaveLength(3);
    expect(await ids(facet('license').where(['MIT']))).toHaveLength(2);
    expect(await ids(facet('provider').where([]))).toEqual([]);
  });

  it('carry an empty label where a service can have no value', () => {
    expect(facet('consortium').emptyLabel).toBeDefined();
    expect(facet('license').emptyLabel).toBeDefined();
  });
});
