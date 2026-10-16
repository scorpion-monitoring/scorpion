// Defect 14 of FEATURES §5, KPI part (M9 sprint 2): the old application wrote a KPI category's indicators one
// by one, so a failing second row left the first behind; accepted a necessity of '' and of any other text; and
// built paths from names, so a name with a space or a percent sign could not be reached. Here a set write is
// atomic, a necessity is always an active term of the vocabulary, and a set and an indicator are addressed by
// id, so what their names hold never matters in a path.
import { makeIndicator } from '@scorpion/testing';
import { describe, expect, it } from 'vitest';
import { useIdentityApp } from './testing/identity-app.ts';

const app = useIdentityApp();
const as = (who: { cookie: string; csrf: string }) => ({ cookie: who.cookie, csrf: who.csrf });
let n = 0;
const uniq = (p: string) => `${p}-${++n}-${Math.random().toString(36).slice(2, 6)}`;
interface Problem {
  status: number;
  errors?: { path: string; message: string }[];
}

async function world() {
  const s = await app.start({ kpi: true });
  const admin = as(await s.signedIn('adminy', { roles: ['admin'] }));
  const pool = s.kernel.pool;
  const set = (await s.call('POST', '/kpi/sets', { ...admin, body: { name: uniq('d14') } }))
    .body as { id: string };
  const rows = async () =>
    (
      await pool.query<{ indicator_id: string; necessity: string }>(
        'select indicator_id, necessity from kpif_kpi_set_indicator where set_id = $1',
        [set.id],
      )
    ).rows;
  return { s, admin, pool, set, rows };
}

describe('defect 14: a KPI set is written atomically and its necessity is always a term', () => {
  it('leaves no first row when a later part of the write fails (the event cannot be stored)', async () => {
    const { s, admin, pool, set, rows } = await world();
    const [a, b] = await Promise.all([makeIndicator(pool), makeIndicator(pool)]);
    await pool.query(`
      create or replace function test_break_outbox() returns trigger as $$
      begin raise exception 'outbox is broken for this test'; end $$ language plpgsql;
      create trigger test_break_outbox before insert on kernel_outbox
        for each row execute function test_break_outbox();`);
    const failed = await s.call('PUT', `/kpi/sets/${set.id}/indicators`, {
      ...admin,
      body: {
        indicators: [
          { indicatorId: a.id, necessity: 'mandatory' },
          { indicatorId: b.id, necessity: 'optional' },
        ],
      },
    });
    await pool.query('drop trigger test_break_outbox on kernel_outbox');
    expect(failed.status).toBeGreaterThanOrEqual(500);
    expect(await rows()).toEqual([]);
    const ok = await s.call('PUT', `/kpi/sets/${set.id}/indicators`, {
      ...admin,
      body: {
        indicators: [
          { indicatorId: a.id, necessity: 'mandatory' },
          { indicatorId: b.id, necessity: 'optional' },
        ],
      },
    });
    expect(ok.status).toBe(200);
    expect(await rows()).toHaveLength(2);
  });

  it('answers 422 naming the row for a necessity of the empty string and of an unknown term, and writes nothing', async () => {
    const { s, admin, pool, set, rows } = await world();
    const [a, b] = await Promise.all([makeIndicator(pool), makeIndicator(pool)]);
    for (const necessity of ['', ' ', 'sometimes', 'MANDATORY']) {
      const reply = await s.call('PUT', `/kpi/sets/${set.id}/indicators`, {
        ...admin,
        body: {
          indicators: [
            { indicatorId: a.id, necessity: 'optional' },
            { indicatorId: b.id, necessity },
          ],
        },
      });
      expect(reply.status, JSON.stringify(necessity)).toBe(422);
      expect((reply.body as Problem).errors?.map((e) => e.path)).toContain(
        'indicators[1].necessity',
      );
    }
    expect(await rows()).toEqual([]);
  });

  it('answers 422, never 500, for an unknown indicator in the list', async () => {
    const { s, admin, set } = await world();
    const reply = await s.call('PUT', `/kpi/sets/${set.id}/indicators`, {
      ...admin,
      body: {
        indicators: [
          { indicatorId: '018f3b7e-0000-7000-8000-000000000000', necessity: 'optional' },
        ],
      },
    });
    expect(reply.status).toBe(422);
  });

  it('reaches a set and an indicator whose names hold a space, a percent sign and a slash, because the id is in the path', async () => {
    const { s, admin } = await world();
    const name = `Tricky ${uniq('n')} 100% / a b?`;
    const set = (await s.call('POST', '/kpi/sets', { ...admin, body: { name } })).body as {
      id: string;
      name: string;
      slug: string;
    };
    const ind = (
      await s.call('POST', '/kpi/indicators', {
        ...admin,
        body: { name, valueType: 'integer', thematic: 'Usage' },
      })
    ).body as { id: string; slug: string };
    expect(set.name).toBe(name);
    expect(set.slug).toMatch(/^[A-Za-z0-9][A-Za-z0-9._-]*$/);
    expect(ind.slug).toMatch(/^[A-Za-z0-9][A-Za-z0-9._-]*$/);
    const put = await s.call('PUT', `/kpi/sets/${set.id}/indicators`, {
      ...admin,
      body: { indicators: [{ indicatorId: ind.id, necessity: 'mandatory' }] },
    });
    expect(put.status).toBe(200);
    expect((await s.get(`/kpi/sets/${set.id}`, admin)).status).toBe(200);
    expect((await s.get(`/kpi/indicators/${ind.id}`, admin)).status).toBe(200);
    // The name as a path segment is an unknown id, never a lookup by name.
    expect((await s.get(`/kpi/sets/${encodeURIComponent(name)}`, admin)).status).toBe(422);
    expect((await s.call('DELETE', `/kpi/sets/${encodeURIComponent(name)}`, admin)).status).toBe(
      422,
    );
    expect((await s.call('DELETE', `/kpi/sets/${set.id}`, admin)).status).toBe(204);
  });
});
