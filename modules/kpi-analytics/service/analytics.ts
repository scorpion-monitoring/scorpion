// The reads of kpi.analytics (M11 sprint 3, ADR-0043): the series of a service and its summary. No table: the KPIs come from `kpi.framework`'s
// trusted reads, the values from `kpi.ingestion`'s trusted series read, the service from `registry.services`, the categories from the vocabulary
// `thematic-category`; the numbers come from the calculation library. Who may read: every holder of the plain `kpi.analytics.read` (the role
// `user`), for every service; the service checks it again after the route did. An answer holds no person, no run and no file name.
import { Invalid, Unauthorized, type Actor, type FieldProblem } from '@scorpion/contracts';
import type { AuthzService } from '@scorpion/core-authz/public';
import type { SettingsService } from '@scorpion/core-settings/public';
import type { ModuleContext } from '@scorpion/kernel';
import {
  THEMATIC_CATEGORY_VOCABULARY,
  UNIT_VOCABULARY,
  type KpiFrameworkPublic,
} from '@scorpion/kpi-framework/public';
import {
  MAX_INDICATOR_FILTER,
  MAX_SERIES_INDICATORS,
  resolveIndicatorRef,
  type KpiIngestionPublic,
} from '@scorpion/kpi-ingestion/public';
import type { ServicesPublic } from '@scorpion/registry-services/public';
import type { AnalyticsSettings } from '../settings-schema.ts';
import { alignToMonths, changePercent } from './calc/index.ts';
import { ALL_CATEGORIES, DEFAULTS_PREFERENCE, parseDefaults, type Defaults } from './defaults.ts';
import { buildTable } from './export-table.ts';
import type { ExporterEntry } from './exporters.ts';
import { PERMISSION_EXPORT, PERMISSION_READ } from './permissions.ts';
import { parseRange, repairRange, windowOf, type Range } from './range.ts';
import {
  AGGREGATE_AVERAGE,
  SCORE_VOLATILITY,
  type AggregateEntry,
  type ScoreEntry,
} from './registries.ts';

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface AnalyticsQuery {
  /** The id of a service. */
  service: string;
  /** `3m`, `6m`, `1y`, `2y` or `all`; missing means `1y`, anything else is a 422. */
  range?: string | undefined;
  /** A key of the vocabulary `thematic-category`, or `all`; missing means every category. */
  category?: string | undefined;
  /** Ids or names (without case) of KPIs of the service. */
  indicators?: readonly string[] | undefined;
}

/** What describes a KPI in an answer. `current`: the service reports it now; `false`: it dropped it and its values stay. */
export interface IndicatorInfo {
  indicatorId: string;
  name: string;
  valueType: string;
  unit: string | null;
  /** A term of the vocabulary `thematic-category`. */
  thematic: string;
  /** A term of the vocabulary `necessity`; `null` for a KPI the service has dropped. */
  necessity: string | null;
  current: boolean;
}

/** One month of one KPI. A gap is `value: null, text: null`; a text value has `value: null` and its `text`; a number has no `text`. */
export interface SeriesPointOut {
  period: string;
  value: number | null;
  text: string | null;
}

export interface SeriesRow extends IndicatorInfo {
  /** One point per month of the window, oldest first. */
  points: SeriesPointOut[];
}

export interface SummaryRow extends IndicatorInfo {
  /** The points of the window, as the series read gives them, so one read serves the cards, the chart and the lists (ADR-0044). */
  points: SeriesPointOut[];
  /** The newest month of the window that has a value, with the canonical text of the value; `null` when none has. */
  latest: { period: string; value: number | null; text: string } | null;
  /** The change from the oldest to the newest value of the window, in percent; `null` ("n/a") when it is not defined. */
  change: number | null;
  average: number | null;
  /** The volatility (MAPE, a fraction) and its band. */
  volatility: { value: number | null; band: string | null };
}

export interface Page<T> {
  rows: T[];
  total: number;
  /** The window the answer covers. */
  range: Range;
  months: string[];
}

/** A file an export produced. The name comes from the service's abbreviation (its slug), never from free text. */
export interface ExportFile {
  fileName: string;
  mediaType: string;
  bytes: Uint8Array;
}

