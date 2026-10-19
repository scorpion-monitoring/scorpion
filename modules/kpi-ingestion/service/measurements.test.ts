// upsertBatch against real Postgres (plan §5 item 5): the same month twice is an update and never a second row, an unchanged
// value is counted as unchanged and emits nothing, a dry run writes nothing and says what would happen, every bad row is a
// 422 that names its path (never a 500) and writes nothing, and a batch is all or nothing. Who may call is in access.test.ts.
import { randomUUID } from 'node:crypto';
import {
  makeIndicator,
  makeKpiSet,
  makeOrganisation,
  makeService,
  makeServiceKpis,
} from '@scorpion/testing';
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
  uniq,
} from '../test/world.ts';
import { MAX_BATCH_MONTHS, MAX_BATCH_ROWS, MAX_PROBLEMS } from './measurements.ts';

const h = useKpi();
const world = async () => ingestionWorld(await h.start());
const EVENT = 'measurement.recorded@1';

describe('upsertBatch writes', () => {
  it('inserts each value in its canonical form, at the last day of its month, with its source and its author', async () => {
    const w = await world();
    const { downloads, share, uptime, note, ratio } = w.ind;
    const result = await w.submit([
      w.row(downloads, '2026-01', 42),
      w.row(share, '2026-01-15', '12.5'),
      w.row(uptime, '2026-02', '01-02-03'),
      w.row(note, '2024-02-10', 'fine'),
      w.row(ratio, '2026-05', 0.1),
    ]);
    expect(result).toMatchObject({ inserted: 5, updated: 0, unchanged: 0, rejected: 0 });
    expect(result.rows.map((row) => [row.index, row.verdict])).toEqual([
      [0, 'insert'],
      [1, 'insert'],
      [2, 'insert'],
      [3, 'insert'],
      [4, 'insert'],
    ]);
    const rows = await stored(w.pool, w.svc.id);
    const of = (id: string) => rows.find((row) => row.indicator_id === id)!;
    expect(of(downloads.id)).toMatchObject({
      period: '2026-01-31',
      value_numeric: '42',
      value_text: null,
    });
    expect(of(share.id)).toMatchObject({ period: '2026-01-31', value_numeric: '12.5' });
    // a duration is stored as seconds: 1 h 2 min 3 s
    expect(of(uptime.id)).toMatchObject({ period: '2026-02-28', value_numeric: String(3723) });
    expect(of(note.id)).toMatchObject({
      period: '2024-02-29',
      value_numeric: null,
      value_text: 'fine',
    });
    expect(of(ratio.id)).toMatchObject({ period: '2026-05-31', value_numeric: '0.1' });
    for (const row of rows)
      expect(row).toMatchObject({
        source: 'test',
        run_id: null,
        created_by: w.people.member.userId,
        updated_by: w.people.member.userId,
      });
  });

  it('the same month twice updates the row and never adds one; any day of the month is the same month', async () => {
    const w = await world();
    const { downloads } = w.ind;
    await w.submit([w.row(downloads, '2026-03', 10)]);
    const [first] = await stored(w.pool, w.svc.id);
    const again = await w.submit([w.row(downloads, '2026-03-05', 11)], w.people.manager);
    expect(again).toMatchObject({ inserted: 0, updated: 1, unchanged: 0 });
    expect(again.rows[0]!.verdict).toBe('update');
    const rows = await stored(w.pool, w.svc.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ period: '2026-03-31', value_numeric: '11' });
    // created stays, updated moves: who changed it last and when
    expect(rows[0]!.created_by).toBe(w.people.member.userId);
    expect(rows[0]!.updated_by).toBe(w.people.manager.userId);
    expect(rows[0]!.created_at).toEqual(first!.created_at);
    expect(rows[0]!.updated_at.getTime()).toBeGreaterThan(first!.updated_at.getTime());
    expect(await count(w.pool, 'kpii_measurement')).toBe(1);
  });

  it('counts an unchanged value as unchanged, touches nothing, and emits no event', async () => {
    const w = await world();
    const { downloads, note } = w.ind;
    await w.submit([w.row(downloads, '2026-03', 10), w.row(note, '2026-03', 'ok')]);
    const before = await stored(w.pool, w.svc.id);
    const events = (await payloads(w.pool, EVENT)).length;
    // the same numbers written differently are the same values
    const result = await w.submit([
      w.row(downloads, '2026-03-31', '10'),
      w.row(note, '2026-03', ' ok '),
    ]);
    expect(result).toMatchObject({ inserted: 0, updated: 0, unchanged: 2 });
    expect(await stored(w.pool, w.svc.id)).toEqual(before);
    expect(await payloads(w.pool, EVENT)).toHaveLength(events);
  });

  it('answers a mixed batch with a verdict for every row and one event naming only the months that changed', async () => {
    const w = await world();
    const { downloads, share } = w.ind;
    await w.submit([w.row(downloads, '2026-01', 1), w.row(downloads, '2026-02', 2)]);
    const result = await w.submit(
      [
        w.row(downloads, '2026-01', 1), // unchanged
        w.row(downloads, '2026-02', 20), // update
        w.row(share, '2026-04', 50), // insert
        w.row(downloads, '2026-03', 3), // insert
      ],
      w.people.manager,
    );
    expect(result).toMatchObject({ inserted: 2, updated: 1, unchanged: 1, rejected: 0 });
    expect(result.rows.map((row) => row.verdict)).toEqual([
      'unchanged',
      'update',
      'insert',
      'insert',
    ]);
    expect((await payloads(w.pool, EVENT)).at(-1)).toEqual({
      serviceId: w.svc.id,
      runId: null,
      periods: ['2026-02-28', '2026-03-31', '2026-04-30'],
      inserted: 2,
      updated: 1,
      actorId: w.people.manager.userId,
    });
  });

  it('emits one event per batch that changed something, and none for a batch that changed nothing', async () => {
    const w = await world();
    const { downloads } = w.ind;
    const before = (await payloads(w.pool, EVENT)).length;
    await w.submit([w.row(downloads, '2026-01', 1), w.row(downloads, '2026-02', 2)]);
    expect(await payloads(w.pool, EVENT)).toHaveLength(before + 1);
    await w.submit([w.row(downloads, '2026-01', 1), w.row(downloads, '2026-02', 2)]);
    expect(await payloads(w.pool, EVENT)).toHaveLength(before + 1);
    await w.submit([w.row(downloads, '2026-02', 3)]);
    expect(await payloads(w.pool, EVENT)).toHaveLength(before + 2);
  });

  it('accepts the current month and an extra indicator, and keeps the values of different services apart', async () => {
    const w = await world();
    const provider = await makeOrganisation(w.pool, { type: 'provider' });
    const other = await makeService(w.pool, { provider: provider.id });
    await makeServiceKpis(w.pool, { serviceId: other.id, extras: [w.ind.downloads.id] });
    const admin = w.people.admin;
    await w.ingestion.measurements.upsertBatch(
      admin,
      other.id,
      [w.row(w.ind.downloads, '2026-06', 7)],
      {
        source: 'form',
      },
    );
    await w.submit([w.row(w.ind.downloads, '2026-06', 8), w.row(w.ind.ratio, '2026-06', 1.5)]);
    expect((await stored(w.pool, other.id)).map((row) => [row.value_numeric, row.source])).toEqual([
      ['7', 'form'],
    ]);
    expect(await stored(w.pool, w.svc.id)).toHaveLength(2);
  });

  it('records the source and the run it is given, and the run must exist', async () => {
    const w = await world();
    const runId = randomUUID();
    await w.pool.query(
      `insert into kpii_ingestion_run (id, service_id, adapter, status) values ($1, $2, 'csv', 'committed')`,
      [runId, w.svc.id],
    );
    await w.ingestion.measurements.upsertBatch(
      w.people.member,
      w.svc.id,
      [w.row(w.ind.downloads, '2026-01', 5)],
      {
        source: 'csv',
        runId,
      },
    );
    expect(await stored(w.pool, w.svc.id)).toMatchObject([{ source: 'csv', run_id: runId }]);
    expect((await payloads(w.pool, EVENT)).at(-1)).toMatchObject({ runId });
    // a run that does not exist is a 422 on `runId`, and nothing is written
    const ghost = await rejection(
      w.ingestion.measurements.upsertBatch(
        w.people.member,
        w.svc.id,
        [w.row(w.ind.downloads, '2026-02', 5)],
        {
          source: 'csv',
          runId: randomUUID(),
        },
      ),
    );
    expect(ghost.status).toBe(422);
    expect(paths(ghost)).toEqual(['runId']);
    expect(await stored(w.pool, w.svc.id)).toHaveLength(1);
  });

  it('takes the largest batch the limits allow in several statements, in one transaction', async () => {
    const s = await h.start();
    const w = await ingestionWorld(s);
    // 12 indicators × 100 months = 1200 rows: more than one statement of 1000
    const indicators = await Promise.all(
      Array.from({ length: 12 }, (_, n) =>
        makeIndicator(s.pool, { name: uniq(`bulk${n}`), valueType: 'integer' }),
      ),
    );
    const set = await makeKpiSet(s.pool, {
      name: uniq('bulk set'),
      indicators: indicators.map((indicator) => ({
        indicatorId: indicator.id,
        necessity: 'optional',
      })),
    });
    const svc = await makeService(s.pool, { provider: w.provider.id });
    await makeServiceKpis(s.pool, { serviceId: svc.id, setId: set.id });
    s.clock.set('2036-12-15T00:00:00Z');
    const rows = indicators.flatMap((indicator, i) =>
      Array.from({ length: 100 }, (_, m) => ({
        indicator: indicator.id,
        period: `${2028 + Math.floor(m / 12)}-${String((m % 12) + 1).padStart(2, '0')}`,
        value: i * 1000 + m,
      })),
    );
    expect(rows).toHaveLength(1200);
    const result = await s.ingestion.measurements.upsertBatch(w.people.member, svc.id, rows, {
      source: 'csv',
    });
    expect(result).toMatchObject({ inserted: 1200, updated: 0, unchanged: 0 });
    expect(await stored(s.pool, svc.id)).toHaveLength(1200);
    const event = (await payloads(s.pool, EVENT)).at(-1)!;
    expect(event.periods as string[]).toHaveLength(100);
    expect(event).toMatchObject({ inserted: 1200, updated: 0 });
    // writing it all again changes nothing
    const again = await s.ingestion.measurements.upsertBatch(w.people.member, svc.id, rows, {
      source: 'csv',
    });
    expect(again).toMatchObject({ inserted: 0, updated: 0, unchanged: 1200 });
  }, 120_000);

  it('survives batches that overlap and run at once, in opposite orders, with one row per key at the end', async () => {
    const w = await world();
    const { downloads, share, ratio } = w.ind;
    const months = ['2026-01', '2026-02', '2026-03', '2026-04'];
    const rowsFor = (value: number) =>
      [downloads, share, ratio].flatMap((indicator) =>
        months.map((month) => w.row(indicator, month, value)),
      );
    const outcomes = await Promise.allSettled(
      [1, 2, 3, 4, 5, 6].map((n) =>
        w.submit(
          n % 2 === 0 ? rowsFor(n).reverse() : rowsFor(n),
          n % 2 === 0 ? w.people.manager : w.people.member,
        ),
      ),
    );
    expect(outcomes.filter((outcome) => outcome.status === 'rejected')).toEqual([]);
    const rows = await stored(w.pool, w.svc.id);
    expect(rows).toHaveLength(12);
    // every row holds the value of one whole batch: the last writer's, not a mixture within one row
    for (const row of rows) expect([1, 2, 3, 4, 5, 6]).toContain(Number(row.value_numeric));
  });
});

