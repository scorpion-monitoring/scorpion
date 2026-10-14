// The contract test of the three v1 service routes (M8 sprint 2): the harness of packages/testing for each route, and the
// cases it cannot know: the filters, an unknown abbreviation, a service with zero, one and two consortia, an unknown or
// malformed id, a private service, the Schema.org answer without the contact point.
import {
  getServiceSchemaOrgV1Route,
  getServiceV1Route,
  listServicesV1Route,
} from '@scorpion/registry-services/public';
import {
  makeOrganisation,
  makeService,
  v1ContractTests,
  type V1ContractContext,
} from '@scorpion/testing';
import { beforeAll, describe, expect, it } from 'vitest';
import { useIdentityApp } from './testing/identity-app.ts';

const SCOPE = 'registry.services.v1.read';
const app = useIdentityApp({ shared: true });
let started: Awaited<ReturnType<typeof app.start>>;
let token = '';
let tokenWithoutScope = '';
let providersOnlyToken = '';
const world: {
  p1?: { id: string; abbreviation: string };
  p2?: { id: string; abbreviation: string };
  zero?: { id: string; slug: string };
  one?: { id: string; slug: string };
  two?: { id: string; slug: string };
  consortia: { id: string; abbreviation: string }[];
  count: number;
} = { consortia: [], count: 0 };
const ABSENT = '018f3b7e-0000-7000-8000-000000000000';

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
  const alice = await started.signedIn('alice-services');
  token = await tokenFor(alice, [SCOPE]);
  tokenWithoutScope = await tokenFor(alice, ['core.identity.me.read']);
  providersOnlyToken = await tokenFor(alice, ['registry.organisations.v1.read']);
  const pool = started.kernel.pool;
  const p1 = await makeOrganisation(pool, { abbreviation: 'Sp1', name: 'Provider one' });
  const p2 = await makeOrganisation(pool, { abbreviation: 'Sp2', name: 'Provider two' });
  const c1 = await makeOrganisation(pool, {
    type: 'consortium',
    abbreviation: 'Sc1',
    name: 'Consortium A',
  });
  const c2 = await makeOrganisation(pool, {
    type: 'consortium',
    abbreviation: 'Sc2',
    name: 'Consortium B',
  });
  world.p1 = p1;
  world.p2 = p2;
  world.consortia = [c1, c2];
  world.zero = await makeService(pool, {
    slug: 'sv-zero',
    provider: p1.id,
    stage: 'PROD',
    license: 'MIT',
  });
  world.one = await makeService(pool, {
    slug: 'Sv-one',
    provider: p1.id,
    consortia: [c1.id],
    public: true,
    description: 'About',
    url: 'https://one.example.org',
    contactEmail: 'secret@example.org',
    contactType: 'support',
  });
  world.two = await makeService(pool, {
    slug: 'sv-two',
    provider: p2.id,
    consortia: [c2.id, c1.id],
    stage: 'DEV',
    license: 'MIT',
  });
  // Enough rows that the paging cases of the harness have pages to walk.
  for (let i = 0; i < 6; i++) await makeService(pool, { slug: `sv-fill-${i}`, provider: p2.id });
  world.count = 9;
}, 120_000);

const call: V1ContractContext['call'] = async ({ method, path, headers }) => {
  const reply = await started.call(method, path, { v1: true, headers });
  return { status: reply.status, headers: reply.res.headers, body: reply.body };
};
const get = (path: string, who = token) =>
  started.getV1(path, { headers: { authorization: `Bearer ${who}` } });
type Row = { id: string; abbreviation: string; provider: string | null; consortia: string[] };
const rows = (reply: { body: unknown }) => (reply.body as { result: Row[] }).result;
const metadata = (reply: { body: unknown }) =>
  (reply.body as { metadata: { totalCount: number; pageSize: number } }).metadata;
/** The context of a route. The tokens are read when a case runs (after `beforeAll`), not when the cases are registered. */
const contextOf = (extra: Pick<V1ContractContext, 'list' | 'params'>): V1ContractContext => ({
  call,
  get token() {
    return token;
  },
  get tokenWithoutScope() {
    return tokenWithoutScope;
  },
  ...extra,
});

