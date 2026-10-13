// Defect 2 (docs/FEATURES.md §3.5 and §5): the legacy `service_view` never joined the consortium links to the
// service, so every service appeared in every consortium, and a service with no consortium dropped out of the
// view and with it out of the catalogue, the facets and the consortium filters. The catalogue is a tested
// query function, not a view (ADR-0035), and these tests, through the real routes and Postgres, fix what it
// must keep doing. Never delete or weaken them.
import { makeOrganisation, makeService } from '@scorpion/testing';
import { describe, expect, it } from 'vitest';
import { useIdentityApp } from './testing/identity-app.ts';

const app = useIdentityApp();
const as = (who: { cookie: string; csrf: string }) => ({ cookie: who.cookie, csrf: who.csrf });
interface Page<T> {
  metadata: { totalCount: number };
  result: T[];
}
interface Row {
  id: string;
  consortia: { id: string }[];
}
interface Facet {
  id: string;
  values: { key: string; count: number; selected: boolean }[];
}

async function world() {
  const s = await app.start();
  const pool = s.kernel.pool;
  const user = await s.signedIn('reader');
  const provider = await makeOrganisation(pool, { type: 'provider' });
  const c1 = await makeOrganisation(pool, { type: 'consortium' });
  const c2 = await makeOrganisation(pool, { type: 'consortium' });
  const c3 = await makeOrganisation(pool, { type: 'consortium' });
  const none = await makeService(pool, { provider: provider.id });
  const one = await makeService(pool, { provider: provider.id, consortia: [c1.id] });
  const two = await makeService(pool, { provider: provider.id, consortia: [c1.id, c2.id] });
  const rows = async (query = '') => {
    const reply = await s.get(`/services?pageSize=100${query}`, as(user));
    expect(reply.status).toBe(200);
    return reply.body as Page<Row>;
  };
  const facet = async (query = '') => {
    const reply = await s.get(`/services/facets${query}`, as(user));
    expect(reply.status).toBe(200);
    const consortium = (reply.body as Page<Facet>).result.find((f) => f.id === 'consortium')!;
    return Object.fromEntries(consortium.values.map((v) => [v.key, v.count]));
  };
  return { s, pool, rows, facet, provider, c1, c2, c3, none, one, two };
}

describe('defect 2: services and consortia in the catalogue', () => {
  it('defect-02: a service with no consortium appears in the catalogue when no consortium filter is set', async () => {
    const { rows, none, one, two } = await world();
    const all = await rows();
    expect(all.metadata.totalCount).toBe(3);
    expect(all.result.map((r) => r.id).sort()).toEqual([none.id, one.id, two.id].sort());
    expect(all.result.find((r) => r.id === none.id)!.consortia).toEqual([]);
  });

  it('defect-02: a service with no consortium is counted in the facets, under its own value', async () => {
    const { facet, rows, none } = await world();
    const counts = await facet();
    expect(counts[':none']).toBe(1);
    // ... and the person can ask for exactly those services.
    expect((await rows('&consortium=:none')).result.map((r) => r.id)).toEqual([none.id]);
  });

  it('defect-02: a service with two consortia appears once and counts once in each of them', async () => {
    const { facet, rows, c1, c2, two } = await world();
    const all = await rows();
    expect(all.result.filter((r) => r.id === two.id)).toHaveLength(1);
    expect(
      all.result
        .find((r) => r.id === two.id)!
        .consortia.map((c) => c.id)
        .sort(),
    ).toEqual([c1.id, c2.id].sort());
    expect(all.metadata.totalCount).toBe(all.result.length);
    // Both consortia of the service: still one row, and one count in each.
    const both = await rows(`&consortium=${c1.id}&consortium=${c2.id}`);
    expect(both.result.map((r) => r.id).filter((id) => id === two.id)).toHaveLength(1);
    expect(both.metadata.totalCount).toBe(2);
    const counts = await facet();
    expect(counts[c1.id]).toBe(2);
    expect(counts[c2.id]).toBe(1);
  });

  it("defect-02: a consortium filter returns exactly that consortium's services, never another's", async () => {
    const { rows, c1, c2, c3, one, two } = await world();
    expect((await rows(`&consortium=${c1.id}`)).result.map((r) => r.id).sort()).toEqual(
      [one.id, two.id].sort(),
    );
    expect((await rows(`&consortium=${c2.id}`)).result.map((r) => r.id)).toEqual([two.id]);
    // A consortium that exists and has no services answers an empty list, not every service.
    const empty = await rows(`&consortium=${c3.id}`);
    expect(empty.result).toEqual([]);
    expect(empty.metadata.totalCount).toBe(0);
  });

  it('defect-02: the old view bug cannot return: no service is in a consortium it was not linked to, and the counts add up', async () => {
    const { rows, facet, pool, c1, c2, c3, none, one, two } = await world();
    const linked = new Map<string, string[]>([
      [none.id, []],
      [one.id, [c1.id]],
      [two.id, [c1.id, c2.id]],
    ]);
    for (const row of (await rows()).result) {
      expect(row.consortia.map((c) => c.id).sort(), row.id).toEqual(
        [...linked.get(row.id)!].sort(),
      );
    }
    // Every consortium: its filter returns the services linked to it, the same number its facet shows.
    const counts = await facet();
    for (const c of [c1, c2, c3]) {
      const want = [...linked].filter(([, ids]) => ids.includes(c.id)).map(([id]) => id);
      const got = await rows(`&consortium=${c.id}`);
      expect(got.result.map((r) => r.id).sort(), c.id).toEqual(want.sort());
      expect(counts[c.id] ?? 0, c.id).toBe(want.length);
    }
    // The catalogue is a query, not a view: nothing named like the old view exists in the database.
    const { rows: views } = await pool.query<{ viewname: string }>(
      "select viewname from pg_views where schemaname = 'public' and (viewname like '%service%' or viewname like 'svc%')",
    );
    expect(views).toEqual([]);
  });

  it('defect-02: a consortium nobody has linked yet changes nothing for services that are not in it', async () => {
    const { rows, s, pool, c3, none, one, two } = await world();
    const before = (await rows()).result.map((r) => [r.id, r.consortia.length]);
    expect(before.map(([id]) => id).sort()).toEqual([none.id, one.id, two.id].sort());
    const another = await makeService(pool, {
      provider: (await makeOrganisation(pool, { type: 'provider' })).id,
    });
    const after = (await rows()).result;
    expect(after).toHaveLength(4);
    expect(after.find((r) => r.id === another.id)!.consortia).toEqual([]);
    expect((await rows(`&consortium=${c3.id}`)).result).toEqual([]);
    expect(s).toBeDefined();
  });
});