describe('upsertBatch checks the value against the type and the bounds of its indicator', () => {
  it.each<[string, 'downloads' | 'share' | 'uptime' | 'note' | 'ratio', unknown, string]>([
    ['text for a whole number', 'downloads', 'many', 'whole number'],
    ['a fraction for a whole number', 'downloads', 1.5, 'whole number'],
    ['a number below the minimum of the indicator', 'downloads', -1, 'at least 0'],
    ['a number above the maximum of the indicator', 'downloads', 1_000_001, 'at most 1000000'],
    ['a percentage above 100', 'share', 101, 'between 0 and 100'],
    ['a negative percentage', 'share', -0.5, 'between 0 and 100'],
    ['a duration that is not HH-MM-SS', 'uptime', 'soon', 'HH-MM-SS'],
    ['a duration with 60 minutes', 'uptime', '01-60-00', 'HH-MM-SS'],
    ['an empty text', 'note', '', 'empty'],
    ['a text that is too long', 'note', 'x'.repeat(4001), '4000'],
    ['a number for a text', 'note', 5, 'text'],
    ['null', 'downloads', null, 'whole number'],
    ['a list', 'ratio', [1], 'number'],
    ['a decimal comma', 'ratio', '1,5', 'number'],
    ['a not-a-number', 'ratio', Number.NaN, 'finite'],
  ])(
    'refuses %s with a 422 on the value, and writes nothing',
    async (_name, key, value, reason) => {
      const w = await world();
      const error = await rejection(w.submit([w.row(w.ind[key], '2026-01', value)]));
      expect(error.status).toBe(422);
      expect(paths(error)).toEqual(['rows[0].value']);
      expect(error.errors![0]!.message).toContain(reason);
      expect(await count(w.pool, 'kpii_measurement')).toBe(0);
    },
  );

  it('accepts the values on the edge of the bounds', async () => {
    const w = await world();
    const result = await w.submit([
      w.row(w.ind.downloads, '2026-01', 0),
      w.row(w.ind.downloads, '2026-02', 1_000_000),
      w.row(w.ind.share, '2026-01', 0),
      w.row(w.ind.share, '2026-02', 100),
      w.row(w.ind.uptime, '2026-01', 0),
      w.row(w.ind.uptime, '2026-02', '9999-59-59'),
      w.row(w.ind.note, '2026-01', 'x'.repeat(4000)),
    ]);
    expect(result.inserted).toBe(7);
  });

  it('never repeats the value it refuses (a cell can hold anything)', async () => {
    const w = await world();
    const hostile = '<script>alert(1)</script>';
    const error = await rejection(w.submit([w.row(w.ind.downloads, '2026-01', hostile)]));
    expect(JSON.stringify(error.errors)).not.toContain('script');
    expect(error.message).not.toContain('script');
  });
});

