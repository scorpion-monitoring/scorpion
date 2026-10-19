// Helpers of the service tests: a service of one provider with a KPI set of every kind of indicator, the people of every
// kind the policy has to tell apart, and unique names (specs share a database).
import { DomainError, type UserActor } from '@scorpion/contracts';
import {
  makeIndicator,
  makeKpiSet,
  makeMembership,
  makeOrganisation,
  makeService,
  makeServiceKpis,
} from '@scorpion/testing';
import type { KpiStarted } from './harness.ts';

let counter = 0;
export const uniq = (prefix: string) =>
  `${prefix}-${++counter}-${Math.random().toString(36).slice(2, 7)}`;

/** The error a promise rejects with; the test fails when it resolved. */
export async function rejection(promise: Promise<unknown>): Promise<DomainError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof DomainError) return error;
    throw error;
  }
  throw new Error('expected a rejection');
}

/** The paths a 422 names, sorted. */
export const paths = (error: DomainError) => (error.errors ?? []).map((e) => e.path).sort();

/** Makes the outbox refuse an insert, so the event of a write cannot be stored. Returns the undo. */
export async function breakOutbox(pool: { query(text: string): Promise<unknown> }) {
  await pool.query(`
    create or replace function test_break_outbox() returns trigger as $$
    begin raise exception 'outbox is broken for this test'; end $$ language plpgsql;
    create trigger test_break_outbox before insert on kernel_outbox
      for each row execute function test_break_outbox();`);
  return () => pool.query('drop trigger test_break_outbox on kernel_outbox');
}

interface Queryable {
  query<R = unknown>(
    text: string,
    values?: unknown[],
  ): Promise<{ rows: R[]; rowCount: number | null }>;
}

/** The payloads of the outbox events with this name, oldest first. */
export async function payloads(pool: Queryable, name: string): Promise<Record<string, unknown>[]> {
  const { rows } = await pool.query<{ payload: Record<string, unknown> }>(
    'select payload from kernel_outbox where name = $1 order by id',
    [name],
  );
  return rows.map((row) => row.payload);
}

/** The number of rows of a table. */
export async function count(pool: Queryable, table: string): Promise<number> {
  const { rows } = await pool.query<{ n: number }>(`select count(*)::int as n from ${table}`);
  return rows[0]!.n;
}

export interface StoredMeasurement {
  indicator_id: string;
  period: string;
  value_numeric: string | null;
  value_text: string | null;
  source: string;
  run_id: string | null;
  created_by: string | null;
  updated_by: string | null;
  created_at: Date;
  updated_at: Date;
}

/** The measurements of a service as stored, ordered by indicator and period. */
export async function stored(pool: Queryable, serviceId: string): Promise<StoredMeasurement[]> {
  const { rows } = await pool.query<StoredMeasurement>(
    `select indicator_id, to_char(period, 'YYYY-MM-DD') as period, value_numeric::text, value_text, source, run_id,
            created_by, updated_by, created_at, updated_at
       from kpii_measurement where service_id = $1 order by indicator_id, period`,
    [serviceId],
  );
  return rows;
}

/**
 * A service of one provider whose KPI set holds one indicator of each value type, another provider, and one person of
 * each kind that the policy and the service have to tell apart. The clock stands at 2026-06-15.
 */
export async function ingestionWorld(s: KpiStarted) {
  const provider = await makeOrganisation(s.pool, { type: 'provider' });
  const other = await makeOrganisation(s.pool, { type: 'provider' });
  const svc = await makeService(s.pool, { provider: provider.id });
  const elsewhereSvc = await makeService(s.pool, { provider: other.id });
  const downloads = await makeIndicator(s.pool, {
    name: uniq('Downloads'),
    valueType: 'integer',
    min: 0,
    max: 1_000_000,
    unit: 'count',
  });
  const share = await makeIndicator(s.pool, {
    name: uniq('Share'),
    valueType: 'percentage',
    unit: 'percent',
  });
  const uptime = await makeIndicator(s.pool, { name: uniq('Uptime'), valueType: 'duration' });
  const note = await makeIndicator(s.pool, {
    name: uniq('Note'),
    valueType: 'text',
    qualitative: true,
  });
  const ratio = await makeIndicator(s.pool, { name: uniq('Ratio'), valueType: 'float' });
  // `outside` is a real indicator that the service's KPIs do not include.
  const outside = await makeIndicator(s.pool, { name: uniq('Outside'), valueType: 'integer' });
  const set = await makeKpiSet(s.pool, {
    name: uniq('Ingestion set'),
    indicators: [
      { indicatorId: downloads.id, necessity: 'mandatory' },
      { indicatorId: share.id, necessity: 'recommended' },
      { indicatorId: uptime.id, necessity: 'optional' },
      { indicatorId: note.id, necessity: 'optional' },
    ],
  });
  // `ratio` is an extra of the service, not a row of its set.
  await makeServiceKpis(s.pool, { serviceId: svc.id, setId: set.id, extras: [ratio.id] });
  const people = {
    admin: await s.actor('admin'),
    manager: await s.actor('user'),
    member: await s.actor('user'),
    requested: await s.actor('user'),
    rejected: await s.actor('user'),
    left: await s.actor('user'),
    elsewhere: await s.actor('user'),
    reviewer: await s.actor('reviewer'),
    plain: await s.actor('user'),
  };
  const join = (who: UserActor, organisationId: string, state: string, role = 'member') =>
    makeMembership(s.pool, {
      organisationId,
      userId: who.userId,
      state: state as 'approved',
      role: role as 'member',
    });
  await join(people.manager, provider.id, 'approved', 'manager');
  await join(people.member, provider.id, 'approved');
  await join(people.requested, provider.id, 'requested');
  await join(people.rejected, provider.id, 'rejected');
  await join(people.left, provider.id, 'left');
  await join(people.elsewhere, other.id, 'approved');
  const row = (
    indicator: { id: string },
    period: string,
    value: unknown,
  ): { indicator: string; period: string; value: unknown } => ({
    indicator: indicator.id,
    period,
    value,
  });
  return {
    ...s,
    provider,
    other,
    svc,
    elsewhereSvc,
    ind: { downloads, share, uptime, note, ratio, outside },
    people,
    join,
    row,
    submit: (rows: { indicator: string; period: string; value: unknown }[], who = people.member) =>
      s.ingestion.measurements.upsertBatch(who, svc.id, rows, { source: 'test' }),
  };
}
export type IngestionWorld = Awaited<ReturnType<typeof ingestionWorld>>;
