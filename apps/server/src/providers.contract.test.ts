// The contract test of GET /api/v1/providers (M8 sprint 2): the harness of packages/testing (never public, 401, 403,
// Bearer and X-API-Key, the envelope, the stable order, the paging cases) and the cases the harness cannot know: the
// `is_member` matrix against a brute-force count over generated data, a bad filter, the size cap, the pinned row.
import { listProvidersV1Route } from '@scorpion/registry-organisations/public';
import {
  makeMembership,
  makeOrganisation,
  v1ContractTests,
  type V1ContractContext,
} from '@scorpion/testing';
import { beforeAll, describe, expect, it } from 'vitest';
import { useIdentityApp } from './testing/identity-app.ts';

const SCOPE = 'registry.organisations.v1.read';
const app = useIdentityApp({ shared: true });
let started: Awaited<ReturnType<typeof app.start>>;
let token = '';
let tokenWithoutScope = '';
/** The ids of the generated providers the token's owner is an approved member of, and all of them. */
const mine = new Set<string>();
const all: string[] = [];

async function tokenFor(who: { cookie: string; csrf: string }, scopes: string[]): Promise<string> {
  const reply = await started.post('/tokens', {
    ...who,
    body: { name: `t-${Math.random().toString(36).slice(2, 10)}`, scopes },
  });
  expect(reply.status).toBe(201);
  return (reply.body as { token: string }).token;
}

beforeAll(async () => {
  started = await app.start({ publicApi: true });
  const alice = await started.signedIn('alice-providers');
  const bob = await started.signedIn('bob-providers');
  token = await tokenFor(alice, [SCOPE]);
  tokenWithoutScope = await tokenFor(alice, ['core.identity.me.read']);
  const pool = started.kernel.pool;
  const states = ['approved', 'requested', 'rejected', 'left', 'manager', 'other', 'none'] as const;
  for (let i = 0; i < 28; i++) {
    const org = await makeOrganisation(pool, { abbreviation: `Pv${String(i).padStart(2, '0')}` });
    all.push(org.id);
    const kind = states[i % states.length]!;
    if (kind === 'manager') {
      await makeMembership(pool, {
        organisationId: org.id,
        userId: alice.user.id,
        state: 'approved',
        role: 'manager',
      });
      mine.add(org.id);
    } else if (
      kind === 'approved' ||
      kind === 'requested' ||
      kind === 'rejected' ||
      kind === 'left'
    ) {
      await makeMembership(pool, { organisationId: org.id, userId: alice.user.id, state: kind });
      if (kind === 'approved') mine.add(org.id);
    } else if (kind === 'other') {
      await makeMembership(pool, { organisationId: org.id, userId: bob.user.id });
    }
  }
  // A consortium is no provider.
  await makeOrganisation(pool, { type: 'consortium', abbreviation: 'Cons-v1' });
}, 120_000);

const call: V1ContractContext['call'] = async ({ method, path, headers }) => {
  const reply = await started.call(method, path, { v1: true, headers });
  return { status: reply.status, headers: reply.res.headers, body: reply.body };
};
const get = (query: string, who = token) =>
  started.getV1(`/providers${query}`, { headers: { authorization: `Bearer ${who}` } });
type Row = { id: string; abbreviation: string; name: string; isMember: boolean };
const rows = (reply: { body: unknown }) => (reply.body as { result: Row[] }).result;

// 'GET /providers' is the name the walker looks for (v1RoutesWithoutContractTest).
describe('GET /providers', () => {
  v1ContractTests(listProvidersV1Route, {
    call,
    get token() {
      return token;
    },
    get tokenWithoutScope() {
      return tokenWithoutScope;
    },
    list: { sortKey: (row) => String(row.abbreviation).toLowerCase() },
  });

  it('answers is_member=true with the approved memberships and is_member=false with all the others, counted against the generated data [ASVS-8.2.3]', async () => {
    const members = await get('?is_member=true&pageSize=100');
    const others = await get('?is_member=false&pageSize=100');
    expect(members.status).toBe(200);
    expect(others.status).toBe(200);
    expect(new Set(rows(members).map((r) => r.id))).toEqual(mine);
    expect(new Set(rows(others).map((r) => r.id))).toEqual(
      new Set(all.filter((id) => !mine.has(id))),
    );
    expect(rows(others).length).toBeGreaterThan(0);
    expect(rows(others).every((r) => !r.isMember)).toBe(true);
    expect(rows(members).every((r) => r.isMember)).toBe(true);
    const total = (reply: { body: unknown }) =>
      (reply.body as { metadata: { totalCount: number } }).metadata.totalCount;
    expect(total(members)).toBe(mine.size);
    expect(total(others)).toBe(all.length - mine.size);
    expect(total(await get('?pageSize=100'))).toBe(all.length);
    // totalCount is the filtered set even when the page holds less of it.
    const small = await get('?is_member=false&pageSize=3');
    expect(rows(small)).toHaveLength(3);
    expect(total(small)).toBe(all.length - mine.size);
  });

  it('is 422 for an is_member that is not a boolean, for a parameter it does not know, and for a pageSize over 100, never 500', async () => {
    for (const query of [
      '?is_member=maybe',
      '?is_member=',
      '?is_member=1',
      '?nope=1',
      '?pageSize=101',
    ]) {
      const reply = await get(query);
      expect(reply.status, query).toBe(422);
      expect(reply.res.headers.get('content-type')).toContain('application/problem+json');
    }
  });

  it('pages 100 at a time by default, and a row has the legacy fields and nothing private', async () => {
    const reply = await get('');
    expect((reply.body as { metadata: { pageSize: number } }).metadata.pageSize).toBe(100);
    const [row] = rows(reply);
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
    expect(JSON.stringify(reply.body)).not.toMatch(/contact|memberCount|createdBy|logo/i);
  });
});
