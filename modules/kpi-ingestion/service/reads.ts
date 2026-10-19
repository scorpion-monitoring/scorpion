// The reads of the measurements (M10 sprint 2): the time series of `GET /api/v1/measurements`, and for the signed-in pages the grid of
// one month and the coverage of the last months. One module of code: the three answers share the way a stored value is shown
// (`present`), the resolution of a service and of an indicator, and the order. Nothing here writes, and nothing reads another
// module's table: indicators and the effective KPI set come from `kpi.framework`'s trusted reads, services from
// `registry.services`.
//
// Who may read: every holder of the plain permission (`kpi.ingestion.v1.read` for the time series, `kpi.ingestion.measurement.read` for
// the other two), which the role `user` holds, for every service (decision 4 of the plan). The service checks it again after
// the route did, as `kpi.framework`'s v1 reads do. An answer never holds a person's id, a file name, a run or a source.
import { Invalid, NotFound, type Actor, type FieldProblem } from '@scorpion/contracts';
import type { AuthzService } from '@scorpion/core-authz/public';
import type { Db, ModuleContext } from '@scorpion/kernel';
import type { KpiFrameworkPublic } from '@scorpion/kpi-framework/public';
import type { ServicesPublic } from '@scorpion/registry-services/public';
import { and, asc, count, eq, gte, inArray, lte, sql, type SQL } from 'drizzle-orm';
import { measurement } from '../db/schema.ts';
import { resolveIndicatorRef, type IndicatorChoice } from './names.ts';
import { daysInMonth, normalisePeriodBound } from './period.ts';
import { PERMISSION_MEASUREMENT_READ, PERMISSION_V1_READ } from './permissions.ts';
import { resolveServiceRef, type ServiceLookup } from './service-ref.ts';
import { fromColumns } from './values.ts';

/** The necessity term of the indicators a month needs a value for. The key is the legacy one and RIMO's `mandatoryFor`. */
export const MANDATORY_NECESSITY = 'mandatory';
/** The most indicators a comma list of `indicators` names. */
export const MAX_INDICATOR_FILTER = 50;
/** The most months the coverage reads. */
export const MAX_COVERAGE_MONTHS = 36;
/** The months of the coverage when the caller names none. */
export const DEFAULT_COVERAGE_MONTHS = 12;

/** One value of the time series, as `GET /api/v1/measurements` shows it. */
export interface MeasurementRead {
  id: string;
  indicatorId: string;
  /** The identifier of the indicator; it identifies, it does not dereference. */
  iri: string;
  /** The abbreviation of the service. */
  service: string;
  /** The name of the indicator (the legacy `kpi`). */
  kpi: string;
  /** The canonical text the legacy API returned: what the value type formats (a duration as `HH-MM-SS`, a number as a decimal). */
  value: string;
  /** The number for a numeric type (a duration in seconds), `null` for text. */
  valueNumber: number | null;
  /** The last day of the month, `YYYY-MM-DD`. */
  period: string;
  /** The same day under the legacy name. */
  date: string;
}

export interface SeriesQuery {
  /** The id or the abbreviation of a service. */
  service: string;
  /** Ids or names (without case) of indicators of the service. */
  indicators?: readonly string[] | undefined;
  /** `YYYY-MM` or `YYYY-MM-DD`: from that month on. */
  start?: string | undefined;
  /** `YYYY-MM` or `YYYY-MM-DD`: up to that month. */
  stop?: string | undefined;
}

/** A row of the grid of one month: an indicator of the effective set with the value stored for the month, if any. */
export interface GridRow {
  indicatorId: string;
  name: string;
  valueType: string;
  unit: string | null;
  /** A term of the vocabulary `necessity`. */
  necessity: string;
  min: number | null;
  max: number | null;
  /** The stored value, or `null` while the month has none. `value` is the canonical text, `valueNumber` the number or `null`. */
  measurement: { id: string; value: string; valueNumber: number | null } | null;
}

export interface MonthGrid {
  serviceId: string;
  /** The last day of the month. */
  period: string;
  rows: GridRow[];
}

/** One month of the coverage of a service: how many of the effective indicators, and of the mandatory ones, have a value. */
export interface CoverageMonth {
  /** The last day of the month. */
  period: string;
  /** How many indicators of the effective set have a value for the month. */
  reported: number;
  /** How many indicators of the effective set are mandatory (the same for every month: the set as it is now). */
  mandatory: number;
  /** How many of those have a value. */
  mandatoryReported: number;
  /** Nothing mandatory is missing (also true while nothing is mandatory). */
  complete: boolean;
}

