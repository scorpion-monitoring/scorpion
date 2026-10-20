// The internal routes of kpi.ingestion's adapters through the whole pipeline (M10 sprint 3): preview and run with a file (multipart) and
// with a form (JSON), the runs, the adapters and the import template. Session auth with the CSRF header, the plain permission held by the
// role `user`, and the scoped `kpi.ingestion.measurement.submit` checked in the service: a person of another provider is 403 on every
// route. The body limit gives 413 before the body is read, and every bad input is a 4xx, never a 500.
import { MAX_UPLOAD_BODY_BYTES } from '@scorpion/kpi-ingestion/public';
import {
  makeIndicator,
  makeKpiSet,
  makeMembership,
  makeOrganisation,
  makeService,
  makeServiceKpis,
} from '@scorpion/testing';
import { beforeAll, describe, expect, it } from 'vitest';
import { useIdentityApp } from './testing/identity-app.ts';

const NOW = new Date('2026-06-15T12:00:00Z');
const app = useIdentityApp({ shared: true });
let started: Awaited<ReturnType<typeof app.start>>;
type Person = Awaited<ReturnType<typeof started.signedIn>>;
const people = {} as Record<'alice' | 'bob' | 'carol' | 'admin', Person>;
let service: { id: string; slug: string };
let elsewhere: { id: string };
let downloads: { id: string; name: string };
let share: { id: string; name: string };

beforeAll(async () => {
  started = await app.start({ kpi: true, ingestion: { clock: () => NOW } });
  const pool = started.kernel.pool;
  people.alice = await started.signedIn('alice-ing');
  people.bob = await started.signedIn('bob-ing');
  people.carol = await started.signedIn('carol-ing');
  people.admin = await started.signedIn('admin-ing', { roles: ['admin'] });
  const mine = await makeOrganisation(pool, { type: 'provider' });
  const theirs = await makeOrganisation(pool, { type: 'provider' });
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
  downloads = await makeIndicator(pool, {
    name: 'Ingest downloads',
    valueType: 'integer',
    min: 0,
    max: 1_000_000,
    unit: 'count',
  });
  share = await makeIndicator(pool, { name: 'Ingest share', valueType: 'percentage' });
  const set = await makeKpiSet(pool, {
    indicators: [
      { indicatorId: downloads.id, necessity: 'mandatory' },
      { indicatorId: share.id, necessity: 'recommended' },
    ],
  });
  service = await makeService(pool, { provider: mine.id });
  elsewhere = await makeService(pool, { provider: theirs.id });
  await makeServiceKpis(pool, { serviceId: service.id, setId: set.id });
  await makeServiceKpis(pool, { serviceId: elsewhere.id, setId: set.id });
}, 120_000);

const as = (who: Person) => ({ cookie: who.cookie, csrf: who.csrf });
const sql = async (text: string, values: unknown[] = []) =>
  (await started.kernel.pool.query(text, values)).rows as Record<string, unknown>[];

/** A multipart request body: the fields and one file. */
async function multipart(
  fields: Record<string, string>,
  file?: { name: string; bytes: Uint8Array | string; type?: string },
) {
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) form.set(key, value);
  if (file)
    form.set(
      'file',
      new File([file.bytes as BlobPart], file.name, { type: file.type ?? 'text/csv' }),
    );
  const request = new Request('http://localhost/', { method: 'POST', body: form });
  return {
    body: new Uint8Array(await request.arrayBuffer()),
    headers: { 'content-type': request.headers.get('content-type')! },
  };
}
const upload = async (
  path: string,
  who: Person | undefined,
  fields: Record<string, string>,
  file?: { name: string; bytes: Uint8Array | string },
  extra: { csrf?: boolean } = {},
) => {
  const { body, headers } = await multipart(fields, file);
  return started.post(path, {
    ...(who ? { cookie: who.cookie, ...(extra.csrf === false ? {} : { csrf: who.csrf }) } : {}),
    headers,
    body,
  });
};
const csv = (...lines: string[]) => lines.join('\r\n') + '\r\n';
const GOOD = () => csv(`Period,${downloads.name},${share.name}`, '2026-05,100,50', '2026-04,90,40');
const problemPaths = (body: unknown) =>
  ((body as { errors?: { path: string }[] }).errors ?? []).map((e) => e.path);
const rows = () =>
  sql('select count(*)::int as n from kpii_measurement where service_id = $1', [service.id]).then(
    (r) => (r[0] as { n: number }).n,
  );

