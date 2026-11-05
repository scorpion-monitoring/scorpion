// The row of the yearly table for one service and one year (M12 sprint 2), computed live from the evaluation and the measurements. The state is
// one of four and exclusive; each says in words what to do and none is a blank. The current evaluation applies to every year (decision 17): a
// service whose KPI set changed during the year is read with today's headline. One series read per service, never one per month.
import type { EvaluationOfService, ValueTypeEntry } from '@scorpion/kpi-framework/public';
import type { SeriesPoint } from '@scorpion/kpi-ingestion/public';
import { alignToMonths } from '@scorpion/kpi-analytics/public';
import { monthEnds, yearFigure, type AggregateFn } from './year.ts';

export type RowState = 'ok' | 'no-data' | 'no-evaluation' | 'error';

/** Why a row is in its state: a stable code for a page to translate; `advice` is the same in English. */
export type RowReason =
  | 'ok'
  | 'no-values'
  | 'no-set'
  | 'no-headline'
  | 'not-numeric'
  | 'value-type-unknown'
  | 'aggregate-not-allowed'
  | 'aggregate-unknown'
  | 'read-failed';

const ADVICE: Record<RowReason, string> = {
  ok: '',
  'no-values':
    'No value was reported for the headline KPI in this year: ask the service to report its values.',
  'no-set': 'This service has no KPI set: ask an administrator or the service to choose its KPIs.',
  'no-headline':
    'The KPI set of this service has no headline: ask an administrator to set the evaluation of the set.',
  'not-numeric':
    'The headline KPI is a text, which cannot be summed up: ask an administrator to choose a numeric KPI as the headline.',
  'value-type-unknown':
    'The value type of the headline KPI is not known to this instance: ask an administrator to check the KPI.',
  'aggregate-not-allowed':
    'The aggregate of the headline does not fit the value type of its KPI: ask an administrator to change the evaluation of the set.',
  'aggregate-unknown':
    'The aggregate of the headline has no function on this instance: ask an administrator to change the evaluation of the set.',
  'read-failed':
    'The figures of this service could not be read: try again, and ask an administrator if it stays.',
};

export interface RowHeadline {
  indicatorId: string;
  name: string;
  unit: string | null;
  /** A term of the vocabulary `aggregate`. */
  aggregate: string;
  /** The vocabulary's label of the aggregate in the caller's language, or its key when the vocabulary lacks it. */
  label: string;
}

export interface ImpactRow {
  serviceId: string;
  name: string;
  slug: string;
  state: RowState;
  reason: RowReason;
  advice: string;
  headline: RowHeadline | null;
  /** Twelve entries, January first: the stored value of the month or `null` (a gap, never zero). Durations are seconds. */
  months: (number | null)[];
  yearly: number | null;
  monthsWithValue: number;
}

export interface RowDeps {
  evaluationOf(serviceId: string): Promise<EvaluationOfService | null>;
  valueType(id: string): ValueTypeEntry | undefined;
  aggregate(id: string): AggregateFn | undefined;
  aggregateLabel(id: string): string;
  series(
    serviceId: string,
    indicatorIds: readonly string[],
    fromPeriod: string,
    toPeriod: string,
  ): Promise<SeriesPoint[]>;
  /** Told of the exception behind an `error` row, for the log. */
  onError?: ((error: unknown, serviceId: string) => void) | undefined;
}

export interface ServiceRef {
  id: string;
  name: string;
  slug: string;
}

const empty = (): (number | null)[] => Array.from({ length: 12 }, () => null);

/** The row of one service for a year. Never throws: a failure of this service is its `error` row and the page goes on. */
export async function computeRow(
  deps: RowDeps,
  service: ServiceRef,
  year: number,
): Promise<ImpactRow> {
  const row = (
    state: RowState,
    reason: RowReason,
    headline: RowHeadline | null,
    months = empty(),
    figure = { yearly: null as number | null, monthsWithValue: 0 },
  ): ImpactRow => ({
    serviceId: service.id,
    name: service.name,
    slug: service.slug,
    state,
    reason,
    advice: ADVICE[reason],
    headline,
    months,
    ...figure,
  });

  try {
    const found = await deps.evaluationOf(service.id);
    if (found === null) return row('no-evaluation', 'no-set', null);
    if (found.headline === null) return row('no-evaluation', 'no-headline', null);
    const { indicatorId, name, unit, valueType, aggregate } = found.headline;
    const headline: RowHeadline = {
      indicatorId,
      name,
      unit,
      aggregate,
      label: deps.aggregateLabel(aggregate),
    };

    const type = deps.valueType(valueType);
    if (!type) return row('error', 'value-type-unknown', headline);
    if (!type.numeric) return row('error', 'not-numeric', headline);
    if (!type.aggregates.includes(aggregate))
      return row('error', 'aggregate-not-allowed', headline);
    const apply = deps.aggregate(aggregate);
    if (!apply) return row('error', 'aggregate-unknown', headline);

    const ends = monthEnds(year);
    if (ends.length !== 12) return row('error', 'read-failed', headline);
    // One read for the whole year. The series read does not look at the KPI set, so a value of a KPI the service has since dropped is read too.
    const points = await deps.series(
      service.id,
      [indicatorId],
      ends[0]!.slice(0, 7),
      ends[11]!.slice(0, 7),
    );
    const months = alignToMonths(
      ends,
      points
        .filter((point) => point.indicatorId === indicatorId)
        .map((point) => ({ period: point.period, value: point.valueNumber })),
    );
    const figure = yearFigure(months, apply);
    return figure.monthsWithValue === 0
      ? row('no-data', 'no-values', headline, months, figure)
      : row('ok', 'ok', headline, months, figure);
  } catch (error) {
    deps.onError?.(error, service.id);
    // The reason is a code; an exception's text can hold anything, so none is shown.
    return row('error', 'read-failed', null);
  }
}
