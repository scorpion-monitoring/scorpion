// The two Bibliographic KPIs (ADR-0056 decisions 5 and 7, amended in M16 sprint 3), written after a slice of the citation refresh
// through the trusted `kpi.ingestion.upsertBatchAsSystem` with source `bibliometrics`, for the services the slice finishes. Only
// `refresh` calls `writeKpi` (a test checks it). Both are written so that the Trend widget, which adds the months up, shows totals:
//
// - **Citations** (`kpi.citationsIndicatorId`): the month's new citations, the service's total now minus the sum of the values the
//   indicator has in earlier months (`reads.totalsAsSystem`). With none, the whole total goes in as its start. A removed publication or
//   a lowered count gives a negative month, so the months always add up to the total. The total is taken only when it is whole: every
//   publication has a count of the primary source taken by **this** refresh (`since`); otherwise the service is skipped and counted.
// - **Publications** (`kpi.publicationsIndicatorId`): for every month from the first to the current one, how many of the service's
//   publications were issued in it (0 for a month with none). The month is the one a provider member gave, else the agency's date
//   at month or day precision. A service with a publication of no such month is skipped and counted: the page asks the provider for
//   it (no guess). A date after the current month counts in the current month, one before 1900 in January 1900.
import type { FieldProblem } from '@scorpion/contracts';
import type { Db } from '@scorpion/kernel';
import type { KpiFrameworkPublic } from '@scorpion/kpi-framework/public';
import {
  MAX_BATCH_MONTHS,
  MIN_YEAR,
  type KpiIngestionPublic,
} from '@scorpion/kpi-ingestion/public';
import { sql } from 'drizzle-orm';
import { citationSnapshot, doiMetadata, publication } from '../db/schema.ts';
import type { BibliometricsSettings } from '../settings-schema.ts';

/** The `source` the values carry in the measurements of kpi.ingestion, which tells them from form, file and API submissions. */
export const KPI_SOURCE = 'bibliometrics';
/** The term of the vocabulary `thematic-category` the indicators must have (a key, never a label). */
export const BIBLIOGRAPHIC_CATEGORY = 'Bibliographic';

/** What the KPI write needs of kpi.framework and kpi.ingestion; trusted reads and the trusted write only. */
export interface KpiWriteDeps {
  kpi: Pick<
    KpiFrameworkPublic,
    'indicatorsByIdAsSystem' | 'effectiveIndicatorsAsSystem' | 'findValueType'
  >;
  measurements: Pick<KpiIngestionPublic['measurements'], 'upsertBatchAsSystem'>;
  reads: Pick<KpiIngestionPublic['reads'], 'totalsAsSystem'>;
}

/** `off`: the setting is empty. `unusable`: the indicator is gone, not numeric or not Bibliographic now (nothing written). */
export type KpiState = 'off' | 'on' | 'unusable';

/** What the write did in one slice, for the job's report. */
export interface KpiReport {
  citationsKpi: KpiState;
  citationsWritten: number;
  citationsSkippedNotInSet: number;
  /** A publication has no count from this refresh: a partial total is not written. */
  citationsSkippedIncomplete: number;
  publicationsKpi: KpiState;
  publicationsWritten: number;
  publicationsSkippedNotInSet: number;
  /** A publication has no date precise to the month: the provider is asked for it. */
  publicationsSkippedUndated: number;
  /** A write kpi.ingestion refused (a bound of the indicator, a set changed meanwhile); logged, never thrown. */
  kpiFailed: number;
}

export const kpiOff = (): KpiReport => ({
  citationsKpi: 'off',
  citationsWritten: 0,
  citationsSkippedNotInSet: 0,
  citationsSkippedIncomplete: 0,
  publicationsKpi: 'off',
  publicationsWritten: 0,
  publicationsSkippedNotInSet: 0,
  publicationsSkippedUndated: 0,
  kpiFailed: 0,
});

/** Why an indicator cannot take a bibliographic count, or `undefined` when it can. */
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

const KPI_KEYS = ['citationsIndicatorId', 'publicationsIndicatorId'] as const;
type KpiKey = (typeof KPI_KEYS)[number];
const idOf = (values: unknown, key: KpiKey) =>
  (values as Partial<BibliometricsSettings> | undefined)?.kpi?.[key];

/**
 * The rule of the two indicator settings for core.settings' registry `settings.check` (ADR-0057): each a numeric indicator in the
 * category Bibliographic, and not both the same. An id is asked about only when it changed, so a later change of the indicator never
 * blocks another setting.
 */
export function kpiSettingCheck(deps: () => Pick<KpiWriteDeps, 'kpi'>) {
  return async (values: unknown, before: unknown): Promise<Omit<FieldProblem, 'in'>[]> => {
    const problems: Omit<FieldProblem, 'in'>[] = [];
    for (const key of KPI_KEYS) {
      const id = idOf(values, key);
      if (id === undefined || id === idOf(before, key)) continue;
      const problem = await indicatorProblem(deps(), id);
      if (problem) problems.push({ path: `kpi.${key}`, message: problem });
    }
    const citations = idOf(values, 'citationsIndicatorId');
    if (citations !== undefined && citations === idOf(values, 'publicationsIndicatorId'))
      problems.push({
        path: 'kpi.publicationsIndicatorId',
        message: 'must be another indicator than the citations KPI',
      });
    return problems;
  };
}

/** `YYYY-MM` of a date in UTC. */
const monthOf = (date: Date) => date.toISOString().slice(0, 7);
const monthIndex = (month: string) =>
  Number(month.slice(0, 4)) * 12 + Number(month.slice(5, 7)) - 1;
const monthAt = (index: number) =>
  `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, '0')}`;