export interface ReadsService {
  /**
   * The time series of one service, oldest month first; within a month by indicator name without case, then id: the order holds
   * across pages (defect 6). `total` follows every filter (defect 15's rule). Needs the plain `kpi.ingestion.v1.read`; an unknown
   * service or indicator, a bad `start` or `stop`, and a `start` after `stop` are 422 that name the parameter.
   */
  list(
    actor: Actor,
    query: SeriesQuery,
    page: { page: number; pageSize: number },
  ): Promise<{ rows: MeasurementRead[]; total: number }>;
  /**
   * The effective KPI set of a service with the value stored for one month (`YYYY-MM` or `YYYY-MM-DD`). Needs
   * `kpi.ingestion.measurement.read`; 404 for a service that does not exist, 422 for a bad period.
   */
  grid(actor: Actor, serviceId: string, period: string): Promise<MonthGrid>;
  /**
   * The last `months` months (default 12, at most 36, the current one included), oldest first, with how many of the effective
   * indicators and of the mandatory ones have a value. Needs `kpi.ingestion.measurement.read`; 404 for a service that does not exist.
   */
  coverage(actor: Actor, serviceId: string, months?: number): Promise<CoverageMonth[]>;
}

export interface ReadsDeps {
  authz: Pick<AuthzService, 'require'>;
  services: Pick<ServicesPublic, 'existsAsSystem'> & ServiceLookup;
  kpi: Pick<
    KpiFrameworkPublic,
    'effectiveIndicatorsAsSystem' | 'indicatorsByIdAsSystem' | 'findValueType'
  >;
  clock: () => Date;
}

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const queryProblem = (path: string, message: string): FieldProblem => ({
  in: 'query',
  path,
  message,
});

