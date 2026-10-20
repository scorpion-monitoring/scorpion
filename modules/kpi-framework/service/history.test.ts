// The history of a service's KPIs (M10 sprint 1, ADR-0041 Decision 3): the writer appends a row in the transaction of
// every change (the service method, and the create wizard's `store`), a rolled-back change leaves none, the backfill of the
// migration starts the history for what existed, and `kpisInPeriod` answers "which KPIs did this service have in this month"
// (the state at the end of the month). Real Postgres. The property test generates histories with `fast-check` and compares the
// answer with an independent oracle.
import { randomUUID } from 'node:crypto';
import fc from 'fast-check';
import { readFileSync } from 'node:fs';
import type { Actor } from '@scorpion/contracts';
import {
  makeIndicator,
  makeKpiSet,
  makeOrganisation,
  makeService,
  makeServiceKpiHistory,
} from '@scorpion/testing';
import { describe, expect, it } from 'vitest';
import { useKpi, type KpiStarted } from '../test/harness.ts';
import { breakOutbox, count, rejection, uniq } from '../test/world.ts';
import { monthEndBoundary } from './history.ts';

const h = useKpi();

interface HistoryRow {
  set_id: string | null;
  extras: string[];
  valid_from: Date;
  valid_to: Date | null;
  changed_by: string | null;
}
const rowsOf = async (s: KpiStarted, serviceId: string) =>
  (
    await s.pool.query<HistoryRow>(
      'select set_id, extras, valid_from, valid_to, changed_by from kpif_service_kpi_history where service_id = $1 order by valid_from',
      [serviceId],
    )
  ).rows;

async function setup() {
  const s = await h.start();
  const admin = await s.actor('admin');
  const provider = await makeOrganisation(s.pool, { type: 'provider' });
  const svc = await makeService(s.pool, { provider: provider.id });
  const [a, b, c] = await Promise.all(
    [1, 2, 3].map((n) => makeIndicator(s.pool, { name: uniq(`hist${n}`) })),
  );
  const setA = await makeKpiSet(s.pool, {
    name: uniq('set a'),
    indicators: [{ indicatorId: a!.id, necessity: 'mandatory' }],
  });
  const setB = await makeKpiSet(s.pool, {
    name: uniq('set b'),
    indicators: [{ indicatorId: b!.id, necessity: 'recommended' }],
  });
  return { s, admin, svc, a: a!, b: b!, c: c!, setA, setB };
}

describe('monthEndBoundary: the first instant after the month of a period', () => {
  it.each([
    ['2026-01', '2026-02-01T00:00:00.000Z'],
    ['2026-01-31', '2026-02-01T00:00:00.000Z'],
    ['2026-01-01', '2026-02-01T00:00:00.000Z'],
    ['2026-12', '2027-01-01T00:00:00.000Z'],
    ['2026-02-28', '2026-03-01T00:00:00.000Z'],
    ['2024-02-29', '2024-03-01T00:00:00.000Z'],
    ['2000-02-29', '2000-03-01T00:00:00.000Z'],
    [' 2026-04-30 ', '2026-05-01T00:00:00.000Z'],
  ])('reads %s', (period, expected) => {
    expect(monthEndBoundary(period).toISOString()).toBe(expected);
  });

  it.each([
    '',
    ' ',
    '2026',
    '26-01',
    '2026-13',
    '2026-00',
    '2026-02-30',
    '2026-02-29',
    '1900-02-29',
    '2026-04-31',
    '2026-01-32',
    '2026-01-00',
    '2026-1-05',
    '0000-01',
    '2026-01-31T00:00:00Z',
    '2026/01/31',
    'January 2026',
  ])('refuses %j with a problem on period, never a crash', (period) => {
    try {
      monthEndBoundary(period);
      throw new Error('accepted');
    } catch (error) {
      expect((error as { status?: number }).status).toBe(422);
      expect((error as { errors?: { path: string }[] }).errors?.[0]?.path).toBe('period');
    }
  });
});

