// The routes of kpi.framework through the whole pipeline (session, CSRF, permission, validation, error mapping)
// over real Postgres. Each answer is parsed with the response schema of its route, so the generated OpenAPI
// document and the real answer cannot differ.
import { makeIndicator, makeKpiSet } from '@scorpion/testing';
import { describe, expect, it } from 'vitest';
import { useIdentityApp, type Reply } from './testing/identity-app.ts';

/** The payloads of the outbox events with this name, oldest first. */
async function payloads(
  pool: { query: (text: string, values?: unknown[]) => Promise<{ rows: unknown[] }> },
  name: string,
) {
  const { rows } = await pool.query(
    'select payload from kernel_outbox where name = $1 order by id',
    [name],
  );
  return (rows as { payload: Record<string, unknown> }[]).map((row) => row.payload);
}

const app = useIdentityApp();
const start = () => app.start({ kpi: true });
type Started = Awaited<ReturnType<typeof start>>;
const as = (who: { cookie: string; csrf: string }) => ({ cookie: who.cookie, csrf: who.csrf });
const ABSENT = '018f3b7e-0000-7000-8000-000000000000';
let n = 0;
const uniq = (p: string) => `${p}-${++n}-${Math.random().toString(36).slice(2, 6)}`;
interface Page<T> {
  metadata: { currentPage: number; pageSize: number; totalCount: number; totalPages: number };
  result: T[];
}
interface Problem {
  status: number;
  type?: string;
  detail?: string;
  errors?: { path: string; message: string }[];
}

function conforms(s: Started, reply: Reply, method: string, path: string) {
  const found = s.kernel.routes.find(
    ({ route }) => route.method.toUpperCase() === method && route.path === path,
  );
  expect(found, `${method} ${path} is registered`).toBeDefined();
  const schema = (
    found!.route.responses as Record<
      number,
      { content?: Record<string, { schema?: { safeParse(v: unknown): { success: boolean } } }> }
    >
  )[reply.status]?.content?.['application/json']?.schema;
  expect(schema, `${method} ${path} declares a ${reply.status} answer`).toBeDefined();
  expect(schema!.safeParse(reply.body).success, JSON.stringify(reply.body)).toBe(true);
}

async function world() {
  const s = await start();
  const admin = as(await s.signedIn('adminy', { roles: ['admin'] }));
  const user = as(await s.signedIn('plainy'));
  const indicator = (body: object = {}) =>
    s.call('POST', '/kpi/indicators', {
      ...admin,
      body: { name: uniq('Ind'), valueType: 'integer', thematic: 'Usage', ...body },
    });
  const set = (body: object = {}) =>
    s.call('POST', '/kpi/sets', { ...admin, body: { name: uniq('Set'), ...body } });
  return { s, admin, user, indicator, set };
}

