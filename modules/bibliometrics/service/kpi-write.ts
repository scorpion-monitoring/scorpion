// The Bibliographic KPI (ADR-0056 decisions 5 and 7, plan §4): after a slice of the citation refresh, the citation total of each
// service of the slice is written as the value of the current month of the indicator the setting `kpi.indicatorId` names, through
// the trusted `kpi.ingestion.upsertBatchAsSystem` with source `bibliometrics`. Only `refresh` calls `writeKpi` (a test checks it).
//
// A total is written only when it is whole: every publication of the service has a count of the primary source taken by **this**
// refresh (`since`). A partial total would show as a drop in the trend widgets, the misleading zero in another form, so such a
// service is skipped and counted. So is a service whose effective KPI set lacks the indicator. Nothing is ever backfilled.
import type { FieldProblem } from '@scorpion/contracts';
import type { Db } from '@scorpion/kernel';
import type { KpiFrameworkPublic } from '@scorpion/kpi-framework/public';
import type { KpiIngestionPublic } from '@scorpion/kpi-ingestion/public';
import { sql } from 'drizzle-orm';
import { citationSnapshot, publication } from '../db/schema.ts';
import type { BibliometricsSettings } from '../settings-schema.ts';

/** The source of the values in `kpii_measurement`. */
export const KPI_SOURCE = 'bibliometrics';
/** The term of the vocabulary `thematic-category` the indicator must have (a key, never a label). */
export const BIBLIOGRAPHIC_CATEGORY = 'Bibliographic';

/** What the KPI write needs of kpi.framework and kpi.ingestion; trusted reads and the trusted write only. */
export interface KpiWriteDeps {
  kpi: Pick<
    KpiFrameworkPublic,
    'indicatorsByIdAsSystem' | 'effectiveIndicatorsAsSystem' | 'findValueType'
  >;
  measurements: Pick<KpiIngestionPublic['measurements'], 'upsertBatchAsSystem'>;
}

/** What the write did in one slice, for the job's report. */
export interface KpiReport {
  /** `off`: the setting is empty. `unusable`: the indicator is gone, not numeric or not Bibliographic now. */
  kpi: 'off' | 'on' | 'unusable';
  kpiWritten: number;
  kpiSkippedNotInSet: number;
  kpiSkippedIncomplete: number;
  /** The write was refused (a bound of the indicator, a race with a change of the set); logged, never thrown. */
  kpiFailed: number;
}

export const kpiOff = (): KpiReport => ({
  kpi: 'off',
  kpiWritten: 0,
  kpiSkippedNotInSet: 0,
  kpiSkippedIncomplete: 0,
  kpiFailed: 0,
});

/** Why an indicator cannot take the citation total, or `undefined` when it can. */
export async function indicatorProblem(
  deps: Pick<KpiWriteDeps, 'kpi'>,
  indicatorId: string,
): Promise<string | undefined> {
  const [row] = await deps.kpi.indicatorsByIdAsSystem([indicatorId]);
  if (!row) return 'is not an indicator';
  if (deps.kpi.findValueType(row.valueType)?.numeric !== true)
    return 'must be an indicator with a numeric value type';
  if (row.thematic !== BIBLIOGRAPHIC_CATEGORY)
    return 'must be an indicator in the thematic category Bibliographic';
  return undefined;
}

/**
 * The rule of the setting `kpi.indicatorId` for core.settings' registry `settings.check` (ADR-0057): a numeric indicator in the
 * category Bibliographic. Asked only when the id changed, so a later change of the indicator never blocks another setting.
 */
export function kpiSettingCheck(deps: () => Pick<KpiWriteDeps, 'kpi'>) {
  return async (values: unknown, before: unknown): Promise<Omit<FieldProblem, 'in'>[]> => {
    const id = (values as Partial<BibliometricsSettings> | undefined)?.kpi?.indicatorId;
    const previous = (before as Partial<BibliometricsSettings> | undefined)?.kpi?.indicatorId;
    if (id === undefined || id === previous) return [];
    const problem = await indicatorProblem(deps(), id);
    return problem ? [{ path: 'kpi.indicatorId', message: problem }] : [];
  };
}

/** `YYYY-MM` of a date in UTC: the month the value is for. */
const monthOf = (date: Date) => date.toISOString().slice(0, 7);

/**
 * Writes the totals of the services that this slice finishes. A service is finished by the slice that holds its last DOI (in DOI
 * order), so a service whose DOIs cross two slices is decided once, by the second.
 */
export async function writeKpi(
  db: Db,
  deps: KpiWriteDeps,
  input: {
    settings: BibliometricsSettings;
    /** The source the total is taken from: the first that is on (the one the list shows). */
    source: string | null;
    serviceIds: readonly string[];
    /** The last DOI of the slice; `undefined` for the last slice, which finishes every service. */
    lastDoi: string | undefined;
    /** When the refresh began (its first slice): a count taken before is not of this run. */
    since: Date;
    now: Date;
    log: { warn: (data: object, message: string) => void };
  },
): Promise<KpiReport> {
  const indicatorId = input.settings.kpi.indicatorId;
  if (!indicatorId) return kpiOff();
  const report: KpiReport = { ...kpiOff(), kpi: 'on' };
  if (input.serviceIds.length === 0 || !input.source) return report;
  const problem = await indicatorProblem(deps, indicatorId);
  if (problem) {
    input.log.warn(
      { indicatorId, problem },
      'bibliometrics: the Bibliographic KPI is set to an indicator that cannot take the citation total; nothing written',
    );
    return { ...report, kpi: 'unusable' };
  }

  const ids = sql.join(
    input.serviceIds.map((id) => sql`${id}::uuid`),
    sql`, `,
  );
  // Compared in the database, in the collation the slice was cut in.
  const finished = input.lastDoi === undefined ? sql`true` : sql`max(p.doi) <= ${input.lastDoi}`;
  // Per service: whether this slice holds its last DOI, how many publications, how many have a count of this run, and their sum.
  const { rows } = await db.execute<{
    service_id: string;
    finished: boolean;
    of: number;
    found: number;
    total: string | null;
  }>(sql`
    select p.service_id, ${finished} as finished, count(*)::int as of, count(latest.count)::int as found,
           sum(latest.count)::text as total
      from ${publication} p
      left join lateral (
        select s.cited_by_count as count
          from ${citationSnapshot} s
         where s.doi = p.doi and s.source = ${input.source} and s.taken_at >= ${input.since.toISOString()}::timestamptz
         order by s.taken_at desc
         limit 1
      ) latest on true
     where p.service_id in (${ids})
     group by p.service_id
     order by p.service_id`);

  const period = monthOf(input.now);
  for (const row of rows) {
    // Its later DOIs come in the next slice, which decides it.
    if (!row.finished) continue;
    if (Number(row.found) < Number(row.of)) {
      report.kpiSkippedIncomplete++;
      continue;
    }
    const effective = await deps.kpi.effectiveIndicatorsAsSystem(row.service_id);
    if (!effective.some((entry) => entry.indicatorId === indicatorId)) {
      report.kpiSkippedNotInSet++;
      continue;
    }
    try {
      await deps.measurements.upsertBatchAsSystem(
        row.service_id,
        [{ indicator: indicatorId, period, value: Number(row.total ?? 0) }],
        { source: KPI_SOURCE },
      );
      report.kpiWritten++;
    } catch (error) {
      report.kpiFailed++;
      const status = (error as { status?: number }).status;
      input.log.warn(
        { serviceId: row.service_id, status },
        'bibliometrics: the citation total of a service could not be written as its KPI',
      );
    }
  }
  return report;
}
