// `upsertBatchAsSystem` (ADR-0056 decision 7, M16 sprint 3): the trusted sibling of `upsertBatch` for a job with no person
// behind it. It skips the scoped permission and nothing else: the same upsert on (service, indicator, period) (defect 6), the
// same check against the service's effective KPI set, and the same event with `actorId: null`. Over real Postgres.
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { useKpi } from '../test/harness.ts';
import {
  breakOutbox,
  count,
  ingestionWorld,
  paths,
  payloads,
  rejection,
  stored,
} from '../test/world.ts';

const h = useKpi();
const world = async () => ingestionWorld(await h.start());

describe('upsertBatchAsSystem', () => {
  it('upserts, never inserts: two runs in a month leave one row with the second value', async () => {
    const w = await world();
    const { downloads } = w.ind;
    const first = await w.ingestion.measurements.upsertBatchAsSystem(
      w.svc.id,
      [w.row(downloads, '2026-06', 310)],
      { source: 'bibliometrics' },
    );
    expect(first).toMatchObject({ inserted: 1, updated: 0, unchanged: 0 });
    const second = await w.ingestion.measurements.upsertBatchAsSystem(
      w.svc.id,
      [w.row(downloads, '2026-06-30', 312)],
      { source: 'bibliometrics' },
    );
    expect(second).toMatchObject({ inserted: 0, updated: 1, unchanged: 0 });
    const rows = await stored(w.pool, w.svc.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      period: '2026-06-30',
      value_numeric: '312',
      source: 'bibliometrics',
      created_by: null,
      updated_by: null,
    });
  });

  it('replaces a value a person submitted for the month, on the same row', async () => {
    const w = await world();
    await w.submit([w.row(w.ind.downloads, '2026-06', 5)]);
    await w.ingestion.measurements.upsertBatchAsSystem(
      w.svc.id,
      [w.row(w.ind.downloads, '2026-06', 6)],
      { source: 'bibliometrics' },
    );
    const rows = await stored(w.pool, w.svc.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ value_numeric: '6', source: 'bibliometrics' });
  });

  it('refuses an indicator outside the effective set, as upsertBatch does, and writes nothing', async () => {
    const w = await world();
    for (const indicator of [w.ind.outside.id, randomUUID(), 'not-an-id']) {
      const error = await rejection(
        w.ingestion.measurements.upsertBatchAsSystem(
          w.svc.id,
          [{ indicator, period: '2026-06', value: 1 }],
          { source: 'bibliometrics' },
        ),
      );
      expect(error.status).toBe(422);
      expect(paths(error)).toEqual(['rows[0].indicator']);
      // The same verdict as the scoped write gives a member.
      const scoped = await rejection(w.submit([{ indicator, period: '2026-06', value: 1 }]));
      expect(scoped.status).toBe(422);
      expect(paths(scoped)).toEqual(paths(error));
    }
    expect(await stored(w.pool, w.svc.id)).toEqual([]);
  });

  it('checks the value, the month and the source like upsertBatch', async () => {
    const w = await world();
    const bad = await rejection(
      w.ingestion.measurements.upsertBatchAsSystem(
        w.svc.id,
        [
          w.row(w.ind.downloads, '2026-06', -1),
          w.row(w.ind.share, '2026-07', 50),
          w.row(w.ind.ratio, '2026-06', 'many'),
        ],
        { source: 'bibliometrics' },
      ),
    );
    expect(bad.status).toBe(422);
    expect(paths(bad)).toEqual(['rows[0].value', 'rows[1].period', 'rows[2].value']);
    const source = await rejection(
      w.ingestion.measurements.upsertBatchAsSystem(
        w.svc.id,
        [w.row(w.ind.downloads, '2026-06', 1)],
        { source: 'Not A Source' },
      ),
    );
    expect(paths(source)).toEqual(['source']);
    expect(await stored(w.pool, w.svc.id)).toEqual([]);
  });

  it('answers 404 for an unknown service and 422 for a value that is not an id, never a 500', async () => {
    const w = await world();
    const row = [w.row(w.ind.downloads, '2026-06', 1)];
    expect(
      (
        await rejection(
          w.ingestion.measurements.upsertBatchAsSystem(randomUUID(), row, { source: 'x' }),
        )
      ).status,
    ).toBe(404);
    expect(
      (await rejection(w.ingestion.measurements.upsertBatchAsSystem('nope', row, { source: 'x' })))
        .status,
    ).toBe(422);
  });

  it('emits measurement.recorded@1 with actorId null, once per batch that changed something', async () => {
    const w = await world();
    const before = (await payloads(w.pool, 'measurement.recorded@1')).length;
    await w.ingestion.measurements.upsertBatchAsSystem(
      w.svc.id,
      [w.row(w.ind.downloads, '2026-05', 40)],
      { source: 'bibliometrics' },
    );
    // The same value again changes nothing and sends nothing.
    await w.ingestion.measurements.upsertBatchAsSystem(
      w.svc.id,
      [w.row(w.ind.downloads, '2026-05', 40)],
      { source: 'bibliometrics' },
    );
    const events = (await payloads(w.pool, 'measurement.recorded@1')).slice(before);
    expect(events).toEqual([
      {
        serviceId: w.svc.id,
        runId: null,
        periods: ['2026-05-31'],
        inserted: 1,
        updated: 0,
        actorId: null,
      },
    ]);
  });

  it('rolls back the rows when the event cannot be stored', async () => {
    const w = await world();
    const before = await count(w.pool, 'kpii_measurement');
    const undo = await breakOutbox(w.pool);
    try {
      await expect(
        w.ingestion.measurements.upsertBatchAsSystem(
          w.svc.id,
          [w.row(w.ind.downloads, '2026-04', 1), w.row(w.ind.share, '2026-04', 2)],
          { source: 'bibliometrics' },
        ),
      ).rejects.toThrow();
    } finally {
      await undo();
    }
    expect(await count(w.pool, 'kpii_measurement')).toBe(before);
  });
});