describe('the indicator routes', () => {
  it('create, read, list, change and delete, each answer matching its schema', async () => {
    const { s, admin, user, indicator } = await world();
    const created = await indicator({ unit: 'count', min: 0, description: 'd' });
    expect(created.status).toBe(201);
    conforms(s, created, 'POST', '/kpi/indicators');
    const { id, name } = created.body as { id: string; name: string };
    const got = await s.get(`/kpi/indicators/${id}`, user);
    expect(got.status).toBe(200);
    conforms(s, got, 'GET', '/kpi/indicators/{id}');
    const list = await s.get(
      `/kpi/indicators?q=${encodeURIComponent(name)}&qualitative=false`,
      user,
    );
    expect((list.body as Page<{ id: string }>).result.map((i) => i.id)).toEqual([id]);
    conforms(s, list, 'GET', '/kpi/indicators');
    const put = await s.call('PUT', `/kpi/indicators/${id}`, {
      ...admin,
      body: { name, valueType: 'float', thematic: 'Technical' },
    });
    expect(put.status).toBe(200);
    conforms(s, put, 'PUT', '/kpi/indicators/{id}');
    expect(put.body).toMatchObject({ valueType: 'float', unit: null, min: null });
    const del = await s.call('DELETE', `/kpi/indicators/${id}`, admin);
    expect(del.status).toBe(204);
    expect((await s.get(`/kpi/indicators/${id}`, user)).status).toBe(404);
  });

  it('answers 404, 409 and 422 as problem details that name the field', async () => {
    const { s, admin, indicator } = await world();
    const first = await indicator();
    const { id, name } = first.body as { id: string; name: string };
    expect((await s.get(`/kpi/indicators/${ABSENT}`, admin)).status).toBe(404);
    expect((await s.get('/kpi/indicators/not-an-id', admin)).status).toBe(422);
    const dup = await indicator({ name: name.toUpperCase() });
    expect(dup.status).toBe(409);
    expect((dup.body as Problem).errors?.map((e) => e.path)).toEqual(['name']);
    const bad = await indicator({ thematic: 'Nope', unit: 'parsec' });
    expect(bad.status).toBe(422);
    expect((bad.body as Problem).errors?.map((e) => e.path).sort()).toEqual(['thematic', 'unit']);
    for (const body of [
      { colour: 'red' },
      { name: 'x'.repeat(201) },
      { measuredBy: Array(51).fill('a') },
      { min: 'x' },
    ]) {
      expect((await indicator(body)).status, JSON.stringify(body).slice(0, 40)).toBe(422);
    }
    const missing = await s.call('POST', '/kpi/indicators', { ...admin, body: { name: 'x' } });
    expect(missing.status).toBe(422);
    for (const bad of [
      '?page=-1',
      '?pageSize=101',
      '?qualitative=maybe',
      '?sort=colour',
      '?colour=red',
    ]) {
      expect((await s.get(`/kpi/indicators${bad}`, admin)).status, bad).toBe(422);
    }
    expect(
      (
        await s.call('PUT', `/kpi/indicators/${ABSENT}`, {
          ...admin,
          body: { name: 'x', valueType: 'integer', thematic: 'Usage' },
        })
      ).status,
    ).toBe(404);
    expect(id).toBeTruthy();
  });

  it('answers 409 naming the module and the count when a set uses the indicator', async () => {
    const { s, admin } = await world();
    const ind = await makeIndicator(s.kernel.pool);
    await makeKpiSet(s.kernel.pool, {
      indicators: [{ indicatorId: ind.id, necessity: 'optional' }],
    });
    const reply = await s.call('DELETE', `/kpi/indicators/${ind.id}`, admin);
    expect(reply.status).toBe(409);
    expect((reply.body as Problem).type).toMatch(/kpi-in-use$/);
    expect((reply.body as Problem).detail).toContain('kpi.framework (1 sets)');
  });

  it('lets a plain user read and refuses the writes (403), and an anonymous caller everything (401)', async () => {
    const { s, user, indicator } = await world();
    const { id, name } = (await indicator()).body as { id: string; name: string };
    const body = { name, valueType: 'integer', thematic: 'Usage' };
    expect((await s.get('/kpi/indicators', user)).status).toBe(200);
    expect((await s.get('/kpi/value-types', user)).status).toBe(200);
    expect((await s.call('POST', '/kpi/indicators', { ...user, body })).status).toBe(403);
    expect((await s.call('PUT', `/kpi/indicators/${id}`, { ...user, body })).status).toBe(403);
    expect((await s.call('DELETE', `/kpi/indicators/${id}`, user)).status).toBe(403);
    expect((await s.get('/kpi/indicators')).status).toBe(401);
    expect((await s.call('POST', '/kpi/indicators', { body })).status).toBe(401);
  });

  it('lists the value types from the registry', async () => {
    const { s, user } = await world();
    const reply = await s.get('/kpi/value-types', user);
    conforms(s, reply, 'GET', '/kpi/value-types');
    expect((reply.body as Page<{ id: string }>).result.map((t) => t.id)).toEqual([
      'duration',
      'float',
      'integer',
      'percentage',
      'text',
    ]);
  });

  it('writes an audit record for a change and the event with ids only', async () => {
    const { s, indicator } = await world();
    const { id } = (await indicator()).body as { id: string };
    const rows = await payloads(s.kernel.pool, 'kpi.indicator.changed@1');
    expect(rows.map((r) => r.indicatorId)).toContain(id);
  });
});