describe('POST /kpi/ingestion/preview', () => {
  it('reads a file in memory and answers the header, the rows, the proposed mapping and the problems', async () => {
    const reply = await upload(
      '/kpi/ingestion/preview',
      people.alice,
      { serviceId: service.id },
      { name: 'a.csv', bytes: GOOD() },
    );
    expect(reply.status).toBe(200);
    expect(reply.body).toMatchObject({
      adapter: 'csv',
      header: ['Period', downloads.name, share.name],
      rows: [
        ['2026-05', '100', '50'],
        ['2026-04', '90', '40'],
      ],
      totalRows: 2,
      proposed: true,
      mapping: { '0': 'period', '1': downloads.id, '2': share.id },
      missing: [],
      problems: [],
    });
    expect(await rows()).toBe(0);
    expect(await sql('select count(*)::int as n from kpii_ingestion_run')).toEqual([{ n: 0 }]);
  });

  it('takes a mapping as JSON text, and reads a form given as JSON', async () => {
    const reply = await upload(
      '/kpi/ingestion/preview',
      people.alice,
      { serviceId: service.id, mapping: JSON.stringify({ '0': 'period', '1': downloads.id }) },
      { name: 'b.csv', bytes: csv('when,count', '2026-01,5') },
    );
    expect(reply.body).toMatchObject({
      proposed: false,
      mapping: { '0': 'period', '1': downloads.id },
      problems: [],
    });
    const form = await started.post('/kpi/ingestion/preview', {
      ...as(people.alice),
      body: { serviceId: service.id, form: { period: '2026-01', values: { [downloads.id]: '1' } } },
    });
    expect(form.status).toBe(200);
    expect(form.body).toMatchObject({ adapter: 'form', header: [], totalRows: 1 });
  });
});

describe('POST /kpi/ingestion/runs', () => {
  it('checks with a dry run, records with a commit, and updates the same month on a second one', async () => {
    const dry = await upload(
      '/kpi/ingestion/runs',
      people.alice,
      { serviceId: service.id, dryRun: 'true' },
      { name: 'dry.csv', bytes: GOOD() },
    );
    expect(dry.status).toBe(200);
    expect(dry.body).toMatchObject({ status: 'preview', runId: null, inserted: 4, rejected: 0 });
    expect(await rows()).toBe(0);

    const commit = await upload(
      '/kpi/ingestion/runs',
      people.alice,
      { serviceId: service.id },
      { name: 'Q2.csv', bytes: GOOD() },
    );
    expect(commit.status).toBe(200);
    expect(commit.body).toMatchObject({ status: 'committed', inserted: 4, updated: 0 });
    expect(await rows()).toBe(4);
    const grid = await started.get(
      `/kpi/measurements?service=${service.id}&period=2026-05`,
      as(people.alice),
    );
    expect(
      (
        grid.body as { result: { name: string; measurement: { value: string } | null }[] }
      ).result.find((row) => row.name === downloads.name)?.measurement?.value,
    ).toBe('100');

    const again = await upload(
      '/kpi/ingestion/runs',
      people.alice,
      { serviceId: service.id },
      { name: 'Q2.csv', bytes: csv(`Period,${downloads.name}`, '2026-05,101') },
    );
    expect(again.body).toMatchObject({ status: 'committed', inserted: 0, updated: 1 });
    expect(await rows()).toBe(4);
  });

  it('refuses the whole file with a 422 that names each row and column, and records the refusal', async () => {
    const before = await rows();
    const reply = await upload(
      '/kpi/ingestion/runs',
      people.alice,
      { serviceId: service.id },
      {
        name: 'bad.csv',
        bytes: csv(`Period,${downloads.name}`, '2026-03,1', '2026-02,abc', '2026-01,-5'),
      },
    );
    expect(reply.status).toBe(422);
    expect(problemPaths(reply.body)).toEqual(['rows[3].columns[2]', 'rows[4].columns[2]']);
    expect(JSON.stringify(reply.body)).toMatch(/run [0-9a-f-]{36}/);
    expect(await rows()).toBe(before);
    const runs = await started.get(`/kpi/ingestion/runs?service=${service.id}`, as(people.alice));
    expect(runs.status).toBe(200);
    const latest = (
      runs.body as {
        result: { status: string; fileName: string; rejected: number; problems: unknown[] }[];
      }
    ).result[0]!;
    expect(latest).toMatchObject({ status: 'rejected', fileName: 'bad.csv', rejected: 2 });
    expect(latest.problems).toHaveLength(2);
  });

  it('records a form as JSON', async () => {
    const reply = await started.post('/kpi/ingestion/runs', {
      ...as(people.alice),
      body: {
        serviceId: service.id,
        form: { period: '2026-02', values: { [downloads.id]: '7', [share.id]: '' } },
      },
    });
    expect(reply.status).toBe(200);
    expect(reply.body).toMatchObject({ status: 'committed', adapter: 'form', inserted: 1 });
  });

  it('needs the CSRF header on a cookie, and writes nothing without it [ASVS-7.2.1]', async () => {
    const before = await rows();
    const reply = await upload(
      '/kpi/ingestion/runs',
      people.alice,
      { serviceId: service.id },
      { name: 'x.csv', bytes: csv(`Period,${downloads.name}`, '2025-12,1') },
      { csrf: false },
    );
    expect(reply.status).toBe(401);
    expect(await rows()).toBe(before);
  });
});