describe('upsertBatch refuses a bad batch whole, naming every bad path', () => {
  it('names the indicator, the period and the value of each bad row, and all of them at once', async () => {
    const w = await world();
    const error = await rejection(
      w.submit([
        w.row(w.ind.downloads, '2026-01', 1), // good
        w.row(w.ind.outside, '2026-01', 1), // an indicator that exists and is not the service's
        { indicator: randomUUID(), period: '2026-01', value: 1 }, // an indicator that exists nowhere
        { indicator: 'not-an-id', period: '2026-01', value: 1 },
        w.row(w.ind.downloads, '2026-13', 1),
        w.row(w.ind.downloads, '2026-02-30', 1),
        w.row(w.ind.downloads, '2026-07', 1), // the future (the clock stands in June)
        w.row(w.ind.downloads, '', 1),
        w.row(w.ind.downloads, '2026-01', 'x'),
        { indicator: w.ind.downloads.id, period: '2026-03' }, // no value
        { indicator: 5, period: 5, value: 5 },
      ] as never),
    );
    expect(error.status).toBe(422);
    expect(paths(error)).toEqual(
      [
        'rows[1].indicator',
        'rows[2].indicator',
        'rows[3].indicator',
        'rows[4].period',
        'rows[5].period',
        'rows[6].period',
        'rows[7].period',
        'rows[8].value',
        'rows[9].value',
        'rows[10].indicator',
        'rows[10].period',
        // an indicator that is no good gives no value to check: a value problem needs an indicator
      ].sort(),
    );
    expect(await count(w.pool, 'kpii_measurement')).toBe(0);
    expect(await payloads(w.pool, EVENT)).toEqual([]);
  });

  it('refuses a duplicate inside the batch, whatever way the month is written, and never lets the last one win', async () => {
    const w = await world();
    const { downloads, share } = w.ind;
    const error = await rejection(
      w.submit([
        w.row(downloads, '2026-01', 1),
        w.row(share, '2026-01', 1),
        w.row(downloads, '2026-01-15', 2), // the same month as row 0
        w.row(downloads, '2026-01-31', 3), // and again
        w.row(downloads, '2026-02', 4), // another month: fine
      ]),
    );
    expect(paths(error)).toEqual(['rows[2].period', 'rows[3].period']);
    expect(error.errors![0]!.message).toContain('rows[0]');
    expect(error.errors![1]!.message).toContain('rows[0]');
    expect(await count(w.pool, 'kpii_measurement')).toBe(0);
  });

  it('lists at most 100 problems and says how many there were', async () => {
    const w = await world();
    const rows = Array.from({ length: 150 }, () => w.row(w.ind.downloads, 'nope', 1));
    const error = await rejection(w.submit(rows));
    expect(error.errors).toHaveLength(MAX_PROBLEMS);
    expect(error.message).toContain('150 problems');
  });

  it.each<[string, unknown]>([
    ['no list', 'rows'],
    ['an object', {}],
    ['null', null],
    ['an empty list', []],
    ['more rows than a batch holds', Array.from({ length: MAX_BATCH_ROWS + 1 }, () => ({}))],
  ])('refuses %s with a problem on `rows`', async (_name, rows) => {
    const w = await world();
    const error = await rejection(w.submit(rows as never));
    expect(error.status).toBe(422);
    expect(paths(error)).toEqual(['rows']);
  });

  it('refuses a batch that covers more than 120 months, so that the event can name them', async () => {
    const s = await h.start();
    const w = await ingestionWorld(s);
    s.clock.set('2040-12-15T00:00:00Z');
    const month = (n: number) =>
      `${2026 + Math.floor(n / 12)}-${String((n % 12) + 1).padStart(2, '0')}`;
    const exactly = Array.from({ length: MAX_BATCH_MONTHS }, (_, n) =>
      w.row(w.ind.downloads, month(n), n),
    );
    expect((await w.submit(exactly)).inserted).toBe(MAX_BATCH_MONTHS);
    const error = await rejection(
      w.submit([...exactly, w.row(w.ind.downloads, month(MAX_BATCH_MONTHS), 1)]),
    );
    expect(paths(error)).toEqual(['rows']);
    expect(await count(w.pool, 'kpii_measurement')).toBe(MAX_BATCH_MONTHS);
  });

  it.each<[string, unknown]>([
    ['null', null],
    ['a number', 5],
    ['text', 'row'],
    ['a list', []],
    ['an object of the wrong shape', { indicator: {}, period: [], value: {} }],
    ['an unknown key', { indicator: 'x', period: '2026-01', value: 1, extra: true }],
    ['a prototype key', JSON.parse('{"__proto__": 1, "indicator": 1}')],
  ])('answers a row that is %s with a 422 and never a 500', async (_name, row) => {
    const w = await world();
    const error = await rejection(w.submit([row] as never));
    expect(error.status).toBe(422);
    expect(error.errors!.every((problem) => problem.path.startsWith('rows[0]'))).toBe(true);
    expect(await count(w.pool, 'kpii_measurement')).toBe(0);
  });

  it.each<[string, Record<string, unknown>, string]>([
    ['no source', { source: '' }, 'source'],
    ['a source with a capital letter', { source: 'CSV' }, 'source'],
    ['a source with a space', { source: 'a b' }, 'source'],
    ['a source over 64 characters', { source: 'a'.repeat(65) }, 'source'],
    ['a run id that is not an id', { source: 'csv', runId: 'run' }, 'runId'],
  ])('refuses %s', async (_name, options, path) => {
    const w = await world();
    const error = await rejection(
      w.ingestion.measurements.upsertBatch(
        w.people.member,
        w.svc.id,
        [w.row(w.ind.downloads, '2026-01', 1)],
        options as never,
      ),
    );
    expect(paths(error)).toEqual([path]);
  });

  it('is a 422 for a service id that is not an id, 404 for one that does not exist, for an Admin who may ask', async () => {
    const w = await world();
    const rows = [w.row(w.ind.downloads, '2026-01', 1)];
    const admin = w.people.admin;
    expect(
      (await rejection(w.ingestion.measurements.upsertBatch(admin, 'x', rows, { source: 'test' })))
        .status,
    ).toBe(422);
    expect(
      (
        await rejection(
          w.ingestion.measurements.upsertBatch(admin, randomUUID(), rows, { source: 'test' }),
        )
      ).status,
    ).toBe(404);
  });

  it('refuses every row of a service that has no KPIs at all', async () => {
    const w = await world();
    const provider = await makeOrganisation(w.pool, { type: 'provider' });
    const bare = await makeService(w.pool, { provider: provider.id });
    const error = await rejection(
      w.ingestion.measurements.upsertBatch(
        w.people.admin,
        bare.id,
        [w.row(w.ind.downloads, '2026-01', 1)],
        {
          source: 'test',
        },
      ),
    );
    expect(paths(error)).toEqual(['rows[0].indicator']);
  });

  it('judges an indicator by the KPIs of the service now: one dropped from the set is refused, its old values stay', async () => {
    const w = await world();
    await w.submit([w.row(w.ind.share, '2026-01', 5)]);
    await w.pool.query('delete from kpif_kpi_set_indicator where indicator_id = $1', [
      w.ind.share.id,
    ]);
    const error = await rejection(w.submit([w.row(w.ind.share, '2026-02', 6)]));
    expect(paths(error)).toEqual(['rows[0].indicator']);
    expect(await stored(w.pool, w.svc.id)).toMatchObject([
      { period: '2026-01-31', value_numeric: '5' },
    ]);
  });

  it('reads the bounds of the indicator as they are now', async () => {
    const w = await world();
    await w.pool.query('update kpif_indicator set max_value = 10 where id = $1', [
      w.ind.downloads.id,
    ]);
    expect(paths(await rejection(w.submit([w.row(w.ind.downloads, '2026-01', 11)])))).toEqual([
      'rows[0].value',
    ]);
    expect((await w.submit([w.row(w.ind.downloads, '2026-01', 10)])).inserted).toBe(1);
  });

  it('refuses a value whose type is no longer registered, with a problem on the value', async () => {
    const w = await world();
    await w.pool.query("update kpif_indicator set value_type = 'gone' where id = $1", [
      w.ind.ratio.id,
    ]);
    const error = await rejection(w.submit([w.row(w.ind.ratio, '2026-01', 1)]));
    expect(paths(error)).toEqual(['rows[0].value']);
    expect(error.errors![0]!.message).toContain('not available');
  });
});

