// The contract test of the two v1 KPI routes (M9 sprint 3): the harness of packages/testing for each route, and the cases
// it cannot know: the legacy names and the added fields, the filters and the `totalCount` that follows them (defect 15),
// an unknown category or service, the scope of the family, a token without it.
import { listCategoriesV1Route, listIndicatorsV1Route } from '@scorpion/kpi-framework/public';
import {
  makeIndicator,
  makeKpiSet,
  makeOrganisation,
  makeService,
  makeServiceKpis,
  v1ContractTests,
  type V1ContractContext,
} from '@scorpion/testing';
import { beforeAll, describe, expect, it } from 'vitest';
import { useIdentityApp } from './testing/identity-app.ts';

const SCOPE = 'kpi.framework.v1.read';
const app = useIdentityApp({ shared: true });
let started: Awaited<ReturnType<typeof app.start>>;
let token = '';
let tokenWithoutScope = '';
let servicesOnlyToken = '';
const world: {
  service?: { id: string; slug: string };
  sets: { id: string; name: string; slug: string }[];
  indicators: { id: string; name: string }[];
} = { sets: [], indicators: [] };

async function tokenFor(who: { cookie: string; csrf: string }, scopes: string[]): Promise<string> {
  const reply = await started.post('/tokens', {
    ...who,
    body: { name: `t-${Math.random().toString(36).slice(2, 10)}`, scopes },
  });
  expect(reply.status).toBe(201);
  return (reply.body as { token: string }).token;
}

beforeAll(async () => {
  started = await app.start({ publicApi: true, kpi: true });
  const alice = await started.signedIn('alice-kpi');
  token = await tokenFor(alice, [SCOPE]);
  tokenWithoutScope = await tokenFor(alice, ['core.identity.me.read']);
  servicesOnlyToken = await tokenFor(alice, ['registry.services.v1.read']);
  const pool = started.kernel.pool;
  const provider = await makeOrganisation(pool, { abbreviation: 'Kp1' });
  world.service = await makeService(pool, { slug: 'kpi-svc', provider: provider.id });
  // Seven indicators and three sets, so the paging cases of the harness have pages to walk.
  for (let i = 0; i < 7; i++) {
    const indicator = await makeIndicator(pool, {
      name: `Contract indicator ${String.fromCharCode(97 + i)}`,
      unit: i % 2 === 0 ? 'count' : null,
    });
    world.indicators.push(indicator);
  }
  const [first, second, third, fourth] = world.indicators as unknown as [
    { id: string },
    { id: string },
    { id: string },
    { id: string },
  ];
  const wide = await makeKpiSet(pool, {
    name: 'Contract wide set',
    rimoCategory: 'Web_application',
    indicators: [
      { indicatorId: first.id, necessity: 'mandatory' },
      { indicatorId: second.id, necessity: 'recommended' },
      { indicatorId: third.id, necessity: 'optional' },
    ],
  });
  const narrow = await makeKpiSet(pool, {
    name: 'Contract narrow set',
    indicators: [{ indicatorId: fourth.id, necessity: 'mandatory' }],
  });
  const empty = await makeKpiSet(pool, { name: 'Contract empty set' });
  world.sets = [wide, narrow, empty];
  await makeServiceKpis(pool, {
    serviceId: world.service.id,
    setId: narrow.id,
    extras: [first.id],
  });
}, 120_000);

const call: V1ContractContext['call'] = async ({ method, path, headers }) => {
  const reply = await started.call(method, path, { v1: true, headers });
  return { status: reply.status, headers: reply.res.headers, body: reply.body };
};
const get = (path: string, who = token) =>
  started.getV1(path, { headers: { authorization: `Bearer ${who}` } });
type Row = Record<string, unknown> & { id: string; name: string };
const rows = (reply: { body: unknown }) => (reply.body as { result: Row[] }).result;
const metadata = (reply: { body: unknown }) =>
  (reply.body as { metadata: { totalCount: number; pageSize: number; totalPages: number } })
    .metadata;
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

// 'GET /categories' is the name the walker looks for (v1RoutesWithoutContractTest).
describe('GET /categories', () => {
  v1ContractTests(
    listCategoriesV1Route,
    contextOf({ list: { sortKey: (row) => String(row.name).toLowerCase() } }),
  );

  it('has the legacy name and, added, the id, IRI, description, RIMO category and the number of indicators', async () => {
    const reply = await get('/categories?pageSize=100');
    expect(reply.status).toBe(200);
    const wide = rows(reply).find((row) => row.id === world.sets[0]!.id)!;
    expect(wide).toMatchObject({
      name: 'Contract wide set',
      rimoCategory: 'http://w3id.org/RIMO#Web_application',
      indicators: 3,
      description: null,
    });
    expect(String(wide.iri).endsWith(`/kpi/set/${world.sets[0]!.slug}`)).toBe(true);
    expect(Object.keys(wide).sort()).toEqual(
      ['description', 'id', 'indicators', 'iri', 'name', 'rimoCategory'].sort(),
    );
    expect(rows(reply).find((row) => row.id === world.sets[2]!.id)).toMatchObject({
      indicators: 0,
      rimoCategory: null,
    });
  });

  it('is 422 for an unknown parameter and a pageSize over 100, never 500', async () => {
    for (const query of ['?q=text', '?pageSize=101', '?page=-1', '?category=x']) {
      const reply = await get(`/categories${query}`);
      expect(reply.status, query).toBe(422);
      expect(reply.res.headers.get('content-type')).toContain('application/problem+json');
    }
  });
});