describe('what the writer records', () => {
  it('appends a row for the first set, none for a repeat, and closes the row it replaces [ASVS-8.3.2]', async () => {
    const { s, admin, svc, setA, setB, b } = await setup();
    expect(await rowsOf(s, svc.id)).toEqual([]);
    await s.kpi.serviceKpis.set(admin, svc.id, { setId: setA.id, extras: [b.id] });
    let rows = await rowsOf(s, svc.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      set_id: setA.id,
      extras: [b.id],
      valid_to: null,
      changed_by: admin.userId,
    });
    // The same request again changes nothing, so it records nothing.
    await s.kpi.serviceKpis.set(admin, svc.id, { setId: setA.id, extras: [b.id] });
    expect(await rowsOf(s, svc.id)).toHaveLength(1);
    // A new set: the open row is closed at the instant the new one begins.
    await s.kpi.serviceKpis.set(admin, svc.id, { setId: setB.id, extras: [] });
    rows = await rowsOf(s, svc.id);
    expect(rows.map((row) => [row.set_id, row.extras.length])).toEqual([
      [setA.id, 1],
      [setB.id, 0],
    ]);
    expect(rows[0]!.valid_to).toEqual(rows[1]!.valid_from);
    expect(rows[0]!.valid_to!.getTime()).toBeGreaterThan(rows[0]!.valid_from.getTime());
    expect(rows[1]!.valid_to).toBeNull();
  });

  it('records a change of the extras alone, and a cleared set, and leaves out an extra the set contains', async () => {
    const { s, admin, svc, setA, a, b, c } = await setup();
    await s.kpi.serviceKpis.set(admin, svc.id, { setId: setA.id, extras: [] });
    // `a` is a row of set A: it is not an extra, so the stored extras and the history hold `b` only.
    await s.kpi.serviceKpis.set(admin, svc.id, { setId: setA.id, extras: [a.id, b.id] });
    await s.kpi.serviceKpis.set(admin, svc.id, { setId: setA.id, extras: [c.id, b.id] });
    await s.kpi.serviceKpis.set(admin, svc.id, { setId: null, extras: [] });
    const rows = await rowsOf(s, svc.id);
    expect(rows.map((row) => [row.set_id, [...row.extras].sort()])).toEqual([
      [setA.id, []],
      [setA.id, [b.id]],
      [setA.id, [b.id, c.id].sort()],
      [null, []],
    ]);
    expect(rows.filter((row) => row.valid_to === null)).toHaveLength(1);
  });

  it('keeps the history of one service apart from another’s', async () => {
    const { s, admin, svc, setA, setB } = await setup();
    const provider = await makeOrganisation(s.pool, { type: 'provider' });
    const other = await makeService(s.pool, { provider: provider.id });
    await s.kpi.serviceKpis.set(admin, svc.id, { setId: setA.id, extras: [] });
    await s.kpi.serviceKpis.set(admin, other.id, { setId: setB.id, extras: [] });
    await s.kpi.serviceKpis.set(admin, svc.id, { setId: setB.id, extras: [] });
    expect((await rowsOf(s, svc.id)).map((row) => row.set_id)).toEqual([setA.id, setB.id]);
    expect((await rowsOf(s, other.id)).map((row) => row.set_id)).toEqual([setB.id]);
  });

  it('writes no row when the change is refused, and leaves the open row open [ASVS-8.3.2]', async () => {
    const { s, admin, svc, setA, setB } = await setup();
    await s.kpi.serviceKpis.set(admin, svc.id, { setId: setA.id, extras: [] });
    const before = await rowsOf(s, svc.id);
    const ghost = '018f3b7e-0000-7000-8000-000000000001';
    expect(
      (await rejection(s.kpi.serviceKpis.set(admin, svc.id, { setId: ghost, extras: [] }))).status,
    ).toBe(422);
    const plain = await s.actor('user');
    expect(
      (await rejection(s.kpi.serviceKpis.set(plain, svc.id, { setId: setB.id, extras: [] })))
        .status,
    ).toBe(403);
    expect(await rowsOf(s, svc.id)).toEqual(before);
  });

  it('rolls the history back with the change when the event cannot be stored', async () => {
    const { s, admin, svc, setA, setB } = await setup();
    // First ever change: nothing is left behind.
    const undo = await breakOutbox(s.pool);
    try {
      await expect(
        s.kpi.serviceKpis.set(admin, svc.id, { setId: setA.id, extras: [] }),
      ).rejects.toThrow();
    } finally {
      await undo();
    }
    expect(await rowsOf(s, svc.id)).toEqual([]);
    // A later change: the open row stays open and no new row appears.
    await s.kpi.serviceKpis.set(admin, svc.id, { setId: setA.id, extras: [] });
    const before = await rowsOf(s, svc.id);
    const undoAgain = await breakOutbox(s.pool);
    try {
      await expect(
        s.kpi.serviceKpis.set(admin, svc.id, { setId: setB.id, extras: [] }),
      ).rejects.toThrow();
    } finally {
      await undoAgain();
    }
    expect(await rowsOf(s, svc.id)).toEqual(before);
    expect(before[0]!.valid_to).toBeNull();
  });

  it('rolls the history back with the change when the history insert itself fails', async () => {
    const { s, admin, svc, setA, setB } = await setup();
    await s.kpi.serviceKpis.set(admin, svc.id, { setId: setA.id, extras: [] });
    const before = await rowsOf(s, svc.id);
    await s.pool.query(`
      create or replace function test_break_history() returns trigger as $$
      begin raise exception 'the history is broken for this test'; end $$ language plpgsql;
      create trigger test_break_history before insert on kpif_service_kpi_history
        for each row execute function test_break_history();`);
    try {
      await expect(
        s.kpi.serviceKpis.set(admin, svc.id, { setId: setB.id, extras: [] }),
      ).rejects.toThrow();
    } finally {
      await s.pool.query('drop trigger test_break_history on kpif_service_kpi_history');
    }
    // The set row did not move either: the whole change went back.
    expect(await rowsOf(s, svc.id)).toEqual(before);
    const stored = await s.pool.query('select set_id from kpif_service_set where service_id = $1', [
      svc.id,
    ]);
    expect(stored.rows[0]).toEqual({ set_id: setA.id });
  });
});