describe('upsertBatch is all or nothing', () => {
  it('leaves no row and no event when the event cannot be stored, for an insert and for an update', async () => {
    const w = await world();
    const undo = await breakOutbox(w.pool);
    try {
      await expect(
        w.submit([w.row(w.ind.downloads, '2026-01', 1), w.row(w.ind.share, '2026-01', 2)]),
      ).rejects.toThrow();
    } finally {
      await undo();
    }
    expect(await count(w.pool, 'kpii_measurement')).toBe(0);
    // an update: the stored value is still the old one
    await w.submit([w.row(w.ind.downloads, '2026-01', 1)]);
    const before = await stored(w.pool, w.svc.id);
    const undoAgain = await breakOutbox(w.pool);
    try {
      await expect(
        w.submit([w.row(w.ind.downloads, '2026-01', 99), w.row(w.ind.share, '2026-01', 2)]),
      ).rejects.toThrow();
    } finally {
      await undoAgain();
    }
    expect(await stored(w.pool, w.svc.id)).toEqual(before);
  });

  it('takes back the first statement when a later one fails', async () => {
    const s = await h.start();
    const w = await ingestionWorld(s);
    const indicators = await Promise.all(
      Array.from({ length: 11 }, (_, n) =>
        makeIndicator(s.pool, { name: uniq(`late${n}`), valueType: 'integer' }),
      ),
    );
    const set = await makeKpiSet(s.pool, {
      name: uniq('late set'),
      indicators: indicators.map((indicator) => ({
        indicatorId: indicator.id,
        necessity: 'optional',
      })),
    });
    const svc = await makeService(s.pool, { provider: w.provider.id });
    await makeServiceKpis(s.pool, { serviceId: svc.id, setId: set.id });
    // 11 indicators × 100 distinct months = 1100 rows: the second statement holds the last 100 in key order.
    const distinct = indicators.flatMap((indicator, i) =>
      Array.from({ length: 100 }, (_, m) => ({
        indicator: indicator.id,
        period: `${2018 + Math.floor(m / 12)}-${String((m % 12) + 1).padStart(2, '0')}`,
        value: i * 100 + m,
      })),
    );
    expect(distinct).toHaveLength(1100);
    // The last indicator in key order goes into the second statement: make that one fail.
    const last = [...indicators].sort((a, b) => a.id.localeCompare(b.id)).at(-1)!;
    await s.pool.query(`
      create or replace function test_break_measurement() returns trigger as $$
      begin
        if new.indicator_id = '${last.id}' then raise exception 'the second statement fails'; end if;
        return new;
      end $$ language plpgsql;
      create trigger test_break_measurement before insert on kpii_measurement
        for each row execute function test_break_measurement();`);
    try {
      await expect(
        s.ingestion.measurements.upsertBatch(w.people.member, svc.id, distinct, { source: 'csv' }),
      ).rejects.toThrow();
    } finally {
      await s.pool.query('drop trigger test_break_measurement on kpii_measurement');
    }
    expect(await stored(s.pool, svc.id)).toEqual([]);
    expect(await payloads(s.pool, EVENT)).toEqual([]);
  }, 120_000);

  it('answers 409, not 500, when the key of the indicator refuses the insert', async () => {
    const w = await world();
    await w.pool.query(`
      create or replace function test_refuse_indicator() returns trigger as $$
      begin
        raise exception 'the indicator is gone' using errcode = 'foreign_key_violation',
          constraint = 'kpii_measurement_indicator_id_fk';
      end $$ language plpgsql;
      create trigger test_refuse_indicator before insert on kpii_measurement
        for each row execute function test_refuse_indicator();`);
    try {
      const error = await rejection(w.submit([w.row(w.ind.downloads, '2026-01', 1)]));
      expect(error.status).toBe(409);
    } finally {
      await w.pool.query('drop trigger test_refuse_indicator on kpii_measurement');
    }
    expect(await count(w.pool, 'kpii_measurement')).toBe(0);
  });
});

