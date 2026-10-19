// The in-use hook with the real contributor (plan §5 item 8): kpi.ingestion tells kpi.framework how many measurements an
// indicator has, and the delete of the indicator is 409 naming this module and the count; without one it works. The
// restrict key of `kpii_measurement` is the last guard (db/constraints.test.ts proves it refuses a delete too).
import { makeIndicator } from '@scorpion/testing';
import { describe, expect, it } from 'vitest';
import { useKpi } from '../test/harness.ts';
import { ingestionWorld, rejection, stored } from '../test/world.ts';

const h = useKpi();

describe('the delete of an indicator that has measurements', () => {
  it('is 409 naming kpi.ingestion and the count, and keeps the indicator and its measurements', async () => {
    const w = await ingestionWorld(await h.start());
    // `outside` belongs to no set, so only the measurements stand in the way of its delete: give it some through the factory
    // (a service may report only KPIs it has, so a measurement of an indicator it dropped is the case this hook is for)
    await w.submit([
      w.row(w.ind.ratio, '2026-01', 1),
      w.row(w.ind.ratio, '2026-02', 2),
      w.row(w.ind.ratio, '2026-03', 3),
    ]);
    await w.pool.query('delete from kpif_service_extra_indicator where indicator_id = $1', [
      w.ind.ratio.id,
    ]);
    const blocked = await rejection(w.kpi.indicators.delete(w.people.admin, w.ind.ratio.id));
    expect(blocked.status).toBe(409);
    expect(blocked.type).toBe('kpi-in-use');
    expect(blocked.message).toContain('kpi.ingestion (3 measurements)');
    expect(blocked.errors).toEqual([
      { in: 'usage', path: 'kpi.ingestion.measurements', message: '3' },
    ]);
    expect((await w.kpi.indicators.get(w.people.admin, w.ind.ratio.id)).id).toBe(w.ind.ratio.id);
    expect(await stored(w.pool, w.svc.id)).toHaveLength(3);
  });

  it('counts the measurements of every service, and names them together with the sets that use the indicator', async () => {
    const w = await ingestionWorld(await h.start());
    // downloads is a row of the set (1 set) and has measurements of this service
    await w.submit([w.row(w.ind.downloads, '2026-01', 1), w.row(w.ind.downloads, '2026-02', 2)]);
    const blocked = await rejection(w.kpi.indicators.delete(w.people.admin, w.ind.downloads.id));
    expect(blocked.status).toBe(409);
    expect(blocked.errors).toEqual([
      { in: 'usage', path: 'kpi.framework.sets', message: '1' },
      { in: 'usage', path: 'kpi.ingestion.measurements', message: '2' },
    ]);
  });

  it('works once there is none: an indicator that nothing uses is deleted, and the measurements of another indicator do not matter', async () => {
    const w = await ingestionWorld(await h.start());
    await w.submit([w.row(w.ind.downloads, '2026-01', 1)]);
    const spare = await makeIndicator(w.pool);
    await w.kpi.indicators.delete(w.people.admin, spare.id);
    expect((await rejection(w.kpi.indicators.get(w.people.admin, spare.id))).status).toBe(404);
    // the delete of an indicator whose measurements were removed works too
    await w.submit([w.row(w.ind.ratio, '2026-01', 1)]);
    await w.pool.query('delete from kpif_service_extra_indicator where indicator_id = $1', [
      w.ind.ratio.id,
    ]);
    expect((await rejection(w.kpi.indicators.delete(w.people.admin, w.ind.ratio.id))).status).toBe(
      409,
    );
    await w.pool.query('delete from kpii_measurement where indicator_id = $1', [w.ind.ratio.id]);
    await w.kpi.indicators.delete(w.people.admin, w.ind.ratio.id);
    expect((await rejection(w.kpi.indicators.get(w.people.admin, w.ind.ratio.id))).status).toBe(
      404,
    );
  });

  it('is still a 403 for a plain user, whatever the count', async () => {
    const w = await ingestionWorld(await h.start());
    await w.submit([w.row(w.ind.downloads, '2026-01', 1)]);
    expect(
      (await rejection(w.kpi.indicators.delete(w.people.plain, w.ind.downloads.id))).status,
    ).toBe(403);
  });
});