/** Names without case, then the id: the order of the indicators within a month. Plain code-unit comparison, so no collation moves it. */
function byNameThenId(a: { name: string; id: string }, b: { name: string; id: string }): number {
  const left = a.name.toLowerCase();
  const right = b.name.toLowerCase();
  return left < right ? -1 : left > right ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

export function createReadsService(ctx: ModuleContext, deps: ReadsDeps): ReadsService {
  const db: Db = ctx.db;

  /** How a stored value reads: the canonical text of its type and the number, or `null` for a text. */
  function present(
    valueType: string | undefined,
    stored: { valueNumeric: string | null; valueText: string | null },
  ): { value: string; valueNumber: number | null } {
    const canonical = fromColumns(stored);
    const type = valueType === undefined ? undefined : deps.kpi.findValueType(valueType);
    return {
      value: type ? type.format(canonical) : String(canonical),
      valueNumber: stored.valueNumeric === null ? null : Number(stored.valueNumeric),
    };
  }

  async function requireService(serviceId: string): Promise<void> {
    if (!uuidPattern.test(serviceId))
      throw new Invalid('The request is not valid.', [
        queryProblem('service', 'must be the id of a service'),
      ]);
    if (!(await deps.services.existsAsSystem(serviceId)))
      throw new NotFound('There is no such service.');
  }

  return {
    async list(actor, query, page) {
      await deps.authz.require(actor, PERMISSION_V1_READ);

      const problems: FieldProblem[] = [];
      const service = await resolveServiceRef(deps.services, query.service);
      if (!service)
        problems.push(queryProblem('service', 'must be the id or the abbreviation of a service'));
      const bound = (name: 'start' | 'stop', input: string | undefined) => {
        if (input === undefined) return undefined;
        const parsed = normalisePeriodBound(input);
        if (!parsed.ok) {
          problems.push(queryProblem(name, parsed.problem));
          return undefined;
        }
        return parsed.value;
      };
      const start = bound('start', query.start);
      const stop = bound('stop', query.stop);
      if (start !== undefined && stop !== undefined && start > stop)
        problems.push(queryProblem('start', 'must not be after stop'));
      if (!service) throw new Invalid('The request is not valid.', problems);

      // The indicators this service can be asked about: the KPIs it has now and every indicator it has a value for (a value stays
      // when its KPI leaves the set). `kpi.framework` names them; this module holds only their ids.
      const [measured, effective] = await Promise.all([
        db
          .selectDistinct({ id: measurement.indicatorId })
          .from(measurement)
          .where(eq(measurement.serviceId, service.id)),
        deps.kpi.effectiveIndicatorsAsSystem(service.id),
      ]);
      const details = await deps.kpi.indicatorsByIdAsSystem([
        ...new Set([...measured.map((row) => row.id), ...effective.map((row) => row.indicatorId)]),
      ]);
      const byId = new Map(details.map((row) => [row.id, row]));

      let wanted: Set<string> | undefined;
      if (query.indicators !== undefined) {
        const choices: IndicatorChoice[] = details.map((row) => ({
          indicatorId: row.id,
          name: row.name,
        }));
        wanted = new Set();
        query.indicators.forEach((reference, index) => {
          const found = resolveIndicatorRef(choices, reference);
          if (found.ok) wanted!.add(found.indicatorId);
          else problems.push(queryProblem('indicators', `value ${index + 1} ${found.problem}`));
        });
      }
      if (problems.length > 0) throw new Invalid('The request is not valid.', problems);

      // The order within a month is the order of the names, which this module does not hold in a column it may sort by: rank the
      // few indicators of the service in memory and let the database sort by that rank. Period first, so it holds across pages.
      const ranked = measured
        .map((row) => ({ id: row.id, name: byId.get(row.id)?.name ?? '' }))
        .filter((row) => wanted === undefined || wanted.has(row.id))
        .sort(byNameThenId)
        .map((row) => row.id);
      if (ranked.length === 0) return { rows: [], total: 0 };

      const where: SQL | undefined = and(
        eq(measurement.serviceId, service.id),
        inArray(measurement.indicatorId, ranked),
        start === undefined ? undefined : gte(measurement.period, start),
        stop === undefined ? undefined : lte(measurement.period, stop),
      );
      const rank = sql`array_position(array[${sql.join(
        ranked.map((id) => sql`${id}::uuid`),
        sql`, `,
      )}], ${measurement.indicatorId})`;
      const [[total], rows] = await Promise.all([
        db.select({ n: count() }).from(measurement).where(where),
        db
          .select({
            id: measurement.id,
            indicatorId: measurement.indicatorId,
            period: measurement.period,
            valueNumeric: measurement.valueNumeric,
            valueText: measurement.valueText,
          })
          .from(measurement)
          .where(where)
          .orderBy(asc(measurement.period), rank, asc(measurement.id))
          .limit(page.pageSize)
          .offset(page.page * page.pageSize),
      ]);
      return {
        total: total?.n ?? 0,
        rows: rows.map((row) => {
          const indicator = byId.get(row.indicatorId);
          return {
            id: row.id,
            indicatorId: row.indicatorId,
            iri: indicator?.iri ?? '',
            service: service.abbreviation,
            kpi: indicator?.name ?? '',
            ...present(indicator?.valueType, row),
            period: row.period,
            date: row.period,
          };
        }),
      };
    },

    async grid(actor, serviceId, period) {
      await deps.authz.require(actor, PERMISSION_MEASUREMENT_READ);
      await requireService(serviceId);
      const month = normalisePeriodBound(period);
      if (!month.ok)
        throw new Invalid('The request is not valid.', [queryProblem('period', month.problem)]);
      const effective = await deps.kpi.effectiveIndicatorsAsSystem(serviceId);
      const stored =
        effective.length === 0
          ? []
          : await db
              .select({
                id: measurement.id,
                indicatorId: measurement.indicatorId,
                valueNumeric: measurement.valueNumeric,
                valueText: measurement.valueText,
              })
              .from(measurement)
              .where(
                and(
                  eq(measurement.serviceId, serviceId),
                  eq(measurement.period, month.value),
                  inArray(
                    measurement.indicatorId,
                    effective.map((row) => row.indicatorId),
                  ),
                ),
              );
      const byIndicator = new Map(stored.map((row) => [row.indicatorId, row]));
      return {
        serviceId,
        period: month.value,
        rows: effective.map((row) => {
          const value = byIndicator.get(row.indicatorId);
          return {
            indicatorId: row.indicatorId,
            name: row.name,
            valueType: row.valueType,
            unit: row.unit,
            necessity: row.necessity,
            min: row.min,
            max: row.max,
            measurement: value ? { id: value.id, ...present(row.valueType, value) } : null,
          };
        }),
      };
    },

    async coverage(actor, serviceId, months = DEFAULT_COVERAGE_MONTHS) {
      await deps.authz.require(actor, PERMISSION_MEASUREMENT_READ);
      await requireService(serviceId);
      if (!Number.isInteger(months) || months < 1 || months > MAX_COVERAGE_MONTHS)
        throw new Invalid('The request is not valid.', [
          queryProblem('months', `must be a whole number from 1 to ${MAX_COVERAGE_MONTHS}`),
        ]);
      // The months end at the current one (UTC, the injected clock), oldest first.
      const now = deps.clock();
      const index = now.getUTCFullYear() * 12 + now.getUTCMonth();
      const periods = Array.from({ length: months }, (_, back) => {
        const at = index - (months - 1) + back;
        const year = Math.floor(at / 12);
        const month = (at % 12) + 1;
        return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(daysInMonth(year, month)).padStart(2, '0')}`;
      });
      const effective = await deps.kpi.effectiveIndicatorsAsSystem(serviceId);
      const mandatoryIds = effective
        .filter((row) => row.necessity === MANDATORY_NECESSITY)
        .map((row) => row.indicatorId);
      const counted = new Map<string, { reported: number; mandatoryReported: number }>();
      if (effective.length > 0) {
        const rows = await db
          .select({
            period: measurement.period,
            reported: count(),
            mandatoryReported:
              mandatoryIds.length === 0
                ? sql<number>`0`
                : sql<number>`count(*) filter (where ${inArray(measurement.indicatorId, mandatoryIds)})`,
          })
          .from(measurement)
          .where(
            and(
              eq(measurement.serviceId, serviceId),
              inArray(measurement.period, periods),
              inArray(
                measurement.indicatorId,
                effective.map((row) => row.indicatorId),
              ),
            ),
          )
          .groupBy(measurement.period);
        for (const row of rows)
          counted.set(row.period, {
            reported: Number(row.reported),
            mandatoryReported: Number(row.mandatoryReported),
          });
      }
      return periods.map((period) => {
        const here = counted.get(period) ?? { reported: 0, mandatoryReported: 0 };
        return {
          period,
          reported: here.reported,
          mandatory: mandatoryIds.length,
          mandatoryReported: here.mandatoryReported,
          complete: here.mandatoryReported === mandatoryIds.length,
        };
      });
    },
  };
}
