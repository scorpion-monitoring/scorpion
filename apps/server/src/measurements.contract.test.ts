// The contract test of the two v1 measurement routes (M10 sprint 2): the harness of packages/testing for each route, and the cases it
// cannot know. GET: the legacy names and the added fields, the envelope key `result`, the filters and the `totalCount` that follows them,
// the order across pages, an unknown service, indicator or month. POST: the upsert (twice is one row), a write that is visible in the
// next read, who may write (a token needs its scopes and an owner who may submit for the service), what a bad body is (422, never 500),
// the body limit, the CSRF check on a cookie, the preflight, and a form-like submission that gives the same rows as the API.
import {
  MAX_API_BODY_BYTES,
  listMeasurementsV1Route,
  writeMeasurementsV1Route,
} from '@scorpion/kpi-ingestion/public';
import type { KpiIngestionPublic } from '@scorpion/kpi-ingestion/public';
import {
  makeIndicator,
  makeKpiSet,
  makeMeasurement,
  makeMembership,
  makeOrganisation,
  makeService,
  makeServiceKpis,
  makeSetting,
  v1ContractTests,
  type V1ContractContext,
} from '@scorpion/testing';
import { beforeAll, describe, expect, it } from 'vitest';
import { useIdentityApp } from './testing/identity-app.ts';

const READ = 'kpi.ingestion.v1.read';
const WRITE = 'kpi.ingestion.v1.write';
const SUBMIT = 'kpi.ingestion.measurement.submit';
const ORIGIN = 'https://app.example.org';
// A fixed "now": the months written below are never in the future whatever day the suite runs.
const NOW = new Date('2026-06-15T12:00:00Z');

const app = useIdentityApp({ shared: true });
let started: Awaited<ReturnType<typeof app.start>>;
type Person = Awaited<ReturnType<typeof started.signedIn>>;
const people: Record<'alice' | 'bob' | 'carol' | 'admin', Person> = {} as never;
const tokens: Record<string, string> = {};
const world = {} as {
  read: { id: string; slug: string };
  write: { id: string; slug: string };
  elsewhere: { id: string; slug: string };
  downloads: { id: string; name: string };
  share: { id: string; name: string };
  uptime: { id: string; name: string };
  notes: { id: string; name: string }[];
  outside: { id: string; name: string };
};

async function tokenFor(who: Person, scopes: string[]): Promise<string> {
  const reply = await started.post('/tokens', {
    cookie: who.cookie,
    csrf: who.csrf,
    body: { name: `t-${Math.random().toString(36).slice(2, 10)}`, scopes },
  });
  expect(reply.status).toBe(201);
  return (reply.body as { token: string }).token;
}