/** The part of the services service the create wizard needs (the module's type is not importable from here). */
interface Services {
  create(actor: Actor, body: unknown): Promise<{ id: string }>;
}

describe('what the create wizard records', () => {
  it('appends the first row with the service, in the same transaction', async () => {
    const { s, admin, setA, b } = await setup();
    const services = s.kernel.services.get('registry.services') as Services;
    const provider = await makeOrganisation(s.pool, { type: 'provider' });
    const created = await services.create(admin, {
      slug: uniq('wz'),
      name: 'Wizard service',
      provider: provider.id,
      kpiSet: { setId: setA.id, extras: [b.id] },
    });
    const rows = await rowsOf(s, created.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      set_id: setA.id,
      extras: [b.id],
      valid_to: null,
      changed_by: admin.userId,
    });
  });

  it('writes nothing for a service created without a set', async () => {
    const { s, admin } = await setup();
    const services = s.kernel.services.get('registry.services') as Services;
    const provider = await makeOrganisation(s.pool, { type: 'provider' });
    const before = await count(s.pool, 'kpif_service_kpi_history');
    const created = await services.create(admin, {
      slug: uniq('wz'),
      name: 'No KPIs',
      provider: provider.id,
    });
    expect(await rowsOf(s, created.id)).toEqual([]);
    expect(await count(s.pool, 'kpif_service_kpi_history')).toBe(before);
  });

  it('leaves no service and no history row when the event cannot be stored', async () => {
    const { s, admin, setA, b } = await setup();
    const services = s.kernel.services.get('registry.services') as Services;
    const provider = await makeOrganisation(s.pool, { type: 'provider' });
    const before = {
      history: await count(s.pool, 'kpif_service_kpi_history'),
      services: await count(s.pool, 'svc_service'),
    };
    const undo = await breakOutbox(s.pool);
    try {
      await expect(
        services.create(admin, {
          slug: uniq('wz'),
          name: 'Rolled back',
          provider: provider.id,
          kpiSet: { setId: setA.id, extras: [b.id] },
        }),
      ).rejects.toThrow();
    } finally {
      await undo();
    }
    expect({
      history: await count(s.pool, 'kpif_service_kpi_history'),
      services: await count(s.pool, 'svc_service'),
    }).toEqual(before);
  });
});