describe('upsertBatch with dryRun', () => {
  it('writes nothing and emits nothing, and says what a real run would do, row by row', async () => {
    const w = await world();
    const { downloads, share } = w.ind;
    await w.submit([w.row(downloads, '2026-01', 1), w.row(downloads, '2026-02', 2)]);
    const before = await stored(w.pool, w.svc.id);
    const events = (await payloads(w.pool, EVENT)).length;
    const rows = [
      w.row(downloads, '2026-01', 1), // unchanged
      w.row(downloads, '2026-02', 22), // update
      w.row(share, '2026-03', 30), // insert
    ];
    const dry = await w.ingestion.measurements.upsertBatch(w.people.member, w.svc.id, rows, {
      source: 'test',
      dryRun: true,
    });
    expect(dry).toMatchObject({ inserted: 1, updated: 1, unchanged: 1, rejected: 0 });
    expect(dry.rows.map((row) => row.verdict)).toEqual(['unchanged', 'update', 'insert']);
    expect(await stored(w.pool, w.svc.id)).toEqual(before);
    expect(await payloads(w.pool, EVENT)).toHaveLength(events);
    // and the real run does exactly that
    const real = await w.submit(rows);
    expect(real.rows.map((row) => row.verdict)).toEqual(dry.rows.map((row) => row.verdict));
    expect([real.inserted, real.updated, real.unchanged]).toEqual([
      dry.inserted,
      dry.updated,
      dry.unchanged,
    ]);
  });

  it('returns a bad row as a reject with its problems, and still judges the good ones', async () => {
    const w = await world();
    const dry = await w.ingestion.measurements.upsertBatch(
      w.people.member,
      w.svc.id,
      [
        w.row(w.ind.downloads, '2026-01', 1),
        w.row(w.ind.downloads, '2026-02', 'x'),
        w.row(w.ind.downloads, '2026-01', 5), // repeats row 0
      ],
      { source: 'test', dryRun: true },
    );
    expect(dry).toMatchObject({ inserted: 1, updated: 0, unchanged: 0, rejected: 2 });
    expect(dry.rows.map((row) => row.verdict)).toEqual(['insert', 'reject', 'reject']);
    expect(dry.rows[1]!.problems!.map((problem) => problem.path)).toEqual(['rows[1].value']);
    expect(dry.rows[2]!.problems!.map((problem) => problem.path)).toEqual(['rows[2].period']);
    expect(await count(w.pool, 'kpii_measurement')).toBe(0);
  });

  it('still refuses a batch that is wrong as a whole, and still needs the permission', async () => {
    const w = await world();
    const error = await rejection(
      w.ingestion.measurements.upsertBatch(w.people.member, w.svc.id, [], {
        source: 'test',
        dryRun: true,
      }),
    );
    expect(paths(error)).toEqual(['rows']);
    await expect(
      w.ingestion.measurements.upsertBatch(
        w.people.plain,
        w.svc.id,
        [w.row(w.ind.downloads, '2026-01', 1)],
        {
          source: 'test',
          dryRun: true,
        },
      ),
    ).rejects.toMatchObject({ status: 403 });
  });
});