describe('who may use the routes [ASVS-8.2.1] [ASVS-8.3.1]', () => {
  const file = { name: 'x.csv', bytes: '' };
  it('answers 401 without a session and 403 for a person of another provider, a person with no provider, on every route', async () => {
    const good = { name: 'x.csv', bytes: csv(`Period,${downloads.name}`, '2025-11,1') };
    const before = await rows();
    for (const [who, status] of [
      [undefined, 401],
      [people.bob, 403],
      [people.carol, 403],
    ] as const) {
      for (const path of ['/kpi/ingestion/preview', '/kpi/ingestion/runs']) {
        const reply = await upload(path, who, { serviceId: service.id }, good);
        expect(reply.status, `${who ? 'a person' : 'anonymous'} ${path}`).toBe(status);
      }
      const dry = await upload(
        '/kpi/ingestion/runs',
        who,
        { serviceId: service.id, dryRun: 'true' },
        good,
      );
      expect(dry.status).toBe(status);
      const form = await started.post('/kpi/ingestion/runs', {
        ...(who ? as(who) : {}),
        body: {
          serviceId: service.id,
          form: { period: '2025-11', values: { [downloads.id]: '1' } },
        },
      });
      expect(form.status).toBe(status);
      for (const path of [
        `/kpi/ingestion/runs?service=${service.id}`,
        `/kpi/ingestion/template?service=${service.id}&format=csv`,
        `/kpi/ingestion/template?service=${service.id}&format=xlsx`,
      ])
        expect((await started.get(path, who ? as(who) : {})).status, path).toBe(status);
    }
    expect(await rows()).toBe(before);
    void file;
  });

  it('is per service: a member of one provider is 403 on the other provider’s service, and one run is read by its service’s people only', async () => {
    const mine = await upload(
      '/kpi/ingestion/runs',
      people.bob,
      { serviceId: elsewhere.id },
      { name: 'b.csv', bytes: csv(`Period,${downloads.name}`, '2026-05,3') },
    );
    expect(mine.status).toBe(200);
    const crossed = await upload(
      '/kpi/ingestion/runs',
      people.alice,
      { serviceId: elsewhere.id },
      { name: 'a.csv', bytes: csv(`Period,${downloads.name}`, '2026-05,3') },
    );
    expect(crossed.status).toBe(403);
    const runId = (mine.body as { runId: string }).runId;
    expect((await started.get(`/kpi/ingestion/runs/${runId}`, as(people.bob))).status).toBe(200);
    expect((await started.get(`/kpi/ingestion/runs/${runId}`, as(people.alice))).status).toBe(403);
    expect((await started.get(`/kpi/ingestion/runs/${runId}`, as(people.admin))).status).toBe(200);
    expect(
      (
        await started.get(
          `/kpi/ingestion/runs/018f3b7e-0000-7000-8000-000000000000`,
          as(people.admin),
        )
      ).status,
    ).toBe(404);
  });
});