describe('the backfill of the migration', () => {
  /** The statements of the migration that fill the table from the rows that existed before it. */
  const backfill = readFileSync(
    new URL('../migrations/0002_service_kpi_history.sql', import.meta.url),
    'utf8',
  )
    .split('--> statement-breakpoint')
    .find((statement) => statement.includes('INSERT INTO "kpif_service_kpi_history"'))!;

  it('gives every service with a set or extras one open row, from the time of the set row', async () => {
    const { s, setA, setB, a, b, c } = await setup();
    const none = randomUUID();
    const withSet = randomUUID();
    const withBoth = randomUUID();
    const extrasOnly = randomUUID();
    const user = randomUUID();
    const updated = '2026-03-04T05:06:07.123456Z';
    await s.pool.query(
      'insert into kpif_service_set (service_id, set_id, updated_at, updated_by) values ($1, $2, $3, $4)',
      [withSet, setA.id, updated, user],
    );
    await s.pool.query(
      'insert into kpif_service_set (service_id, set_id, updated_at, updated_by) values ($1, $2, $3, null)',
      [withBoth, setB.id, updated],
    );
    const extra = (serviceId: string, indicatorId: string) =>
      s.pool.query(
        'insert into kpif_service_extra_indicator (service_id, indicator_id) values ($1, $2)',
        [serviceId, indicatorId],
      );
    // `a` is a row of set A, `b` a row of set B: a stored extra the set contains is not an extra, so the backfill leaves it out.
    await extra(withSet, a.id);
    await extra(withBoth, a.id);
    await extra(withBoth, b.id);
    await extra(extrasOnly, c.id);
    // Start from an empty table (the migration ran on the new database before these rows existed), then run the statement.
    await s.pool.query(
      'alter table kpif_service_kpi_history disable trigger kpif_service_kpi_history_guard',
    );
    await s.pool.query('delete from kpif_service_kpi_history');
    await s.pool.query(
      'alter table kpif_service_kpi_history enable trigger kpif_service_kpi_history_guard',
    );
    await s.pool.query(backfill);
    const at = async (id: string) => rowsOf(s, id);
    expect(await at(none)).toEqual([]);
    const [rowSet] = await at(withSet);
    expect(rowSet).toMatchObject({ set_id: setA.id, valid_to: null, changed_by: user });
    expect(rowSet!.extras).toEqual([]);
    expect(rowSet!.valid_from.toISOString()).toBe('2026-03-04T05:06:07.123Z');
    const [rowBoth] = await at(withBoth);
    expect(rowBoth).toMatchObject({ set_id: setB.id, valid_to: null });
    expect(rowBoth!.extras).toEqual([a.id]);
    const [rowExtras] = await at(extrasOnly);
    expect(rowExtras).toMatchObject({ set_id: null, valid_to: null });
    expect(rowExtras!.extras).toEqual([c.id]);
    // A service with extras and no set has no time to start from: it starts at the migration (now).
    expect(Date.now() - rowExtras!.valid_from.getTime()).toBeLessThan(60_000);
  });
});