beforeAll(async () => {
  started = await app.start({
    publicApi: true,
    kpi: true,
    ingestion: { clock: () => NOW },
    settingsModule: { cacheTtlMs: 0 },
  });
  const pool = started.kernel.pool;
  people.alice = await started.signedIn('alice-meas');
  people.bob = await started.signedIn('bob-meas');
  people.carol = await started.signedIn('carol-meas');
  people.admin = await started.signedIn('admin-meas', { roles: ['admin'] });

  const mine = await makeOrganisation(pool, { abbreviation: 'Mc1', type: 'provider' });
  const theirs = await makeOrganisation(pool, { abbreviation: 'Mc2', type: 'provider' });
  await makeMembership(pool, {
    organisationId: mine.id,
    userId: people.alice.user.id,
    state: 'approved',
    role: 'member',
  });
  await makeMembership(pool, {
    organisationId: theirs.id,
    userId: people.bob.user.id,
    state: 'approved',
    role: 'member',
  });

  world.downloads = await makeIndicator(pool, {
    name: 'Contract downloads',
    valueType: 'integer',
    min: 0,
    max: 1_000_000,
  });
  world.share = await makeIndicator(pool, { name: 'contract share', valueType: 'percentage' });
  world.uptime = await makeIndicator(pool, { name: 'Contract uptime', valueType: 'duration' });
  world.notes = await Promise.all(
    'abcde'.split('').map((letter) =>
      makeIndicator(pool, {
        name: `Contract note ${letter}`,
        valueType: 'text',
        qualitative: true,
      }),
    ),
  );
  world.outside = await makeIndicator(pool, { name: 'Contract outside', valueType: 'integer' });
  const set = await makeKpiSet(pool, {
    name: 'Contract measurement set',
    indicators: [
      { indicatorId: world.downloads.id, necessity: 'mandatory' },
      { indicatorId: world.share.id, necessity: 'recommended' },
      { indicatorId: world.uptime.id, necessity: 'optional' },
      ...world.notes.map((note) => ({ indicatorId: note.id, necessity: 'optional' })),
    ],
  });
  // `read` holds the series the GET cases read; `write` is where the POST cases write; `elsewhere` belongs to the other provider.
  world.read = await makeService(pool, { slug: 'meas-read', provider: mine.id });
  world.write = await makeService(pool, { slug: 'meas-write', provider: mine.id });
  world.elsewhere = await makeService(pool, { slug: 'meas-elsewhere', provider: theirs.id });
  for (const svc of [world.read, world.write, world.elsewhere])
    await makeServiceKpis(pool, { serviceId: svc.id, setId: set.id });

  const months = [
    '2025-11-30',
    '2025-12-31',
    '2026-01-31',
    '2026-02-28',
    '2026-03-31',
    '2026-04-30',
    '2026-05-31',
    '2026-06-30',
  ];
  for (const [n, period] of months.entries())
    await makeMeasurement(pool, {
      serviceId: world.read.id,
      indicatorId: world.downloads.id,
      period,
      valueNumeric: 100 + n,
    });
  for (const [n, period] of months.slice(2, 6).entries())
    await makeMeasurement(pool, {
      serviceId: world.read.id,
      indicatorId: world.share.id,
      period,
      valueNumeric: 10.5 + n,
    });
  await makeMeasurement(pool, {
    serviceId: world.read.id,
    indicatorId: world.uptime.id,
    period: months[2]!,
    valueNumeric: 3661,
  });
  await makeMeasurement(pool, {
    serviceId: world.read.id,
    indicatorId: world.uptime.id,
    period: months[3]!,
    valueNumeric: 7200,
  });
  // Another service's values must never show in the series of this one.
  await makeMeasurement(pool, {
    serviceId: world.elsewhere.id,
    indicatorId: world.downloads.id,
    period: months[0]!,
    valueNumeric: 9_999,
  });

  tokens.read = await tokenFor(people.alice, [READ]);
  tokens.noScope = await tokenFor(people.alice, ['core.identity.me.read']);
  // A write token names the scope of the route and the scoped permission the service checks for its owner.
  tokens.write = await tokenFor(people.alice, [WRITE, SUBMIT]);
  tokens.writeOnly = await tokenFor(people.alice, [WRITE]);
  tokens.submitOnly = await tokenFor(people.alice, [SUBMIT]);
  tokens.bobWrite = await tokenFor(people.bob, [WRITE, SUBMIT]);
  tokens.carolWrite = await tokenFor(people.carol, [WRITE, SUBMIT]);
  tokens.adminWrite = await tokenFor(people.admin, [WRITE, SUBMIT]);
  await makeSetting(pool, 'public-api', { corsOrigins: [ORIGIN] });
}, 180_000);

const call: V1ContractContext['call'] = async ({ method, path, headers, body }) => {
  const reply = await started.call(method, path, {
    v1: true,
    headers,
    ...(body === undefined ? {} : { body }),
  });
  return { status: reply.status, headers: reply.res.headers, body: reply.body };
};
const bearer = (token: string) => ({ authorization: `Bearer ${token}` });
const get = (query: string, token = tokens.read!) =>
  started.getV1(`/measurements${query}`, { headers: bearer(token) });
const post = (service: string, body: unknown, token = tokens.write!) =>
  started.call('POST', `/measurements?service=${encodeURIComponent(service)}`, {
    v1: true,
    headers: bearer(token),
    body,
  });
type Row = Record<string, unknown> & { kpi: string; period: string; id: string };
const result = (reply: { body: unknown }) => (reply.body as { result: Row[] }).result;
const metadata = (reply: { body: unknown }) =>
  (
    reply.body as {
      metadata: { totalCount: number; pageSize: number; totalPages: number; currentPage: number };
    }
  ).metadata;
const problemPaths = (reply: { body: unknown }) =>
  ((reply.body as { errors?: { in: string; path: string }[] }).errors ?? []).map(
    (e) => `${e.in}:${e.path}`,
  );
