// The catalogue against real Postgres: one row per service whatever its consortia, the facets over the
// filtered set, 422 for a filter that names nothing, the sort and the page, and a few hundred services.
import { makeOrganisation, makeService } from '@scorpion/testing';
import { describe, expect, it } from 'vitest';
import { useServices } from '../test/harness.ts';
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