describe('kpisInPeriod', () => {
  const T = (iso: string) => new Date(iso);

  async function series(
    s: KpiStarted,
    serviceId: string,
    states: { from: string; setId?: string | null; extras?: string[] }[],
  ) {
    for (const [i, state] of states.entries())
      await makeServiceKpiHistory(s.pool, {
        serviceId,
        setId: state.setId ?? null,
        extras: state.extras ?? [],
        validFrom: state.from,
        validTo: states[i + 1]?.from ?? null,
      });
  }

  it('answers with the state in force at the end of the month, at its edges and across changes', async () => {
    const { s, svc, setA, setB, b } = await setup();
    await series(s, svc.id, [
      { from: '2026-02-15T10:00:00Z', setId: setA.id },
      { from: '2026-04-01T00:00:00Z', setId: setB.id, extras: [b.id] },
      { from: '2026-06-10T08:00:00Z', setId: setB.id },
      { from: '2026-06-20T08:00:00Z', setId: null },
    ]);
    const setOf = async (period: string) => (await s.kpi.kpisInPeriod(svc.id, period))?.setId;
    // Before the first row there is no record (not "no set").
    expect(await s.kpi.kpisInPeriod(svc.id, '2026-01-31')).toBeNull();
    expect(await s.kpi.kpisInPeriod(svc.id, '2026-01')).toBeNull();
    // The month of the first row: the state at the end of it.
    expect(await setOf('2026-02-28')).toBe(setA.id);
    expect(await setOf('2026-02-01')).toBe(setA.id);
    expect(await setOf('2026-03-31')).toBe(setA.id);
    // A change at the first instant of April belongs to April, not to March.
    expect(await setOf('2026-03-31')).toBe(setA.id);
    expect(await setOf('2026-04-30')).toBe(setB.id);
    expect((await s.kpi.kpisInPeriod(svc.id, '2026-04'))?.extras).toEqual([b.id]);
    expect((await s.kpi.kpisInPeriod(svc.id, '2026-05-31'))?.extras).toEqual([b.id]);
    // Two changes in June: the later state wins.
    expect(await setOf('2026-06-30')).toBeNull();
    expect(await s.kpi.kpisInPeriod(svc.id, '2026-06-30')).not.toBeNull();
    // After the last change, for as long as it is open.
    expect((await s.kpi.kpisInPeriod(svc.id, '2031-12-31'))?.validFrom).toEqual(
      T('2026-06-20T08:00:00Z'),
    );
    // Any day of the month names the month.
    expect(await setOf('2026-02-01')).toBe(await setOf('2026-02-28'));
  });

  it('resolves the effective list: the rows of the set as they are now, then the extras', async () => {
    const { s, svc, setA, a, b } = await setup();
    await series(s, svc.id, [{ from: '2026-01-01T00:00:00Z', setId: setA.id, extras: [b.id] }]);
    const result = await s.kpi.kpisInPeriod(svc.id, '2026-05-31');
    expect(result?.rows.map((row) => [row.indicatorId, row.necessity, row.source])).toEqual([
      [a.id, 'mandatory', 'set'],
      [b.id, 'optional', 'extra'],
    ]);
    // A set's rows are not versioned: a row added to the set later shows in every month that used the set.
    const c = await makeIndicator(s.pool, { name: uniq('later') });
    await s.pool.query(
      "insert into kpif_kpi_set_indicator (set_id, indicator_id, necessity) values ($1, $2, 'optional')",
      [setA.id, c.id],
    );
    const later = await s.kpi.kpisInPeriod(svc.id, '2026-02-28');
    expect(later?.rows.map((row) => row.indicatorId)).toContain(c.id);
  });

  it('gives a service with no set the extras only, and one with nothing an empty list', async () => {
    const { s, svc, b } = await setup();
    await series(s, svc.id, [
      { from: '2026-01-01T00:00:00Z', extras: [b.id] },
      { from: '2026-03-01T00:00:00Z', extras: [] },
    ]);
    expect((await s.kpi.kpisInPeriod(svc.id, '2026-02-28'))?.rows.map((r) => r.source)).toEqual([
      'extra',
    ]);
    expect((await s.kpi.kpisInPeriod(svc.id, '2026-03-31'))?.rows).toEqual([]);
  });

  it('is 422 on `period` for an impossible month and for an id that is not a UUID, and null for an unknown service', async () => {
    const { s } = await setup();
    for (const period of ['2026-13', '2026-02-30', '', 'x'])
      expect(
        (await rejection(s.kpi.kpisInPeriod(randomUUID(), period))).errors?.map((e) => e.path),
      ).toEqual(['period']);
    expect((await rejection(s.kpi.kpisInPeriod('not-a-uuid', '2026-01'))).status).toBe(422);
    expect(await s.kpi.kpisInPeriod(randomUUID(), '2026-01')).toBeNull();
  });

  it('keeps one service’s history out of another’s answer', async () => {
    const { s, svc, setA, setB } = await setup();
    const provider = await makeOrganisation(s.pool, { type: 'provider' });
    const other = await makeService(s.pool, { provider: provider.id });
    await series(s, svc.id, [{ from: '2026-01-01T00:00:00Z', setId: setA.id }]);
    await series(s, other.id, [{ from: '2026-01-01T00:00:00Z', setId: setB.id }]);
    expect((await s.kpi.kpisInPeriod(svc.id, '2026-01'))?.setId).toBe(setA.id);
    expect((await s.kpi.kpisInPeriod(other.id, '2026-01'))?.setId).toBe(setB.id);
  });

  describe('property: the SQL answers like an independent oracle, for generated histories and months', () => {
    interface State {
      from: Date;
      to: Date | null;
      setId: string | null;
    }
    /** The oracle: scan the states, and keep the last one that began before the month ended and had not ended by then. */
    const oracle = (states: State[], year: number, month: number): State | null => {
      const end = Date.UTC(year, month, 1); // the first instant after the month (month is 1-based here)
      let found: State | null = null;
      for (const state of states)
        if (state.from.getTime() < end && (state.to === null || state.to.getTime() >= end))
          found = state;
      return found;
    };

    /** One change of a history: a month of 2025 to 2027, on its first instant (an edge) or inside it, and which set it moves to. */
    const change = fc.record({
      month: fc.integer({ min: 0, max: 35 }),
      edge: fc.boolean(),
      day: fc.integer({ min: 1, max: 27 }),
      seconds: fc.integer({ min: 0, max: 86_399 }),
      set: fc.integer({ min: 0, max: 2 }),
    });
    const timeOf = (c: { month: number; edge: boolean; day: number; seconds: number }) =>
      c.edge ? Date.UTC(2025, c.month, 1) : Date.UTC(2025, c.month, c.day, 0, 0, c.seconds);

    it('holds for 40 generated histories of up to 8 states, probed at every month of the range and beyond', async () => {
      const { s, setA, setB } = await setup();
      const sets = [null, setA.id, setB.id];
      const provider = await makeOrganisation(s.pool, { type: 'provider' });
      await fc.assert(
        fc.asyncProperty(
          // strictly increasing change times: no two changes at one instant
          fc.uniqueArray(change, { minLength: 1, maxLength: 8, selector: timeOf }),
          async (changes) => {
            const serviceId = (await makeService(s.pool, { provider: provider.id })).id;
            const ordered = [...changes].sort((x, y) => timeOf(x) - timeOf(y));
            const states: State[] = ordered.map((c, i) => ({
              from: new Date(timeOf(c)),
              to: ordered[i + 1] === undefined ? null : new Date(timeOf(ordered[i + 1]!)),
              setId: sets[c.set]!,
            }));
            for (const state of states)
              await makeServiceKpiHistory(s.pool, {
                serviceId,
                setId: state.setId,
                validFrom: state.from,
                validTo: state.to,
              });
            for (let index = -2; index < 40; index++) {
              const year = 2024 + Math.floor((index + 12) / 12);
              const month = (((index % 12) + 12) % 12) + 1;
              const period = `${year}-${String(month).padStart(2, '0')}`;
              const expected = oracle(states, year, month);
              const answer = await s.kpi.kpisInPeriod(serviceId, period);
              if (expected === null) expect(answer, period).toBeNull();
              else {
                expect(answer?.validFrom, period).toEqual(expected.from);
                expect(answer?.setId, period).toBe(expected.setId);
              }
            }
          },
        ),
        { numRuns: 40 },
      );
    }, 300_000);
  });
});
