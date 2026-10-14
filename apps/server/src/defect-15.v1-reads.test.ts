// Defect 15 (FEATURES §5): in the legacy v1 API `is_member=false` was broken, `consortia` was always empty and the
// envelope keys were inconsistent. This is the regression suite of the two v1 reads that closed it (M8 sprint 2),
// through the whole pipeline with a real token on real Postgres. Never weaken or delete it.
import { makeMembership, makeOrganisation, makeService } from '@scorpion/testing';
import { describe, expect, it } from 'vitest';
import { useIdentityApp } from './testing/identity-app.ts';

const app = useIdentityApp();
type Started = Awaited<ReturnType<typeof start>>;
const start = () => app.start({ publicApi: true });

async function tokenOf(s: Started, username: string) {
  const who = await s.signedIn(username);
  const reply = await s.post('/tokens', {
    ...who,
    body: {
      name: `t-${username}`,
      scopes: ['registry.organisations.v1.read', 'registry.services.v1.read'],
    },
  });
  expect(reply.status).toBe(201);
  return { who, headers: { authorization: `Bearer ${(reply.body as { token: string }).token}` } };
}

type Page<T> = { metadata: Record<string, number>; result: T[] };

describe('defect 15: the v1 reads', () => {
  it('is_member=false lists the providers the token owner is not an approved member of, and true those they are [ASVS-8.2.3]', async () => {
    const s = await start();
    const { who, headers } = await tokenOf(s, 'defect15-member');
    const other = await s.signedIn('defect15-other');
    const mine = await makeOrganisation(s.kernel.pool, { abbreviation: 'D15-mine' });
    const asked = await makeOrganisation(s.kernel.pool, { abbreviation: 'D15-asked' });
    const rejected = await makeOrganisation(s.kernel.pool, { abbreviation: 'D15-rejected' });
    const strangers = await makeOrganisation(s.kernel.pool, { abbreviation: 'D15-strangers' });
    await makeOrganisation(s.kernel.pool, { abbreviation: 'D15-nobody' });
    const pool = s.kernel.pool;
    await makeMembership(pool, { organisationId: mine.id, userId: who.user.id });
    await makeMembership(pool, {
      organisationId: asked.id,
      userId: who.user.id,
      state: 'requested',
    });
    await makeMembership(pool, {
      organisationId: rejected.id,
      userId: who.user.id,
      state: 'rejected',
    });
    await makeMembership(pool, { organisationId: strangers.id, userId: other.user.id });

    const abbreviations = async (query: string) =>
      (
        (await s.getV1(`/providers${query}`, { headers })).body as Page<{ abbreviation: string }>
      ).result
        .map((row) => row.abbreviation)
        .sort();
    expect(await abbreviations('?is_member=true')).toEqual(['D15-mine']);
    // The legacy API answered nothing (or everything) here: `false` is the others, not the approved ones.
    expect(await abbreviations('?is_member=false')).toEqual(
      ['D15-asked', 'D15-nobody', 'D15-rejected', 'D15-strangers'].sort(),
    );
    expect((await abbreviations('')).length).toBe(5);
  });

  it('fills consortia for every service and returns each service once, whatever its number of consortia', async () => {
    const s = await start();
    const { headers } = await tokenOf(s, 'defect15-services');
    const pool = s.kernel.pool;
    const provider = await makeOrganisation(pool, { abbreviation: 'D15-prov' });
    const a = await makeOrganisation(pool, {
      type: 'consortium',
      abbreviation: 'D15-ca',
      name: 'A',
    });
    const b = await makeOrganisation(pool, {
      type: 'consortium',
      abbreviation: 'D15-cb',
      name: 'B',
    });
    await makeService(pool, { slug: 'd15-none', provider: provider.id });
    await makeService(pool, { slug: 'd15-one', provider: provider.id, consortia: [a.id] });
    await makeService(pool, { slug: 'd15-two', provider: provider.id, consortia: [a.id, b.id] });
    const reply = await s.getV1('/services', { headers });
    const { result } = reply.body as Page<{ abbreviation: string; consortia: string[] }>;
    expect(result.map((row) => [row.abbreviation, row.consortia])).toEqual([
      ['d15-none', []],
      ['d15-one', ['D15-ca']],
      ['d15-two', ['D15-ca', 'D15-cb']],
    ]);
  });

  it('counts the filtered set in totalCount, and uses the same envelope on both routes', async () => {
    const s = await start();
    const { headers } = await tokenOf(s, 'defect15-count');
    const pool = s.kernel.pool;
    const p1 = await makeOrganisation(pool, { abbreviation: 'D15-c1' });
    const p2 = await makeOrganisation(pool, { abbreviation: 'D15-c2' });
    for (let i = 0; i < 5; i++) await makeService(pool, { slug: `d15-c1-${i}`, provider: p1.id });
    for (let i = 0; i < 2; i++) await makeService(pool, { slug: `d15-c2-${i}`, provider: p2.id });
    const filtered = await s.getV1('/services?provider=D15-c1&pageSize=2', { headers });
    expect(filtered.body).toMatchObject({
      metadata: { currentPage: 0, pageSize: 2, totalCount: 5, totalPages: 3 },
    });
    expect((filtered.body as Page<unknown>).result).toHaveLength(2);
    const providers = await s.getV1('/providers?pageSize=1', { headers });
    expect(Object.keys(providers.body as object).sort()).toEqual(['metadata', 'result']);
    expect(Object.keys(filtered.body as object).sort()).toEqual(['metadata', 'result']);
    expect((providers.body as Page<unknown>).metadata).toMatchObject({
      totalCount: 2,
      totalPages: 2,
    });
  });
});