describe('upsertBatch and the clock', () => {
  it('judges "the future" by the injected clock, so the same batch passes in July and fails in June', async () => {
    const s = await h.start();
    const w = await ingestionWorld(s);
    const july = [w.row(w.ind.downloads, '2026-07', 1)];
    expect(paths(await rejection(w.submit(july)))).toEqual(['rows[0].period']);
    s.clock.set('2026-07-01T00:00:00Z');
    expect((await w.submit(july)).inserted).toBe(1);
    s.clock.set('2026-06-30T23:59:59Z');
    expect(paths(await rejection(w.submit([w.row(w.ind.downloads, '2026-08', 1)])))).toEqual([
      'rows[0].period',
    ]);
  });
});

describe('what an answer and an event never hold', () => {
  it('lists no value, name or text of a measurement in a problem or in the event', async () => {
    const w = await world();
    await w.submit([w.row(w.ind.note, '2026-01', 'a confidential remark')]);
    const events = JSON.stringify(await payloads(w.pool, EVENT));
    expect(events).not.toContain('confidential');
    expect(events).not.toContain(w.ind.note.name);
    const error = await rejection(
      w.submit([w.row(w.ind.note, '2026-13', 'another confidential remark')]),
    );
    expect(JSON.stringify(error.errors)).not.toContain('confidential');
    expect(JSON.stringify(error.errors)).not.toContain(w.ind.note.name);
  });

  it('keeps a failed batch from being half-visible to a reader of the table', async () => {
    const w = await world();
    const ownRows = await Promise.allSettled([
      w.submit([w.row(w.ind.downloads, '2026-01', 1), w.row(w.ind.outside, '2026-01', 1)]),
      w.submit([w.row(w.ind.share, '2026-01', 1)]),
    ]);
    expect(ownRows.map((outcome) => outcome.status)).toEqual(['rejected', 'fulfilled']);
    expect((await stored(w.pool, w.svc.id)).map((row) => row.indicator_id)).toEqual([
      w.ind.share.id,
    ]);
  });
});