/**
 * The month counts of one service's publications from its first month (or the first month the indicator already holds, so a month
 * whose publications were removed goes back to 0) to the current month. Exported for its table-driven test.
 */
export function publicationMonths(
  months: readonly string[],
  firstStored: string | undefined,
  now: Date,
): { period: string; value: number }[] {
  const current = monthIndex(monthOf(now));
  const floor = MIN_YEAR * 12;
  const indices = months.map((month) => Math.max(floor, Math.min(current, monthIndex(month))));
  if (firstStored !== undefined) indices.push(Math.max(floor, monthIndex(firstStored)));
  if (indices.length === 0) return [];
  const counts = new Map<number, number>();
  for (const index of indices.slice(0, months.length))
    counts.set(index, (counts.get(index) ?? 0) + 1);
  const out: { period: string; value: number }[] = [];
  for (let index = Math.min(...indices); index <= current; index++)
    out.push({ period: monthAt(index), value: counts.get(index) ?? 0 });
  return out;
}

interface Run {
  settings: BibliometricsSettings;
  /** The source the citations are taken from: the first that is on (the one the list shows). */
  source: string | null;
  serviceIds: readonly string[];
  /** The last DOI of the slice; `undefined` for the last slice, which finishes every service. */
  lastDoi: string | undefined;
  /** When the refresh began (its first slice): a count taken before is not of this run. */
  since: Date;
  now: Date;
  log: { warn: (data: object, message: string) => void };
}

/**
 * Writes both KPIs for the services this slice finishes. A service is finished by the slice that holds its last DOI (in DOI order),
 * so a service whose DOIs cross two slices is decided once, by the second.
 */
export async function writeKpi(db: Db, deps: KpiWriteDeps, input: Run): Promise<KpiReport> {
  const report = kpiOff();
  const citationsId = input.settings.kpi.citationsIndicatorId;
  const publicationsId = input.settings.kpi.publicationsIndicatorId;
  const usable = async (id: string | undefined, what: string): Promise<KpiState> => {
    if (!id) return 'off';
    const problem = await indicatorProblem(deps, id);
    if (!problem) return 'on';
    input.log.warn(
      { indicatorId: id, problem },
      `bibliometrics: the ${what} KPI is set to an indicator that cannot take it; nothing written`,
    );
    return 'unusable';
  };
  if (!citationsId && !publicationsId) return report;
  if (input.serviceIds.length === 0) return report;
  report.citationsKpi = await usable(citationsId, 'citations');
  report.publicationsKpi = await usable(publicationsId, 'publications');
  if (report.citationsKpi !== 'on' && report.publicationsKpi !== 'on') return report;

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
         where s.doi = p.doi and s.source = ${input.source ?? ''} and s.taken_at >= ${input.since.toISOString()}::timestamptz
         order by s.taken_at desc
         limit 1
      ) latest on true
     where p.service_id in (${ids})
     group by p.service_id
     order by p.service_id`);

  const current = monthOf(input.now);
  const write = async (
    serviceId: string,
    rows: { indicator: string; period: string; value: number }[],
    what: string,
  ) => {
    try {
      for (let start = 0; start < rows.length; start += MAX_BATCH_MONTHS)
        await deps.measurements.upsertBatchAsSystem(
          serviceId,
          rows.slice(start, start + MAX_BATCH_MONTHS),
          { source: KPI_SOURCE },
        );
      return true;
    } catch (error) {
      report.kpiFailed++;
      input.log.warn(
        { serviceId, status: (error as { status?: number }).status },
        `bibliometrics: the ${what} of a service could not be written as its KPI`,
      );
      return false;
    }
  };

  for (const row of rows) {
    // Its later DOIs come in the next slice, which decides it.
    if (!row.finished) continue;
    const effective = new Set(
      (await deps.kpi.effectiveIndicatorsAsSystem(row.service_id)).map(
        (entry) => entry.indicatorId,
      ),
    );

    if (report.citationsKpi === 'on' && citationsId) {
      if (Number(row.found) < Number(row.of) || !input.source) report.citationsSkippedIncomplete++;
      else if (!effective.has(citationsId)) report.citationsSkippedNotInSet++;
      else {
        const [earlier] = await deps.reads.totalsAsSystem(row.service_id, [citationsId], current);
        const value = Number(row.total ?? 0) - (earlier?.sum ?? 0);
        if (
          await write(
            row.service_id,
            [{ indicator: citationsId, period: current, value }],
            'new citations',
          )
        )
          report.citationsWritten++;
      }
    }

    if (report.publicationsKpi === 'on' && publicationsId) {
      if (!effective.has(publicationsId)) {
        report.publicationsSkippedNotInSet++;
        continue;
      }
      // The month of each publication: the provider's date, else the agency's at month or day precision, else none.
      const { rows: dated } = await db.execute<{ month: string | null }>(sql`
        select case
                 when p.issued is not null then to_char(p.issued, 'YYYY-MM')
                 when m.issued is not null and m.issued_precision in ('month', 'day') then to_char(m.issued, 'YYYY-MM')
               end as month
          from ${publication} p
          left join ${doiMetadata} m on m.doi = p.doi
         where p.service_id = ${row.service_id}`);
      if (dated.some((entry) => entry.month === null)) {
        report.publicationsSkippedUndated++;
        continue;
      }
      const [stored] = await deps.reads.totalsAsSystem(row.service_id, [publicationsId], current);
      const months = publicationMonths(
        dated.map((entry) => entry.month!),
        stored?.firstPeriod.slice(0, 7),
        input.now,
      );
      if (
        await write(
          row.service_id,
          months.map((month) => ({ indicator: publicationsId, ...month })),
          'publication counts',
        )
      )
        report.publicationsWritten++;
    }
  }
  return report;
}
