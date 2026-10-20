// The history of a service's KPIs (M10 sprint 1, ADR-0041 Decision 3): which KPI set and which extras a service had
// in a given month. `appendHistory` is called by the one writer of the KPIs (`KpisWriter.write`), inside its
// transaction, so every change of the set or the extras leaves a row and a rolled-back change leaves none.
// `kpisInPeriod` is the question the other modules ask. Both read and write `kpif_service_kpi_history` only.
import { Invalid } from '@scorpion/contracts';
import type { Db, DbTx } from '@scorpion/kernel';
import { and, eq, gte, isNull, lt, or, sql } from 'drizzle-orm';
import { serviceKpiHistory } from '../db/schema.ts';
import { effectiveOf, type EffectiveIndicator, type EffectiveRow } from './effective.ts';
import { requireId } from './input.ts';

/** The KPIs a service had in a month, as the history knows them. */
export interface KpisInPeriod {
  /** The set the service had at the end of the month, or `null` when it had none. */
  setId: string | null;
  /** The stored extras at the end of the month, without the ones the set contained, sorted. */
  extras: string[];
  /** When this state began (it may be months before the period). */
  validFrom: Date;
  /**
   * The effective list of that state: the rows of the set **as they are now** (a set's own rows are not versioned) and
   * the extras, in the usual order. An indicator or set deleted since contributes nothing.
   */
  rows: EffectiveRow<EffectiveIndicator>[];
}

const PERIOD = /^(\d{4})-(\d{2})(?:-(\d{2}))?$/;

/**
 * The first instant after the month a period names (UTC): `YYYY-MM` or `YYYY-MM-DD`, any day of the month. Pure.
 * A state belongs to the month when it is the one in force at that instant, which is the state **at the end of the
 * month**: two changes in one month leave the later one. An impossible date (`2026-02-30`, `2026-13`) is `Invalid`.
 */
export function monthEndBoundary(period: string): Date {
  const match = PERIOD.exec(period.trim());
  const problem = () =>
    new Invalid('The request is not valid.', [
      { in: 'query', path: 'period', message: 'must be a month (YYYY-MM) or a date (YYYY-MM-DD).' },
    ]);
  if (!match) throw problem();
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3] ?? 1)];
  const probe = new Date(Date.UTC(year, month - 1, day));
  // Date.UTC maps 0 to 1900 and rolls 2026-02-30 over to March: compare what came out with what went in.
  if (
    year < 1000 ||
    probe.getUTCFullYear() !== year ||
    probe.getUTCMonth() !== month - 1 ||
    probe.getUTCDate() !== day
  )
    throw problem();
  return new Date(Date.UTC(year, month, 1));
}

/**
 * Closes the open row of the service and appends the new state. Needs the per-service advisory lock of the writer (two
 * appends of one service never interleave). The new row begins at the database clock, at least a microsecond after the
 * one it closes, so the key `(service_id, valid_from)` never collides and the rows never overlap. The two statements
 * share one instant, which is read as text so that no precision is lost on the way through the driver.
 */
export async function appendHistory(
  tx: DbTx,
  serviceId: string,
  state: { setId: string | null; extras: readonly string[] },
  by: string | null,
): Promise<void> {
  const { rows } = await tx.execute<{ at: string }>(sql`
    select to_char(
             greatest(clock_timestamp(), coalesce(max(${serviceKpiHistory.validFrom}) + interval '1 microsecond', clock_timestamp()))
               at time zone 'UTC',
             'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as at
    from ${serviceKpiHistory}
    where ${serviceKpiHistory.serviceId} = ${serviceId}`);
  // Postgres parses the text back at full precision; a JS Date would cut it to the millisecond.
  const at = sql`${rows[0]!.at}::timestamptz`;
  await tx
    .update(serviceKpiHistory)
    .set({ validTo: at })
    .where(and(eq(serviceKpiHistory.serviceId, serviceId), isNull(serviceKpiHistory.validTo)));
  await tx.insert(serviceKpiHistory).values({
    serviceId,
    setId: state.setId,
    extras: [...state.extras].sort(),
    validFrom: at,
    changedBy: by,
  });
}

/**
 * The KPIs a service had in a month, or `null` when the history holds no state for it (the service had no record yet:
 * history starts at the migration for what changed before it, and a service that never had a set or an extra has no
 * row until its first). A trusted read: it checks no permission and names no caller; the caller checks its own.
 */
export async function kpisInPeriod(
  db: Pick<Db, 'select'>,
  serviceId: string,
  period: string,
): Promise<KpisInPeriod | null> {
  requireId(serviceId, 'serviceId');
  const boundary = monthEndBoundary(period);
  const [row] = await db
    .select({
      setId: serviceKpiHistory.setId,
      extras: serviceKpiHistory.extras,
      validFrom: serviceKpiHistory.validFrom,
    })
    .from(serviceKpiHistory)
    .where(
      and(
        eq(serviceKpiHistory.serviceId, serviceId),
        lt(serviceKpiHistory.validFrom, boundary),
        or(isNull(serviceKpiHistory.validTo), gte(serviceKpiHistory.validTo, boundary)),
      ),
    );
  if (!row) return null;
  const effective = await effectiveOf(db, { setId: row.setId, extraIds: row.extras });
  return {
    setId: row.setId,
    extras: [...row.extras],
    validFrom: row.validFrom,
    rows: effective.rows,
  };
}