const rowsOf = async (serviceId: string) =>
  (
    await started.kernel.pool.query<{
      indicator_id: string;
      period: string;
      value_numeric: string | null;
      value_text: string | null;
      created_by: string | null;
      source: string;
    }>(
      `select indicator_id, to_char(period, 'YYYY-MM-DD') as period, value_numeric::text, value_text, created_by, source
         from kpii_measurement where service_id = $1 order by indicator_id, period`,
      [serviceId],
    )
  ).rows;
const countRows = async (serviceId: string) => (await rowsOf(serviceId)).length;

// 'GET /measurements' is the name the walker looks for (v1RoutesWithoutContractTest).
describe('GET /measurements', () => {
  // The tokens and the query are read when a case runs (after `beforeAll`), not when the cases are registered: getters, never a spread.
  v1ContractTests(listMeasurementsV1Route, {
    call,
    get token() {
      return tokens.read!;
    },
    get tokenWithoutScope() {
      return tokens.noScope!;
    },
    get query() {
      return { service: world.read.slug };
    },
    list: { sortKey: (row) => `${String(row.period)}|${String(row.kpi).toLowerCase()}` },
  });

  it('has the legacy kpi, value and date and, added, id, indicatorId, iri, service, period and valueNumber, and nothing else', async () => {
    const reply = await get(`?service=${world.read.slug}&pageSize=100`);
    expect(reply.status).toBe(200);
    const row = result(reply).find(
      (r) => r.kpi === world.uptime.name && r.period === '2026-01-31',
    )!;
    expect(Object.keys(row).sort()).toEqual(
      [
        'date',
        'id',
        'indicatorId',
        'iri',
        'kpi',
        'period',
        'service',
        'value',
        'valueNumber',
      ].sort(),
    );
    expect(row).toMatchObject({
      kpi: 'Contract uptime',
      value: '01-01-01',
      date: '2026-01-31',
      period: '2026-01-31',
      indicatorId: world.uptime.id,
      service: 'meas-read',
      valueNumber: 3661,
    });
    expect(String(row.iri)).toMatch(/\/kpi\/indicator\//);
    const number = result(reply).find((r) => r.kpi === world.downloads.name)!;
    expect(number).toMatchObject({ value: '100', valueNumber: 100 });
  });

  it('answers with `result` and not the legacy `data` (defect 6)', async () => {
    const reply = await get(`?service=${world.read.slug}`);
    expect(Object.keys(reply.body as object).sort()).toEqual(['metadata', 'result']);
    expect(metadata(reply)).toEqual({
      currentPage: 0,
      pageSize: 100,
      totalCount: 14,
      totalPages: 1,
    });
  });

  it('takes the service by id and by abbreviation without case', async () => {
    for (const service of [world.read.id, world.read.slug.toUpperCase()])
      expect(metadata(await get(`?service=${service}`)).totalCount).toBe(14);
  });

  it('keeps the indicators asked for (names without case, or ids) and the months, and totalCount follows each filter (defect 15)', async () => {
    const q = (extra: string) => get(`?service=${world.read.slug}&${extra}`);
    expect(metadata(await q('indicators=CONTRACT%20DOWNLOADS')).totalCount).toBe(8);
    expect(metadata(await q(`indicators=${world.share.id},contract%20uptime`)).totalCount).toBe(6);
    expect(metadata(await q('start=2026-03&stop=2026-04')).totalCount).toBe(4);
    expect(metadata(await q('start=2026-03-15&stop=2026-04-01')).totalCount).toBe(4);
    expect(metadata(await q('start=2026-06')).totalCount).toBe(1);
    expect(metadata(await q('start=2027-01')).totalCount).toBe(0);
    const some = await q('indicators=Contract%20downloads&start=2026-05&pageSize=1');
    expect(metadata(some)).toMatchObject({ totalCount: 2, totalPages: 2 });
    expect(result(some)).toHaveLength(1);
  });

  it('is in order of month, indicator name without case, then id, across pages: the walk equals the one-page list', async () => {
    const whole = result(await get(`?service=${world.read.slug}&pageSize=100`));
    const keys = whole.map((row) => `${row.period}|${row.kpi.toLowerCase()}`);
    expect(keys).toEqual([...keys].sort());
    const walked: Row[] = [];
    for (let page = 0; page < 14; page++)
      walked.push(...result(await get(`?service=${world.read.slug}&pageSize=1&page=${page}`)));
    expect(walked.map((row) => row.id)).toEqual(whole.map((row) => row.id));
    // `contract share` sorts before `Contract uptime` in a month that has both, though a case-sensitive order would not
    const january = whole.filter((row) => row.period === '2026-01-31').map((row) => row.kpi);
    expect(january).toEqual(['Contract downloads', 'contract share', 'Contract uptime']);
  });

  it('holds nothing of another service, and a service with no values is an empty page, not an error', async () => {
    const mine = JSON.stringify(result(await get(`?service=${world.read.slug}&pageSize=100`)));
    expect(mine).not.toContain('9999');
    const none = await get(`?service=${world.write.slug}`);
    expect(none.status).toBe(200);
    expect(metadata(none).totalCount).toBe(0);
    expect(result(none)).toEqual([]);
  });

  it('is 422 naming the parameter for a missing or unknown service, an unknown indicator, a bad month, a start after stop and an unknown parameter, never 500', async () => {
    const slug = world.read.slug;
    const bad: [string, string][] = [
      ['', 'query:service'],
      ['?service=no-such-service', 'query:service'],
      [`?service=${slug}&indicators=Not%20an%20indicator`, 'query:indicators'],
      [
        `?service=${slug}&indicators=${world.outside.name.replaceAll(' ', '%20')}`,
        'query:indicators',
      ],
      [`?service=${slug}&indicators=a,,b`, 'query:indicators.1'],
      [`?service=${slug}&start=2026-13`, 'query:start'],
      [`?service=${slug}&stop=june`, 'query:stop'],
      [`?service=${slug}&start=2026-06&stop=2026-01`, 'query:start'],
      // an unknown key is named in the message; Zod gives it no path
      [`?service=${slug}&since=2026-01`, 'query:'],
      [`?service=${slug}&pageSize=101`, 'query:pageSize'],
    ];
    for (const [query, path] of bad) {
      const reply = await get(query);
      expect(reply.status, query).toBe(422);
      expect(reply.res.headers.get('content-type')).toContain('application/problem+json');
      expect(problemPaths(reply), query).toContain(path);
    }
  });

  it('is refused with a token that names the write scope but not the read scope (403), and with a made-up one (401)', async () => {
    expect((await get(`?service=${world.read.slug}`, tokens.write!)).status).toBe(403);
    expect((await get(`?service=${world.read.slug}`, 'scp_abcd1234_nonsense')).status).toBe(401);
  });

  it('can be read by anyone with the read scope, whichever provider they belong to', async () => {
    const bobRead = await tokenFor(people.bob, [READ]);
    expect(metadata(await get(`?service=${world.read.slug}`, bobRead)).totalCount).toBe(14);
  });
});

// 'POST /measurements' is the name the walker looks for.
describe('POST /measurements', () => {
  v1ContractTests(writeMeasurementsV1Route, {
    call,
    get token() {
      return tokens.write!;
    },
    get tokenWithoutScope() {
      return tokens.read!;
    },
    get query() {
      return { service: world.write.slug };
    },
    // The same body twice answers `inserted` and then `unchanged`; the harness checks the status and the schema of each.
    answersDiffer: true,
    body: [{ kpi: 'Contract downloads', value: 5, date: '2026-05' }],
  });

  it('records a batch in the legacy shape and answers the counts: inserted, then updated, then unchanged', async () => {
    const svc = world.write.slug;
    const batch = (n: number) => [
      { kpi: 'contract DOWNLOADS', value: n, date: '2026-01' },
      { kpi: world.share.id, value: '12.5', date: '2026-01-15' },
      { kpi: 'Contract uptime', value: '01-00-00', date: '2026-01-31' },
    ];
    const first = await post(svc, batch(1));
    expect(first.status).toBe(200);
    expect(first.body).toEqual({ inserted: 3, updated: 0, unchanged: 0 });
    const second = await post(svc, batch(2));
    expect(second.body).toEqual({ inserted: 0, updated: 1, unchanged: 2 });
    expect((await post(svc, batch(2))).body).toEqual({ inserted: 0, updated: 0, unchanged: 3 });
    const rows = (await rowsOf(world.write.id)).filter((row) => row.period === '2026-01-31');
    // writing twice is one row per indicator and month
    expect(rows).toHaveLength(3);
    expect(
      rows.every((row) => row.source === 'api' && row.created_by === people.alice.user.id),
    ).toBe(true);
    expect(rows.find((row) => row.indicator_id === world.downloads.id)!.value_numeric).toBe('2');
    expect(rows.find((row) => row.indicator_id === world.uptime.id)!.value_numeric).toBe('3600');
  });

  it('is visible in the next read: the value, its legacy text and the month end', async () => {
    const svc = world.write.slug;
    expect(
      (await post(svc, [{ kpi: 'Contract uptime', value: '10-00-30', date: '2026-02' }])).status,
    ).toBe(200);
    const read = await get(
      `?service=${svc}&indicators=Contract%20uptime&start=2026-02&stop=2026-02`,
    );
    expect(result(read)).toMatchObject([
      { kpi: 'Contract uptime', value: '10-00-30', valueNumber: 36030, date: '2026-02-28' },
    ]);
    expect(
      (await post(svc, [{ kpi: 'Contract uptime', value: '11-00-00', date: '2026-02-10' }])).body,
    ).toEqual({ inserted: 0, updated: 1, unchanged: 0 });
    expect(
      result(
        await get(`?service=${svc}&indicators=Contract%20uptime&start=2026-02&stop=2026-02`),
      )[0]!.value,
    ).toBe('11-00-00');
  });

  it('gives the same rows as a form submission with the same data (compared through the database, not the answer)', async () => {
    // A form-like call goes to `upsertBatch` with the indicator ids, as the page of sprint 4 and the file adapters will.
    const ingestion = started.kernel.services.get('kpi.ingestion') as KpiIngestionPublic;
    const alice = {
      kind: 'user',
      userId: people.alice.user.id,
      username: 'alice-meas',
      roles: [],
      via: 'session',
    } as const;
    const svc = world.write;
    const data = [
      { indicator: world.downloads, value: 77, period: '2025-12' },
      { indicator: world.share, value: 33.5, period: '2025-12-20' },
      { indicator: world.uptime, value: '05-00-00', period: '2025-11' },
      { indicator: world.notes[0]!, value: 'steady', period: '2025-11-03' },
    ];
    const strip = (rows: Awaited<ReturnType<typeof rowsOf>>) =>
      rows
        .filter((row) => ['2025-11-30', '2025-12-31'].includes(row.period))
        .map(({ indicator_id, period, value_numeric, value_text, created_by }) => ({
          indicator_id,
          period,
          value_numeric,
          value_text,
          created_by,
        }));
    expect(
      (
        await post(
          svc.slug,
          data.map((d) => ({ kpi: d.indicator.name, value: d.value, date: d.period })),
        )
      ).body,
    ).toEqual({ inserted: 4, updated: 0, unchanged: 0 });
    const viaApi = strip(await rowsOf(svc.id));
    await started.kernel.pool.query(
      "delete from kpii_measurement where service_id = $1 and period in ('2025-11-30', '2025-12-31')",
      [svc.id],
    );
    const viaForm = await ingestion.measurements.upsertBatch(
      alice,
      svc.id,
      data.map((d) => ({ indicator: d.indicator.id, period: d.period, value: d.value })),
      { source: 'form' },
    );
    expect(viaForm.inserted).toBe(4);
    expect(strip(await rowsOf(svc.id))).toEqual(viaApi);
    expect(viaApi).toHaveLength(4);
  });

  it('is 403 for a token of a member of another provider, of a person who is no member, and for a token without the scoped permission [ASVS-8.2.1] [ASVS-8.3.1]', async () => {
    const body = [{ kpi: 'Contract downloads', value: 1, date: '2026-03' }];
    const before = await countRows(world.write.id);
    for (const [who, token] of [
      ['bob (member of the other provider)', tokens.bobWrite!],
      ['carol (no membership)', tokens.carolWrite!],
      ['alice with the route scope only', tokens.writeOnly!],
      ['alice with the scoped permission only', tokens.submitOnly!],
      ['alice with a read token', tokens.read!],
    ] as const) {
      const reply = await post(world.write.slug, body, token);
      expect(reply.status, who).toBe(403);
      expect(reply.res.headers.get('content-type')).toContain('application/problem+json');
    }
    expect(await countRows(world.write.id)).toBe(before);
    // the member and Admin are let through
    expect((await post(world.write.slug, body, tokens.write!)).status).toBe(200);
    expect((await post(world.write.slug, body, tokens.adminWrite!)).status).toBe(200);
    // and bob writes to the service of his own provider (the body is refused for what it asks, not for the right: that service has the KPI)
    expect((await post(world.elsewhere.slug, body, tokens.bobWrite!)).status).toBe(200);
    // alice is refused there
    expect((await post(world.elsewhere.slug, body, tokens.write!)).status).toBe(403);
  });

  it('is 422 naming `service` for an unknown service, or none, and naming [i].kpi for a KPI the service does not have', async () => {
    const body = [{ kpi: 'Contract downloads', value: 1, date: '2026-03' }];
    const unknown = await post('no-such-service', body);
    expect(unknown.status).toBe(422);
    expect(problemPaths(unknown)).toEqual(['query:service']);
    const missing = await started.call('POST', '/measurements', {
      v1: true,
      headers: bearer(tokens.write!),
      body,
    });
    expect(missing.status).toBe(422);
    expect(problemPaths(missing)).toContain('query:service');

    const before = await countRows(world.write.id);
    const mixed = await post(world.write.slug, [
      { kpi: 'Contract downloads', value: 1, date: '2026-03' },
      { kpi: 'Contract outside', value: 1, date: '2026-03' },
      { kpi: 'Nothing like it', value: 1, date: '2026-03' },
      { kpi: 'Contract downloads', value: -5, date: '2026-04' },
      { kpi: 'Contract downloads', value: 1, date: '2999-01' },
    ]);
    expect(mixed.status).toBe(422);
    expect(problemPaths(mixed)).toEqual([
      'body:[1].kpi',
      'body:[2].kpi',
      'body:[3].value',
      'body:[4].date',
    ]);
    // the whole batch is refused: the first, good item was not written either
    expect(await countRows(world.write.id)).toBe(before);
  });

  it('is 422 for a body that is not an array, an empty one, one over 500 items, an item with an unknown or a missing field or a value of the wrong kind, and an unknown parameter', async () => {
    const svc = world.write.slug;
    const item = { kpi: 'Contract downloads', value: 1, date: '2026-03' };
    const bodies: unknown[] = [
      {},
      { kpi: 'Contract downloads', value: 1, date: '2026-03' },
      'text',
      42,
      null,
      [],
      Array.from({ length: 501 }, () => item),
      [{ ...item, extra: 1 }],
      [{ value: 1, date: '2026-03' }],
      [{ kpi: 'Contract downloads', date: '2026-03' }],
      [{ kpi: 'Contract downloads', value: 1 }],
      [{ ...item, value: true }],
      [{ ...item, value: null }],
      [{ ...item, value: { a: 1 } }],
      [{ ...item, kpi: 7 }],
      [{ ...item, date: 202603 }],
      [item, 'a text'],
    ];
    for (const body of bodies) {
      const reply = await post(svc, body);
      expect(reply.status, JSON.stringify(body).slice(0, 80)).toBe(422);
      expect(reply.res.headers.get('content-type')).toContain('application/problem+json');
    }
    const extraParameter = await started.call('POST', `/measurements?service=${svc}&dry=1`, {
      v1: true,
      headers: bearer(tokens.write!),
      body: [item],
    });
    expect(extraParameter.status).toBe(422);
    // a body that is not JSON
    const text = await started.call('POST', `/measurements?service=${svc}`, {
      v1: true,
      headers: { ...bearer(tokens.write!), 'content-type': 'application/json' },
      body: '[{"kpi":',
    });
    expect(text.status).toBe(422);
  });

  it('names the structural errors of the JSON by position (`0.kpi`) and the others as [i].field', async () => {
    const reply = await post(world.write.slug, [{ kpi: 7, value: 1, date: '2026-03' }]);
    expect(problemPaths(reply)).toEqual(['body:0.kpi']);
  });

  it('refuses a body over the limit with 413 before reading it, and accepts the largest batch the schema allows', async () => {
    const svc = world.write.slug;
    const huge = 'x'.repeat(MAX_API_BODY_BYTES + 1024);
    const refused = await post(svc, [{ kpi: 'Contract note a', value: huge, date: '2026-03' }]);
    expect(refused.status).toBe(413);
    expect(refused.res.headers.get('content-type')).toContain('application/problem+json');
    // 500 items of 4 000 characters are about 2 MB: more than the server-wide 1 MiB, within this route's limit
    const long = 'y'.repeat(4000);
    const items = world.notes.flatMap((note, n) =>
      Array.from({ length: 100 }, (_, m) => ({
        kpi: note.name,
        value: long,
        date: `${2010 + Math.floor(m / 12)}-${String((m % 12) + 1).padStart(2, '0')}-${String(n + 1).padStart(2, '0')}`,
      })),
    );
    expect(items).toHaveLength(500);
    expect(JSON.stringify(items).length).toBeGreaterThan(1024 * 1024);
    expect(JSON.stringify(items).length).toBeLessThan(MAX_API_BODY_BYTES);
    const ok = await post(svc, items);
    expect(ok.status, JSON.stringify(ok.body).slice(0, 300)).toBe(200);
    expect(ok.body).toEqual({ inserted: 500, updated: 0, unchanged: 0 });
  });
});

describe('a session cookie and the CSRF check on POST /measurements', () => {
  const body = [{ kpi: 'Contract downloads', value: 41, date: '2026-04' }];
  const withCookie = (
    who: Person,
    extra: { csrf?: string; headers?: Record<string, string> } = {},
  ) =>
    started.call('POST', `/measurements?service=${world.write.slug}`, {
      v1: true,
      cookie: who.cookie,
      ...(extra.csrf === undefined ? {} : { csrf: extra.csrf }),
      ...(extra.headers ? { headers: extra.headers } : {}),
      body,
    });

  it('[ASVS-7.2.1] refuses a cookie without X-CSRF-Token (401) and with a wrong one, and writes nothing', async () => {
    const before = await countRows(world.write.id);
    const missing = await withCookie(people.alice);
    expect(missing.status).toBe(401);
    expect(missing.res.headers.get('content-type')).toContain('application/problem+json');
    expect((await withCookie(people.alice, { csrf: 'made-up-token' })).status).toBe(401);
    // another person's valid token is no better
    expect((await withCookie(people.alice, { csrf: people.carol.csrf })).status).toBe(401);
    expect(await countRows(world.write.id)).toBe(before);
  });

  it('[ASVS-7.2.1] works with the right token, as the person who is signed in, and not for a person who may not submit', async () => {
    const reply = await withCookie(people.alice, { csrf: people.alice.csrf });
    expect(reply.status).toBe(200);
    expect(reply.body).toMatchObject({ inserted: expect.any(Number) as number });
    const stored = (await rowsOf(world.write.id)).find(
      (row) => row.period === '2026-04-30' && row.indicator_id === world.downloads.id,
    )!;
    expect(stored.created_by).toBe(people.alice.user.id);
    // carol's session and CSRF are right and she may not write to this service
    expect((await withCookie(people.carol, { csrf: people.carol.csrf })).status).toBe(403);
  });

  it('works with a token and a stale cookie and no CSRF header: a request with a token is a token request', async () => {
    const reply = await started.call('POST', `/measurements?service=${world.write.slug}`, {
      v1: true,
      cookie: 'a-stale-session-cookie',
      headers: bearer(tokens.write!),
      body,
    });
    expect(reply.status).toBe(200);
  });

  it('is 401 for a made-up token and works with X-API-Key', async () => {
    const made = await post(world.write.slug, body, 'scp_abcd1234_nonsense');
    expect(made.status).toBe(401);
    const viaKey = await started.call('POST', `/measurements?service=${world.write.slug}`, {
      v1: true,
      headers: { 'x-api-key': tokens.write! },
      body,
    });
    expect(viaKey.status).toBe(200);
  });

  it('is 401 with no credentials', async () => {
    const reply = await started.call('POST', `/measurements?service=${world.write.slug}`, {
      v1: true,
      body,
    });
    expect(reply.status).toBe(401);
  });
});

describe('the preflight for /api/v1/measurements', () => {
  const preflight = (path: string, origin: string, method: string) =>
    started.call('OPTIONS', path, {
      v1: true,
      headers: { origin, 'access-control-request-method': method },
    });

  it('names the methods of that path only: GET, POST and OPTIONS; the other paths do not claim POST', async () => {
    const own = await preflight('/measurements', ORIGIN, 'POST');
    expect(own.status).toBe(204);
    expect(own.res.headers.get('access-control-allow-methods')).toBe('GET, POST, OPTIONS');
    expect(own.res.headers.get('access-control-allow-origin')).toBe(ORIGIN);
    expect(own.res.headers.get('access-control-allow-credentials')).toBeNull();
    expect(own.res.headers.get('access-control-allow-headers')).not.toMatch(/csrf/i);
    for (const path of ['/categories', '/indicators', '/services', '/providers']) {
      const other = await preflight(path, ORIGIN, 'GET');
      expect(other.status, path).toBe(204);
      expect(other.res.headers.get('access-control-allow-methods'), path).toBe('GET, OPTIONS');
    }
  });

  it('refuses an origin that is not allowed (403, no CORS header)', async () => {
    const reply = await preflight('/measurements', 'https://evil.example', 'POST');
    expect(reply.status).toBe(403);
    expect(
      [...reply.res.headers.keys()].filter((key) => key.startsWith('access-control-allow')),
    ).toEqual([]);
  });
});

describe('POST /measurements under the rate limiter', () => {
  it('counts a batch of 500 values as one request: three of them pass a bucket of five, and the sixth request is 429', async () => {
    // A second application with the limiter on and a small default bucket; the first one runs without a limiter.
    const limited = await app.start({
      publicApi: true,
      kpi: true,
      ingestion: { clock: () => NOW },
      rateLimits: {
        default: { capacity: 5, refillPerSecond: 0.001 },
        strict: { capacity: 1000, refillPerSecond: 100 },
      },
    });
    const pool = limited.kernel.pool;
    const dana = await limited.signedIn('dana-meas');
    const provider = await makeOrganisation(pool, { abbreviation: 'Mc3', type: 'provider' });
    await makeMembership(pool, {
      organisationId: provider.id,
      userId: dana.user.id,
      state: 'approved',
      role: 'member',
    });
    const indicators = await Promise.all(
      'abcde'
        .split('')
        .map((letter) => makeIndicator(pool, { name: `Limited ${letter}`, valueType: 'integer' })),
    );
    const set = await makeKpiSet(pool, {
      name: 'Limited set',
      indicators: indicators.map((indicator) => ({
        indicatorId: indicator.id,
        necessity: 'optional',
      })),
    });
    const svc = await makeService(pool, { slug: 'meas-limited', provider: provider.id });
    await makeServiceKpis(pool, { serviceId: svc.id, setId: set.id });
    const created = await limited.post('/tokens', {
      cookie: dana.cookie,
      csrf: dana.csrf,
      body: { name: 'limited', scopes: [WRITE, SUBMIT] },
    });
    const token = (created.body as { token: string }).token;
    const items = indicators.flatMap((indicator, n) =>
      Array.from({ length: 100 }, (_, m) => ({
        kpi: indicator.name,
        value: n * 1000 + m,
        date: `${2000 + Math.floor(m / 12)}-${String((m % 12) + 1).padStart(2, '0')}`,
      })),
    );
    expect(items).toHaveLength(500);
    const send = (body: unknown) =>
      limited.call('POST', `/measurements?service=${svc.slug}`, {
        v1: true,
        headers: bearer(token),
        body,
      });
    const first = await send(items);
    expect(first.status).toBe(200);
    expect(first.body).toEqual({ inserted: 500, updated: 0, unchanged: 0 });
    expect((await send(items)).body).toEqual({ inserted: 0, updated: 0, unchanged: 500 });
    expect(
      (await send(items.map((item) => ({ ...item, value: Number(item.value) + 1 })))).body,
    ).toEqual({
      inserted: 0,
      updated: 500,
      unchanged: 0,
    });
    // 1 500 values went through in three requests; the bucket is spent by requests, not by values
    expect((await send([items[0]])).status).toBe(200);
    expect((await send([items[0]])).status).toBe(200);
    const refused = await send([items[0]]);
    expect(refused.status).toBe(429);
    expect(refused.res.headers.get('retry-after')).toBeTruthy();
  }, 120_000);
});
