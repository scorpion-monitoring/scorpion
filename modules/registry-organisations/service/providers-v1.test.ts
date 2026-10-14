// `listProvidersV1` against real Postgres: the real authoriser decides. The `is_member` matrix is checked against a
// brute-force count over generated data (defect 15: `false` must be the others, not nothing).
import { Forbidden, Unauthorized, type Actor } from '@scorpion/contracts';
import { makeMembership, makeOrganisation } from '@scorpion/testing';
import { describe, expect, it } from 'vitest';
import { useOrganisations } from '../test/harness.ts';

const h = useOrganisations();
const anonymous: Actor = { kind: 'anonymous' };
const PAGE = { page: 0, pageSize: 100 };

async function setup() {
  const s = await h.start();
  return { ...s, user: await s.actor('user') };
}

describe('listProvidersV1', () => {
  it('answers a list of zero, one and many, sorted by abbreviation without case and then id', async () => {
    const { organisations, pool, user } = await setup();
    expect(await organisations.listProvidersV1(user, {}, PAGE)).toEqual({
      providers: [],
      total: 0,
    });
    await makeOrganisation(pool, { abbreviation: 'beta-v1', name: 'B' });
    expect((await organisations.listProvidersV1(user, {}, PAGE)).total).toBe(1);
    await makeOrganisation(pool, { abbreviation: 'Alpha-v1', name: 'A' });
    await makeOrganisation(pool, { abbreviation: 'Gamma-v1', name: 'G' });
    const { providers, total } = await organisations.listProvidersV1(user, {}, PAGE);
    expect(providers.map((p) => p.abbreviation)).toEqual(['Alpha-v1', 'beta-v1', 'Gamma-v1']);
    expect(total).toBe(3);
    const second = await organisations.listProvidersV1(user, {}, { page: 1, pageSize: 2 });
    expect(second.providers.map((p) => p.abbreviation)).toEqual(['Gamma-v1']);
    expect(second.total).toBe(3);
  });

  it('lists only the providers: an organisation of another type is not one', async () => {
    const { organisations, pool, user } = await setup();
    await makeOrganisation(pool, { abbreviation: 'P1' });
    await makeOrganisation(pool, { abbreviation: 'C1', type: 'consortium' });
    const { providers, total } = await organisations.listProvidersV1(user, {}, PAGE);
    expect(providers.map((p) => p.abbreviation)).toEqual(['P1']);
    expect(total).toBe(1);
  });

  it('returns a pinned row and never the contact point, the audit columns, the member count or the logo', async () => {
    const { organisations, pool, user } = await setup();
    await makeOrganisation(pool, {
      abbreviation: 'FULL',
      description: 'About',
      website: 'https://full.example.org',
      rorId: '02skbsp27',
      sameAs: ['https://example.org/full'],
      contactEmail: 'secret@example.org',
      contactType: 'support',
      logoBlobId: '018f3b7e-6666-7000-8000-000000000006',
      logoHash: 'e'.repeat(64),
      createdBy: '018f3b7e-7777-7000-8000-000000000007',
    });
    const [row] = (await organisations.listProvidersV1(user, {}, PAGE)).providers;
    expect(Object.keys(row!).sort()).toEqual(
      [
        'abbreviation',
        'description',
        'id',
        'isMember',
        'name',
        'rorId',
        'sameAs',
        'website',
      ].sort(),
    );
    expect(row).toMatchObject({ description: 'About', rorId: '02skbsp27', isMember: false });
    expect(JSON.stringify(row)).not.toMatch(/secret@|support|logo|createdBy|memberCount/);
  });

  it('answers is_member=true with the approved memberships and is_member=false with all the others [ASVS-8.2.3]', async () => {
    const { organisations, pool, actor, user } = await setup();
    const states = ['approved', 'requested', 'rejected', 'left'] as const;
    const mine = new Set<string>();
    const all: string[] = [];
    for (let i = 0; i < 12; i++) {
      const org = await makeOrganisation(pool, { abbreviation: `M${String(i).padStart(2, '0')}` });
      all.push(org.id);
      // Cycle through: no membership, each state as a member, a manager, and someone else's approved row.
      if (i % 6 === 1 || i % 6 === 2 || i % 6 === 3 || i % 6 === 4) {
        const state = states[(i % 6) - 1]!;
        await makeMembership(pool, { organisationId: org.id, userId: user.userId, state });
        if (state === 'approved') mine.add(org.id);
      } else if (i % 6 === 5) {
        await makeMembership(pool, {
          organisationId: org.id,
          userId: user.userId,
          state: 'approved',
          role: 'manager',
        });
        mine.add(org.id);
      } else {
        const other = await actor('user');
        await makeMembership(pool, { organisationId: org.id, userId: other.userId });
      }
    }
    const ids = async (isMember: boolean | undefined, page = PAGE) =>
      (await organisations.listProvidersV1(user, { isMember }, page)).providers.map((p) => p.id);
    const members = await ids(true);
    const others = await ids(false);
    expect(new Set(members)).toEqual(mine);
    expect(new Set(others)).toEqual(new Set(all.filter((id) => !mine.has(id))));
    expect(others.length).toBeGreaterThan(0);
    expect(members.length + others.length).toBe(all.length);
    expect((await ids(undefined)).length).toBe(all.length);
    // totalCount counts the filtered set, not the table.
    const filtered = await organisations.listProvidersV1(
      user,
      { isMember: false },
      { page: 0, pageSize: 2 },
    );
    expect(filtered.total).toBe(others.length);
    expect(filtered.providers).toHaveLength(2);
    // and the flag of a row says the same as the filter.
    const rows = (await organisations.listProvidersV1(user, {}, PAGE)).providers;
    expect(new Set(rows.filter((p) => p.isMember).map((p) => p.id))).toEqual(mine);
  });

  it('is denied to an anonymous caller and to a signed-in person without the permission', async () => {
    const { organisations, actor, pool } = await setup();
    await makeOrganisation(pool, {});
    await expect(organisations.listProvidersV1(anonymous, {}, PAGE)).rejects.toBeInstanceOf(
      Unauthorized,
    );
    const nobody = await actor();
    await expect(organisations.listProvidersV1(nobody, {}, PAGE)).rejects.toBeInstanceOf(Forbidden);
    // The plain organisation read is not the v1 permission.
    const reader = await actor('reviewer');
    await expect(organisations.listProvidersV1(reader, {}, PAGE)).rejects.toBeInstanceOf(Forbidden);
  });
});
