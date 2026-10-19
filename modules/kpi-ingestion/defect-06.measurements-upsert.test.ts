// Defect 6 of FEATURES §5, measurements (M10 sprint 1): in the old application a submission was an insert only, so sending a
// month again made a second row; the form and the API each had their own code path; and a bad indicator or value could
// become a 500 or a half-written batch. Here, through the service that every writer calls, over real Postgres: the same month
// twice is one row, a duplicate row in a batch is refused, an unknown indicator is a 422 that names its path, and nothing is
// written on a failure. Never weaken or delete it.
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { useKpi } from './test/harness.ts';
import { count, ingestionWorld, paths, payloads, rejection, stored } from './test/world.ts';

const h = useKpi();
const world = async () => ingestionWorld(await h.start());

describe('defect 6: measurements are upserted, never inserted twice', () => {
  it('sending the same month twice is one row, with the second value', async () => {
    const w = await world();
    const { downloads } = w.ind;
    await w.submit([w.row(downloads, '2026-04', 100)]);
    await w.submit([w.row(downloads, '2026-04', 120)]);
    await w.submit([w.row(downloads, '2026-04-17', 130)]); // any day of April is April
    const rows = await stored(w.pool, w.svc.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ period: '2026-04-30', value_numeric: '130' });
    expect(await count(w.pool, 'kpii_measurement')).toBe(1);
  });

  it('refuses a batch that names the same indicator and month twice, instead of letting one of them win', async () => {
    const w = await world();
    const { downloads } = w.ind;
    const error = await rejection(
      w.submit([w.row(downloads, '2026-05', 1), w.row(downloads, '2026-05', 2)]),
    );
    expect(error.status).toBe(422);
    expect(paths(error)).toEqual(['rows[1].period']);
    expect(await count(w.pool, 'kpii_measurement')).toBe(0);
  });

  it('answers an unknown indicator with a 422 that names the row, not a 500', async () => {
    const w = await world();
    for (const indicator of [randomUUID(), 'not-an-id', w.ind.outside.id]) {
      const error = await rejection(
        w.submit([
          w.row(w.ind.downloads, '2026-05', 1),
          { indicator, period: '2026-05', value: 1 },
        ]),
      );
      expect(error.status).toBe(422);
      expect(paths(error)).toEqual(['rows[1].indicator']);
    }
  });

  it('writes nothing on a failure: one bad row keeps the good rows out, and no event is sent', async () => {
    const w = await world();
    const before = await count(w.pool, 'kpii_measurement');
    const error = await rejection(
      w.submit([
        w.row(w.ind.downloads, '2026-01', 1),
        w.row(w.ind.share, '2026-01', 2),
        w.row(w.ind.uptime, '2026-01', 'not a duration'),
      ]),
    );
    expect(error.status).toBe(422);
    expect(await count(w.pool, 'kpii_measurement')).toBe(before);
    expect(await payloads(w.pool, 'measurement.recorded@1')).toEqual([]);
  });

  it('has one write path: the same rows give the same stored values whoever the caller is', async () => {
    // The form, CSV, XLSX and the API will all call upsertBatch; here two people who may submit send the same data.
    const w = await world();
    const rows = [w.row(w.ind.downloads, '2026-02', 7), w.row(w.ind.note, '2026-02', 'same')];
    await w.submit(rows, w.people.member);
    const one = (await stored(w.pool, w.svc.id)).map(
      ({ indicator_id, period, value_numeric, value_text }) => ({
        indicator_id,
        period,
        value_numeric,
        value_text,
      }),
    );
    await w.pool.query('delete from kpii_measurement where service_id = $1', [w.svc.id]);
    await w.submit(rows, w.people.manager);
    const two = (await stored(w.pool, w.svc.id)).map(
      ({ indicator_id, period, value_numeric, value_text }) => ({
        indicator_id,
        period,
        value_numeric,
        value_text,
      }),
    );
    expect(two).toEqual(one);
  });
});