describe('the limits and bad input', () => {
  it('refuses a body over the limit with 413 before reading it, and a file over 2 MiB inside the limit with 422', async () => {
    const huge = await upload(
      '/kpi/ingestion/runs',
      people.alice,
      { serviceId: service.id },
      { name: 'h.csv', bytes: new Uint8Array(MAX_UPLOAD_BODY_BYTES + 1024).fill(97) },
    );
    expect(huge.status).toBe(413);
    const big = await upload(
      '/kpi/ingestion/runs',
      people.alice,
      { serviceId: service.id },
      { name: 'h.csv', bytes: new Uint8Array(2 * 1024 * 1024 + 1).fill(97) },
    );
    expect(big.status).toBe(422);
    expect(problemPaths(big.body)).toEqual(['file']);
  });

  it('answers 4xx and never 500 for the wrong shapes', async () => {
    const ok = { name: 'x.csv', bytes: csv(`Period,${downloads.name}`, '2025-10,1') };
    const cases: [string, () => Promise<{ status: number }>][] = [
      ['no file', () => upload('/kpi/ingestion/runs', people.alice, { serviceId: service.id })],
      [
        'a service that is not an id',
        () => upload('/kpi/ingestion/runs', people.alice, { serviceId: 'nope' }, ok),
      ],
      [
        'an unknown service',
        () =>
          upload(
            '/kpi/ingestion/runs',
            people.admin,
            { serviceId: '018f3b7e-0000-7000-8000-000000000000' },
            ok,
          ),
      ],
      [
        'an unknown adapter',
        () =>
          upload(
            '/kpi/ingestion/runs',
            people.alice,
            { serviceId: service.id, adapter: 'nope' },
            ok,
          ),
      ],
      [
        'a mapping that is not JSON',
        () =>
          upload(
            '/kpi/ingestion/runs',
            people.alice,
            { serviceId: service.id, mapping: '{nope' },
            ok,
          ),
      ],
      [
        'a mapping that is a list',
        () =>
          upload(
            '/kpi/ingestion/runs',
            people.alice,
            { serviceId: service.id, mapping: '[1]' },
            ok,
          ),
      ],
      [
        'a mapping with a bad target',
        () =>
          upload(
            '/kpi/ingestion/runs',
            people.alice,
            { serviceId: service.id, mapping: '{"0":"x"}' },
            ok,
          ),
      ],
      [
        'an empty file',
        () =>
          upload(
            '/kpi/ingestion/runs',
            people.alice,
            { serviceId: service.id },
            { name: 'e.csv', bytes: '' },
          ),
      ],
      [
        'a file of binary',
        () =>
          upload(
            '/kpi/ingestion/runs',
            people.alice,
            { serviceId: service.id },
            { name: 'p.png', bytes: new Uint8Array([0x89, 0x50, 0, 0, 1]) },
          ),
      ],
      [
        'a form with no values',
        () =>
          started.post('/kpi/ingestion/runs', {
            ...as(people.alice),
            body: { serviceId: service.id, form: { period: '2026-01', values: {} } },
          }),
      ],
      [
        'a form with a number as a value',
        () =>
          started.post('/kpi/ingestion/runs', {
            ...as(people.alice),
            body: {
              serviceId: service.id,
              form: { period: '2026-01', values: { [downloads.id]: 5 } },
            },
          }),
      ],
      [
        'a body that is not an object',
        () => started.post('/kpi/ingestion/runs', { ...as(people.alice), body: [] }),
      ],
      [
        'an unknown key',
        () =>
          started.post('/kpi/ingestion/runs', {
            ...as(people.alice),
            body: {
              serviceId: service.id,
              form: { period: '2026-01', values: { [downloads.id]: '1' } },
              extra: 1,
            },
          }),
      ],
      [
        'text/plain',
        () =>
          started.post('/kpi/ingestion/runs', {
            ...as(people.alice),
            headers: { 'content-type': 'text/plain' },
            body: 'hello',
          }),
      ],
      [
        'a multipart body that is cut',
        () =>
          started.post('/kpi/ingestion/runs', {
            ...as(people.alice),
            headers: { 'content-type': 'multipart/form-data; boundary=x' },
            body: new Uint8Array(Buffer.from('--x\r\nContent-Disposition: form-data; name="file"')),
          }),
      ],
      [
        'a template of an unknown format',
        () =>
          started.get(`/kpi/ingestion/template?service=${service.id}&format=pdf`, as(people.alice)),
      ],
    ];
    for (const [what, call] of cases) {
      const reply = await call();
      expect(reply.status, what).toBeGreaterThanOrEqual(400);
      expect(reply.status, what).toBeLessThan(500);
    }
  });
});

describe('GET /kpi/ingestion/template and /adapters', () => {
  it('answers the CSV template as an attachment with a byte order mark and the XLSX as a workbook', async () => {
    const csvReply = await started.get(
      `/kpi/ingestion/template?service=${service.id}&format=csv`,
      as(people.alice),
    );
    expect(csvReply.status).toBe(200);
    expect(csvReply.res.headers.get('content-type')).toBe('text/csv; charset=utf-8');
    expect(csvReply.res.headers.get('content-disposition')).toBe(
      `attachment; filename="${service.slug}-import-template.csv"`,
    );
    expect(csvReply.res.headers.get('x-content-type-options')).toBe('nosniff');
    expect([...csvReply.bytes.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    expect(csvReply.bytes.toString('utf8')).toContain(
      `Period,${downloads.name} (count) *,${share.name}`,
    );
    const xlsxReply = await started.get(
      `/kpi/ingestion/template?service=${service.id}&format=xlsx`,
      as(people.alice),
    );
    expect(xlsxReply.res.headers.get('content-type')).toBe(
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    expect([...xlsxReply.bytes.subarray(0, 2)]).toEqual([0x50, 0x4b]);
  });

  it('lists the adapters of the registry', async () => {
    const reply = await started.get('/kpi/ingestion/adapters', as(people.alice));
    expect(reply.status).toBe(200);
    expect(
      (reply.body as { result: { id: string }[] }).result.map((adapter) => adapter.id).sort(),
    ).toEqual(['csv', 'form', 'xlsx']);
    expect((await started.get('/kpi/ingestion/adapters')).status).toBe(401);
  });
});
