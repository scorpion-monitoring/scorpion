// The registry `kpi.indicatorUsage` (M10 sprint 1): a module that keeps rows about an indicator contributes how many, and the
// delete of an indicator is 409 naming each module and the count, never a database error. The real contributor, `kpi.ingestion`,
// has its own test with real measurements; here a fixture module stands in for it. Real Postgres.
import { makeIndicator, makeKpiSet } from '@scorpion/testing';
import { describe, expect, it } from 'vitest';
import { fixtureContributor, useKpi } from '../test/harness.ts';
import { rejection, world } from '../test/world.ts';

const h = useKpi();

const entry = (
  module: string,
  counts: Map<string, number>,
  what = 'measurements',
  onCount?: (id: string) => Promise<void>,
) => ({
  module,
  what,
  count: async (id: string) => {
    await onCount?.(id);
    return counts.get(id) ?? 0;
  },
});
const contributor = (...entries: ReturnType<typeof entry>[]) =>
  fixtureContributor({ contributes: { 'kpi.indicatorUsage': entries } });

describe('the usage registry of an indicator', () => {
  it('answers 409 naming the module and the count when a contributor holds rows, and keeps the indicator', async () => {
    const counts = new Map<string, number>();
    const w = await world(await h.start({ extra: [contributor(entry('fixture.rows', counts))] }));
    const ind = await makeIndicator(w.pool);
    counts.set(ind.id, 3);
    const blocked = await rejection(w.kpi.indicators.delete(w.admin, ind.id));
    expect(blocked.status).toBe(409);
    expect(blocked.type).toBe('kpi-in-use');
    expect(blocked.message).toContain('fixture.rows (3 measurements)');
    expect(blocked.errors).toEqual([
      { in: 'usage', path: 'fixture.rows.measurements', message: '3' },
    ]);
    expect((await w.kpi.indicators.get(w.admin, ind.id)).id).toBe(ind.id);
  });

  it('deletes an indicator that no contributor uses, and asks again at every delete', async () => {
    const counts = new Map<string, number>();
    const w = await world(await h.start({ extra: [contributor(entry('fixture.rows', counts))] }));
    const ind = await makeIndicator(w.pool);
    counts.set(ind.id, 1);
    expect((await rejection(w.kpi.indicators.delete(w.admin, ind.id))).status).toBe(409);
    counts.delete(ind.id);
    await w.kpi.indicators.delete(w.admin, ind.id);
    expect((await rejection(w.kpi.indicators.get(w.admin, ind.id))).status).toBe(404);
  });

  it('names every user together: the framework’s own sets, then each contributor', async () => {
    const one = new Map<string, number>();
    const two = new Map<string, number>();
    const w = await world(
      await h.start({
        extra: [contributor(entry('fixture.one', one), entry('fixture.two', two, 'values'))],
      }),
    );
    const ind = await makeIndicator(w.pool);
    await makeKpiSet(w.pool, { indicators: [{ indicatorId: ind.id, necessity: 'optional' }] });
    one.set(ind.id, 2);
    two.set(ind.id, 7);
    const blocked = await rejection(w.kpi.indicators.delete(w.admin, ind.id));
    expect(blocked.errors).toEqual([
      { in: 'usage', path: 'kpi.framework.sets', message: '1' },
      { in: 'usage', path: 'fixture.one.measurements', message: '2' },
      { in: 'usage', path: 'fixture.two.values', message: '7' },
    ]);
  });

  it('answers 409, not 500, when the key of some table refuses the delete: the key is the last guard', async () => {
    // The row lock of the delete makes a row appear between the question and the delete impossible for a real foreign key
    // (a writer waits for the lock and fails after the commit, on its side). What stays is a key that refuses anyway:
    // here a trigger raises the same error a `restrict` key raises.
    const w = await world(await h.start());
    const ind = await makeIndicator(w.pool);
    await w.pool.query(`
      create or replace function test_refuse_delete() returns trigger as $$
      begin raise exception 'still referenced' using errcode = 'foreign_key_violation'; end $$ language plpgsql;
      create trigger test_refuse_delete before delete on kpif_indicator
        for each row execute function test_refuse_delete();`);
    try {
      const blocked = await rejection(w.kpi.indicators.delete(w.admin, ind.id));
      expect(blocked.status).toBe(409);
    } finally {
      await w.pool.query('drop trigger test_refuse_delete on kpif_indicator');
    }
    expect((await w.kpi.indicators.get(w.admin, ind.id)).id).toBe(ind.id);
  });

  it('does not delete anything when a contributor fails, and the denied and unknown cases are unchanged', async () => {
    const broken = {
      module: 'fixture.broken',
      what: 'rows',
      count: () => Promise.reject(new Error('the contributor is down')),
    };
    const w = await world(
      await h.start({
        extra: [fixtureContributor({ contributes: { 'kpi.indicatorUsage': [broken] } })],
      }),
    );
    const ind = await makeIndicator(w.pool);
    await expect(w.kpi.indicators.delete(w.admin, ind.id)).rejects.toThrow(
      'the contributor is down',
    );
    expect((await w.kpi.indicators.get(w.admin, ind.id)).id).toBe(ind.id);
    expect((await rejection(w.kpi.indicators.delete(w.plain, ind.id))).status).toBe(403);
  });

  it('refuses an entry that is not a module, a noun and a function when the profile starts', async () => {
    const bad = fixtureContributor({
      contributes: { 'kpi.indicatorUsage': [{ module: 'fixture.bad', what: 'rows' }] },
    });
    await expect(h.build({ extra: [bad] })).rejects.toThrow(
      /kpi\.indicatorUsage.*expected a function/,
    );
  });
});