// 'GET /services' is the name the walker looks for (v1RoutesWithoutContractTest).
describe('GET /services', () => {
  v1ContractTests(
    listServicesV1Route,
    contextOf({ list: { sortKey: (row) => String(row.abbreviation).toLowerCase() } }),
  );

  it('lists one row per service with zero, one and two consortia, and a private service with its flag [ASVS-8.2.3]', async () => {
    const reply = await get('/services?pageSize=100');
    expect(reply.status).toBe(200);
    expect(metadata(reply).totalCount).toBe(world.count);
    const byId = new Map(rows(reply).map((row) => [row.id, row]));
    expect(byId.size).toBe(world.count);
    expect(byId.get(world.zero!.id)!.consortia).toEqual([]);
    expect(byId.get(world.one!.id)).toMatchObject({ consortia: ['Sc1'], public: true });
    expect(byId.get(world.two!.id)).toMatchObject({
      consortia: ['Sc1', 'Sc2'],
      provider: 'Sp2',
      public: false,
    });
    expect(JSON.stringify(reply.body)).not.toMatch(/secret@|support|contactPoint/);
  });

  it('filters by service and provider abbreviations (comma-separated, without case), and totalCount counts the filtered set', async () => {
    const some = await get('/services?service=SV-ZERO,sv-one');
    expect(rows(some).map((r) => r.abbreviation)).toEqual(['Sv-one', 'sv-zero']);
    expect(metadata(some).totalCount).toBe(2);
    const byProvider = await get('/services?provider=sp1&pageSize=1');
    expect(rows(byProvider)).toHaveLength(1);
    expect(metadata(byProvider).totalCount).toBe(2);
    const both = await get('/services?provider=Sp2&stage=DEV&license=MIT');
    expect(rows(both).map((r) => r.id)).toEqual([world.two!.id]);
    expect(metadata(both).totalCount).toBe(1);
  });

  it('is 422 for an unknown provider or service abbreviation, a bad filter and an unknown parameter, never 500', async () => {
    for (const query of [
      '?provider=nobody-sp',
      '?service=nothing-sv',
      '?provider=Sp1,nobody-sp',
      '?provider=',
      '?service=a,,b',
      '?stage=NOPE',
      '?license=NOT-A-LICENCE',
      '?stage=:none',
      '?q=text',
      '?pageSize=101',
      `?provider=${'x'.repeat(65)}`,
      `?service=${Array.from({ length: 51 }, (_, i) => `s${i}`).join(',')}`,
    ]) {
      const reply = await get(`/services${query}`);
      expect(reply.status, query).toBe(422);
      expect(reply.res.headers.get('content-type')).toContain('application/problem+json');
    }
  });
});

const oneId = {
  get id() {
    return world.one!.id;
  },
};

describe('the scope of the services family', () => {
  it('is needed on all three routes: a token that names only the providers scope is 403 [ASVS-8.3.1]', async () => {
    for (const path of [
      '/services',
      `/services/${world.one!.id}`,
      `/services/${world.one!.id}/schema-org`,
    ]) {
      expect((await get(path, providersOnlyToken)).status, path).toBe(403);
    }
  });
});

describe('GET /services/{id}', () => {
  v1ContractTests(getServiceV1Route, contextOf({ params: oneId }));

  it('returns the record of a private and of a public service, the same row as the list plus description, url and links, and never the contact point', async () => {
    const reply = await get(`/services/${world.one!.id}`);
    expect(reply.body).toMatchObject({
      id: world.one!.id,
      abbreviation: 'Sv-one',
      public: true,
      provider: 'Sp1',
      consortia: ['Sc1'],
      description: 'About',
      url: 'https://one.example.org',
      sameAs: [],
    });
    expect(JSON.stringify(reply.body)).not.toMatch(/secret@|support|contact/i);
    const privateOne = await get(`/services/${world.zero!.id}`);
    expect(privateOne.status).toBe(200);
    expect((privateOne.body as { public: boolean }).public).toBe(false);
  });

  it('is 404 for an unknown id and 422 for one that is no UUID, never 500', async () => {
    const unknown = await get(`/services/${ABSENT}`);
    expect(unknown.status).toBe(404);
    expect(unknown.res.headers.get('content-type')).toContain('application/problem+json');
    for (const id of ['not-a-uuid', '123', 'sv-zero']) {
      expect((await get(`/services/${id}`)).status, id).toBe(422);
    }
  });
});

describe('GET /services/{id}/schema-org', () => {
  v1ContractTests(getServiceSchemaOrgV1Route, contextOf({ params: oneId }));

  it('is the profile the internal route gives, as JSON-LD, without the contact point and for a private service too', async () => {
    const reply = await get(`/services/${world.one!.id}/schema-org`);
    expect(reply.status).toBe(200);
    expect(reply.res.headers.get('content-type')).toContain('application/ld+json');
    expect(reply.res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(reply.body).toMatchObject({ '@type': 'Service', alternateName: 'Sv-one' });
    expect(typeof (reply.body as { name: unknown }).name).toBe('string');
    expect(JSON.stringify(reply.body)).not.toMatch(/secret@|support|contactPoint/);
    expect((await get(`/services/${world.zero!.id}/schema-org`)).status).toBe(200);
  });

  it('is 404 for an unknown id and 422 for one that is no UUID', async () => {
    expect((await get(`/services/${ABSENT}/schema-org`)).status).toBe(404);
    expect((await get('/services/not-a-uuid/schema-org')).status).toBe(422);
  });
});