export interface DefaultsView extends Omit<Defaults, 'service'> {
  /** The default service, or `null` while there is none. */
  service: string | null;
  /** The thematic categories the filters offer: the one vocabulary read the reads use, in order. */
  categories: { key: string; label: string }[];
}

export interface AnalyticsService {
  /** Needs `kpi.analytics.read`. The points of the KPIs of a service in the window of a range, one per month, gaps as `null`. */
  series(
    actor: Actor,
    query: AnalyticsQuery,
    page: { page: number; pageSize: number },
  ): Promise<Page<SeriesRow>>;
  /** Needs `kpi.analytics.read`. Per KPI: the latest value, the change %, the average and the volatility with its band. */
  summary(
    actor: Actor,
    query: AnalyticsQuery,
    page: { page: number; pageSize: number },
  ): Promise<Page<SummaryRow>>;
  /**
   * Needs `kpi.analytics.export`. The KPIs of a service in the window of a range as one table, written by the exporter `format` (a key of the
   * registry `analytics.exporter`; any other is a 422 naming `format`). At most 120 months and 200 KPIs, as the reads.
   */
  export(actor: Actor, query: AnalyticsQuery, format: string): Promise<ExportFile>;
  /** Needs `kpi.analytics.read`. The thematic categories a filter offers (the active terms of the vocabulary), in order. The one list the reads and the defaults use. */
  categories(actor: Actor): Promise<{ key: string; label: string }[]>;
  /** Needs `kpi.analytics.read`. The caller's own defaults, repaired, with the default service resolved and the categories a filter offers. */
  defaults(actor: Actor): Promise<DefaultsView>;
  /**
   * Trusted: no permission, no caller. The service a new widget of this person starts with: the first service of the person's providers by name,
   * or `null`. Never a service the person has no tie to.
   */
  defaultServiceOfAsSystem(userId: string): Promise<string | null>;
}

export interface AnalyticsDeps {
  authz: Pick<AuthzService, 'require'>;
  settings: Pick<SettingsService, 'listTerms' | 'getUserPreference'>;
  services: Pick<ServicesPublic, 'existsAsSystem' | 'findByIdsAsSystem' | 'listForPickerAsSystem'>;
  kpi: Pick<KpiFrameworkPublic, 'effectiveIndicatorsAsSystem' | 'indicatorsByIdAsSystem'>;
  reads: Pick<KpiIngestionPublic['reads'], 'seriesAsSystem' | 'measuredIndicatorsAsSystem'>;
  aggregates: ReadonlyMap<string, AggregateEntry>;
  scores: ReadonlyMap<string, ScoreEntry>;
  exporters: ReadonlyMap<string, ExporterEntry>;
  clock: () => Date;
}

const queryProblem = (path: string, message: string): FieldProblem => ({
  in: 'query',
  path,
  message,
});

/** Names without case, then the id: plain code-unit comparison, so no collation moves the order. */
function byNameThenId(
  a: { name: string; indicatorId: string },
  b: { name: string; indicatorId: string },
): number {
  const left = a.name.toLowerCase();
  const right = b.name.toLowerCase();
  return left < right
    ? -1
    : left > right
      ? 1
      : a.indicatorId < b.indicatorId
        ? -1
        : a.indicatorId > b.indicatorId
          ? 1
          : 0;
}