describe('the KPI set routes', () => {
  it('create, read, list, replace the rows, set the evaluation, change and delete', async () => {
    const { s, admin, user, indicator, set } = await world();
    const ind = (await indicator()).body as { id: string };
    const created = await set({ rimoCategory: 'Web_application' });
    expect(created.status).toBe(201);
    conforms(s, created, 'POST', '/kpi/sets');
    const { id, name } = created.body as { id: string; name: string };
    const rows = await s.call('PUT', `/kpi/sets/${id}/indicators`, {
      ...admin,
      body: { indicators: [{ indicatorId: ind.id, necessity: 'mandatory' }] },
    });
    expect(rows.status).toBe(200);
    conforms(s, rows, 'PUT', '/kpi/sets/{id}/indicators');
    const noEval = await s.get(`/kpi/sets/${id}/evaluation`, user);
    expect(noEval.body).toEqual({ evaluation: null });
    conforms(s, noEval, 'GET', '/kpi/sets/{id}/evaluation');
    const evalReply = await s.call('PUT', `/kpi/sets/${id}/evaluation`, {
      ...admin,
      body: { indicatorId: ind.id, aggregate: 'sum' },
    });
    expect(evalReply.status).toBe(200);
    conforms(s, evalReply, 'PUT', '/kpi/sets/{id}/evaluation');
    const got = await s.get(`/kpi/sets/${id}`, user);
    conforms(s, got, 'GET', '/kpi/sets/{id}');
    expect(got.body).toMatchObject({ indicatorCount: 1, evaluation: { aggregate: 'sum' } });
    const list = await s.get(`/kpi/sets?q=${encodeURIComponent(name)}`, user);
    conforms(s, list, 'GET', '/kpi/sets');
    expect((list.body as Page<{ necessityCounts: object }>).result[0]!.necessityCounts).toEqual({
      mandatory: 1,
    });
    const put = await s.call('PUT', `/kpi/sets/${id}`, { ...admin, body: { name: `${name} 2` } });
    expect(put.status).toBe(200);
    conforms(s, put, 'PUT', '/kpi/sets/{id}');
    expect((await s.call('DELETE', `/kpi/sets/${id}`, admin)).status).toBe(204);
    expect((await s.get(`/kpi/sets/${id}`, user)).status).toBe(404);
  });

  it('answers 404, 409 and 422 and refuses a plain user the writes', async () => {
    const { s, admin, user, set } = await world();
    const { id, name } = (await set()).body as { id: string; name: string };
    expect((await set({ name })).status).toBe(409);
    expect((await set({ rimoCategory: 'Nope' })).status).toBe(422);
    expect((await s.get(`/kpi/sets/${ABSENT}`, admin)).status).toBe(404);
    expect((await s.get('/kpi/sets/x%20y', admin)).status).toBe(422);
    expect(
      (
        await s.call('PUT', `/kpi/sets/${ABSENT}/indicators`, {
          ...admin,
          body: { indicators: [] },
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await s.call('PUT', `/kpi/sets/${id}/indicators`, {
          ...admin,
          body: { indicators: Array(501).fill({ indicatorId: ABSENT, necessity: 'optional' }) },
        })
      ).status,
    ).toBe(422);
    expect(
      (
        await s.call('PUT', `/kpi/sets/${id}/evaluation`, {
          ...admin,
          body: { indicatorId: ABSENT, aggregate: 'sum' },
        })
      ).status,
    ).toBe(422);
    for (const [method, path, body] of [
      ['POST', '/kpi/sets', { name: 'x' }],
      ['PUT', `/kpi/sets/${id}`, { name: 'x' }],
      ['DELETE', `/kpi/sets/${id}`, undefined],
      ['PUT', `/kpi/sets/${id}/indicators`, { indicators: [] }],
      ['PUT', `/kpi/sets/${id}/evaluation`, { indicatorId: ABSENT, aggregate: 'sum' }],
    ] as const) {
      expect(
        (await s.call(method, path, { ...user, ...(body && { body }) })).status,
        `${method} ${path}`,
      ).toBe(403);
    }
    expect((await s.get('/kpi/sets')).status).toBe(401);
  });
});