describe('GET /indicators', () => {
  v1ContractTests(
    listIndicatorsV1Route,
    contextOf({ list: { sortKey: (row) => String(row.name).toLowerCase() } }),
  );

  it('has the legacy fields and, added, the id, IRI, example, qualitative, unit, bounds, means and tools', async () => {
    const reply = await get('/indicators?pageSize=100');
    const row = rows(reply).find((entry) => entry.id === world.indicators[0]!.id)!;
    expect(Object.keys(row).sort()).toEqual(
      [
        'canBeAutomatedBy',
        'description',
        'example',
        'id',
        'iri',
        'max',
        'measuredBy',
        'min',
        'name',
        'necessity',
        'qualitative',
        'selected',
        'thematicCategory',
        'type',
        'unit',
        'valueType',
      ].sort(),
    );
    expect(row).toMatchObject({
      type: 'number',
      valueType: 'integer',
      thematicCategory: 'Usage',
      selected: false,
      necessity: null,
      unit: { key: 'count', iri: 'http://purl.obolibrary.org/obo/UO_0000189' },
    });
  });

  it('keeps the indicators of a category with their necessity, and totalCount is the size of that set (defect 15)', async () => {
    const reply = await get('/indicators?category=contract%20WIDE%20set&pageSize=100');
    expect(reply.status).toBe(200);
    expect(metadata(reply).totalCount).toBe(3);
    expect(rows(reply).map((row) => [row.name, row.necessity])).toEqual([
      ['Contract indicator a', 'mandatory'],
      ['Contract indicator b', 'recommended'],
      ['Contract indicator c', 'optional'],
    ]);
    const paged = await get('/indicators?category=Contract%20wide%20set&pageSize=2&page=1');
    expect(metadata(paged)).toMatchObject({ totalCount: 3, totalPages: 2, pageSize: 2 });
    expect(rows(paged)).toHaveLength(1);
    const none = await get('/indicators?category=Contract%20empty%20set');
    expect(metadata(none).totalCount).toBe(0);
    expect(rows(none)).toEqual([]);
  });

  it('marks the effective set of a service, and lists the others unmarked', async () => {
    const reply = await get('/indicators?service=KPI-SVC&pageSize=100');
    const by = new Map(rows(reply).map((row) => [row.id, row]));
    expect(by.get(world.indicators[3]!.id)).toMatchObject({
      selected: true,
      necessity: 'mandatory',
    });
    expect(by.get(world.indicators[0]!.id)).toMatchObject({
      selected: true,
      necessity: 'optional',
    });
    expect(by.get(world.indicators[1]!.id)).toMatchObject({ selected: false, necessity: null });
    expect(metadata(reply).totalCount).toBeGreaterThanOrEqual(7);
  });

  it('is 422 naming the parameter for an unknown category or service, a bad filter and an unknown parameter, never 500', async () => {
    for (const [query, path] of [
      ['?category=No%20such%20set', 'category'],
      ['?service=no-such-service', 'service'],
    ] as const) {
      const reply = await get(`/indicators${query}`);
      expect(reply.status, query).toBe(422);
      expect(JSON.stringify(reply.body)).toContain(path);
    }
    for (const query of [
      '?category=',
      `?category=${'x'.repeat(201)}`,
      `?service=${'x'.repeat(65)}`,
      '?q=text',
      '?pageSize=101',
    ]) {
      const reply = await get(`/indicators${query}`);
      expect(reply.status, query).toBe(422);
      expect(reply.res.headers.get('content-type')).toContain('application/problem+json');
    }
  });
});

describe('the scope of the KPI family', () => {
  it('is needed on both routes: a token that names only the services scope is 403 [ASVS-8.3.1]', async () => {
    for (const path of ['/categories', '/indicators']) {
      expect((await get(path, servicesOnlyToken)).status, path).toBe(403);
    }
  });

  it('is not needed by the services scope for the new `category` of a service row', async () => {
    const reply = await get('/services?service=kpi-svc', servicesOnlyToken);
    expect(reply.status).toBe(200);
    expect(rows(reply)[0]).toMatchObject({ category: 'Contract narrow set' });
    const filtered = await get('/services?category=contract%20narrow%20set', servicesOnlyToken);
    expect(rows(filtered).map((row) => row.id)).toEqual([world.service!.id]);
    expect(metadata(filtered).totalCount).toBe(1);
    expect((await get('/services?category=nothing', servicesOnlyToken)).status).toBe(422);
  });
});