export function createAnalyticsService(
  ctx: Pick<ModuleContext<never, never, AnalyticsSettings>, 'settings'>,
  deps: AnalyticsDeps,
): AnalyticsService {
  async function categoryTerms(): Promise<{ key: string; label: string }[]> {
    const terms = await deps.settings.listTerms(THEMATIC_CATEGORY_VOCABULARY);
    return terms.map((term) => ({ key: term.key, label: term.label }));
  }

  /** The window, the KPIs it asks about (filtered and ordered) and the page of them; the problems of the query are all named at once. */
  async function resolve(
    actor: Actor,
    query: AnalyticsQuery,
    page: { page: number; pageSize: number },
    permission: string = PERMISSION_READ,
  ) {
    await deps.authz.require(actor, permission);
    const problems: FieldProblem[] = [];
    if (
      typeof query.service !== 'string' ||
      !uuidPattern.test(query.service) ||
      !(await deps.services.existsAsSystem(query.service))
    )
      problems.push(queryProblem('service', 'must be the id of a service'));
    let range: Range = repairRange(undefined);
    if (query.range !== undefined) {
      const parsed = parseRange(query.range);
      if (parsed === undefined)
        problems.push(queryProblem('range', 'must be one of 3m, 6m, 1y, 2y, all'));
      else range = parsed;
    }
    let category: string | undefined;
    if (query.category !== undefined && query.category !== ALL_CATEGORIES) {
      const known = (await categoryTerms()).some((term) => term.key === query.category);
      if (!known) problems.push(queryProblem('category', 'must be a thematic category or all'));
      else category = query.category;
    }
    if ((query.indicators?.length ?? 0) > MAX_INDICATOR_FILTER)
      problems.push(queryProblem('indicators', `must name at most ${MAX_INDICATOR_FILTER} KPIs`));
    if (problems.length > 0) throw new Invalid('The request is not valid.', problems);

    const months = windowOf(range, deps.clock());
    const from = months[0]!;
    const to = months[months.length - 1]!;
    const [effective, measured] = await Promise.all([
      deps.kpi.effectiveIndicatorsAsSystem(query.service),
      deps.reads.measuredIndicatorsAsSystem(query.service, from, to),
    ]);
    const current = new Set(effective.map((row) => row.indicatorId));
    // A KPI the service has dropped keeps its values: they are shown, marked `current: false`.
    const droppedIds = measured.filter((id) => !current.has(id));
    const dropped =
      droppedIds.length === 0 ? [] : await deps.kpi.indicatorsByIdAsSystem(droppedIds);
    const all: IndicatorInfo[] = [
      ...effective.map((row) => ({
        indicatorId: row.indicatorId,
        name: row.name,
        valueType: row.valueType,
        unit: row.unit,
        thematic: row.thematic,
        necessity: row.necessity,
        current: true,
      })),
      ...dropped.map((row) => ({
        indicatorId: row.id,
        name: row.name,
        valueType: row.valueType,
        unit: row.unit,
        thematic: row.thematic,
        necessity: null,
        current: false,
      })),
    ].sort(byNameThenId);

    let wanted: Set<string> | undefined;
    if (query.indicators !== undefined) {
      const choices = all.map((row) => ({ indicatorId: row.indicatorId, name: row.name }));
      wanted = new Set();
      query.indicators.forEach((reference, index) => {
        const found = resolveIndicatorRef(choices, reference);
        if (found.ok) wanted!.add(found.indicatorId);
        else problems.push(queryProblem('indicators', `value ${index + 1} ${found.problem}`));
      });
      if (problems.length > 0) throw new Invalid('The request is not valid.', problems);
    }
    const chosen = all
      .filter((row) => category === undefined || row.thematic === category)
      .filter((row) => wanted === undefined || wanted.has(row.indicatorId))
      .slice(0, MAX_SERIES_INDICATORS);
    const start = page.page * page.pageSize;
    return { range, months, from, to, chosen, shown: chosen.slice(start, start + page.pageSize) };
  }

  /** The points of the shown KPIs, laid out on the months of the window. */
  async function laidOut(serviceId: string, shown: IndicatorInfo[], months: string[]) {
    const points =
      shown.length === 0
        ? []
        : await deps.reads.seriesAsSystem(
            serviceId,
            shown.map((row) => row.indicatorId),
            months[0]!,
            months[months.length - 1]!,
          );
    const byIndicator = new Map<string, typeof points>();
    for (const point of points) {
      const list = byIndicator.get(point.indicatorId) ?? [];
      list.push(point);
      byIndicator.set(point.indicatorId, list);
    }
    return (row: IndicatorInfo) => {
      const mine = byIndicator.get(row.indicatorId) ?? [];
      const numbers = alignToMonths(
        months,
        mine.map((point) => ({ period: point.period, value: point.valueNumber })),
      );
      const byMonth = new Map(mine.map((point) => [point.period, point]));
      return {
        numbers,
        byMonth,
        // One point per month of the window; a gap is `null`, a text value has its text and no number.
        points: months.map((period, index): SeriesPointOut => {
          const stored = byMonth.get(period);
          const value = numbers[index] ?? null;
          return {
            period,
            value,
            text: stored !== undefined && value === null ? stored.value : null,
          };
        }),
      };
    };
  }

  const userOf = (actor: Actor): string => {
    if (actor.kind !== 'user') throw new Unauthorized();
    return actor.userId;
  };

  async function defaultServiceOfAsSystem(userId: string): Promise<string | null> {
    // By name, then id; only the services whose provider has the person as an approved member. No tie, no default.
    const [first] = await deps.services.listForPickerAsSystem({ memberOf: userId, limit: 1 });
    return first?.id ?? null;
  }

  return {
    async series(actor, query, page) {
      const { range, months, chosen, shown } = await resolve(actor, query, page);
      const lay = await laidOut(query.service, shown, months);
      return {
        range,
        months,
        total: chosen.length,
        rows: shown.map((row) => ({ ...row, points: lay(row).points })),
      };
    },

    async summary(actor, query, page) {
      const { range, months, chosen, shown } = await resolve(actor, query, page);
      const lay = await laidOut(query.service, shown, months);
      const settings = await ctx.settings.get();
      const average = deps.aggregates.get(AGGREGATE_AVERAGE);
      const volatility = deps.scores.get(SCORE_VOLATILITY);
      return {
        range,
        months,
        total: chosen.length,
        rows: shown.map((row) => {
          const { numbers, byMonth, points } = lay(row);
          let latest: SummaryRow['latest'] = null;
          for (let index = months.length - 1; index >= 0 && latest === null; index--) {
            const stored = byMonth.get(months[index]!);
            if (stored)
              latest = { period: stored.period, value: numbers[index] ?? null, text: stored.value };
          }
          return {
            ...row,
            points,
            latest,
            change: changePercent(numbers),
            average: average ? average.apply(numbers) : null,
            volatility: volatility
              ? volatility.compute(numbers, settings)
              : { value: null, band: null },
          };
        }),
      };
    },

    async export(actor, query, format) {
      // The permission is checked first, so a caller without it learns nothing about formats, services or categories.
      await deps.authz.require(actor, PERMISSION_EXPORT);
      const exporter = typeof format === 'string' ? deps.exporters.get(format) : undefined;
      if (!exporter)
        throw new Invalid('The request is not valid.', [
          queryProblem('format', `must be one of ${[...deps.exporters.keys()].join(', ')}`),
        ]);
      // The same bounds as the reads: 120 months (the window) and 200 KPIs (all of them, not a page).
      const { range, months, chosen } = await resolve(
        actor,
        query,
        { page: 0, pageSize: MAX_SERIES_INDICATORS },
        PERMISSION_EXPORT,
      );
      const [lay, terms, [found]] = await Promise.all([
        laidOut(query.service, chosen, months),
        deps.settings.listTerms(UNIT_VOCABULARY),
        deps.services.findByIdsAsSystem([query.service]),
      ]);
      const unitLabel = new Map(terms.map((term) => [term.key, term.label]));
      const table = buildTable(
        chosen.map((row) => ({
          name: row.name,
          unit: row.unit === null ? null : (unitLabel.get(row.unit) ?? row.unit),
          points: lay(row).points,
        })),
      );
      const stem =
        (found?.slug ?? 'service')
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-+|-+$/g, '')
          .slice(0, 60) || 'service';
      return {
        fileName: `${stem}-kpis-${range}.${exporter.extension}`,
        mediaType: exporter.mediaType,
        bytes: await exporter.write(table),
      };
    },

    async categories(actor) {
      await deps.authz.require(actor, PERMISSION_READ);
      return categoryTerms();
    },

    async defaults(actor) {
      await deps.authz.require(actor, PERMISSION_READ);
      const userId = userOf(actor);
      const [terms, stored] = await Promise.all([
        categoryTerms(),
        deps.settings.getUserPreference(userId, DEFAULTS_PREFERENCE),
      ]);
      const parsed = parseDefaults(stored, new Set(terms.map((term) => term.key)));
      // A stored service that no longer exists is dropped; with none stored the first of the person's providers' services, else none.
      const kept =
        parsed.service !== undefined && (await deps.services.existsAsSystem(parsed.service))
          ? parsed.service
          : null;
      return {
        range: parsed.range,
        category: parsed.category,
        service: kept ?? (await defaultServiceOfAsSystem(userId)),
        categories: terms,
      };
    },

    defaultServiceOfAsSystem,
  };
}
