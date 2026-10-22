// The shared read store of the dashboard (M11 sprint 4, ADR-0044). Every widget of a dashboard asks for its numbers through it: it keeps **one
// in-flight promise per distinct read**, so a dashboard of eight widgets over two (service, range) pairs sends two requests, not eight, and a
// change of one widget's range asks for its own key and nobody else's. A promise is kept for the visit (as long as the dashboard is on the page;
// the page makes a new store when it mounts, so a person who reports data and comes back sees it). A read that failed is forgotten at once, so
// "Try again" sends a new request. The pure part (the canonical key, the dedupe) has no browser and no Svelte, and is table-tested; the part
// that calls the API uses the typed client only.
import { getContext, setContext } from 'svelte';
import {
  unwrap,
  type AnalyticsDefaults,
  type AnalyticsSeries,
  type AnalyticsSummary,
  type ApiClient,
} from '@scorpion/contracts/client';

/**
 * How many KPIs one widget read asks for. It is one number for every widget, so widgets over the same (service, range, category) share one
 * request; the envelope's `totalCount` tells a widget that more exist (the server serves at most 200 of a service).
 */
export const WIDGET_PAGE_SIZE = 50;

export interface ReadQuery {
  /** The id of the service. */
  service: string;
  range: string;
  /** A key of the vocabulary `thematic-category`, or `all`. */
  category: string;
  /** The KPIs to ask for (ids or names); none means every KPI of the page. */
  indicators?: readonly string[] | undefined;
  /** 0-based; default 0. */
  page?: number | undefined;
  pageSize?: number | undefined;
}

/** What the read key and the request are made of, normalised: the same read always has the same key. */
export interface NormalisedQuery {
  service: string;
  range: string;
  category: string;
  indicators: string[];
  page: number;
  pageSize: number;
}

/**
 * The query as it is asked: the KPIs trimmed, without empty entries and duplicates, in a fixed order (the answer is in the server's order
 * either way, so two widgets naming the same KPIs in another order are one read); a page and size that are not whole numbers are the defaults.
 */
export function normalise(query: ReadQuery): NormalisedQuery {
  const whole = (value: number | undefined, fallback: number, min: number, max: number) =>
    typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max
      ? value
      : fallback;
  return {
    service: query.service,
    range: query.range,
    category: query.category,
    indicators: [
      ...new Set(
        (query.indicators ?? []).map((entry) => entry.trim()).filter((entry) => entry !== ''),
      ),
    ].sort(),
    page: whole(query.page, 0, 0, 10_000),
    pageSize: whole(query.pageSize, WIDGET_PAGE_SIZE, 1, 200),
  };
}

export type ReadKind = 'series' | 'summary';

/**
 * The key of a read: its kind and everything that changes its answer. JSON of a fixed field order, so no separator can be forged by a name
 * that holds one.
 */
export function readKey(kind: ReadKind, query: ReadQuery): string {
  const { service, range, category, indicators, page, pageSize } = normalise(query);
  return JSON.stringify([kind, service, range, category, indicators, page, pageSize]);
}

export interface Dedupe<T> {
  /** The promise of `key`; `run` is called only when there is none. A rejection is forgotten, so a later call runs again. */
  load(key: string, run: () => Promise<T>): Promise<T>;
  /** Forgets one key (a widget asks again). */
  forget(key: string): void;
  clear(): void;
  readonly size: number;
}

export function createDedupe<T>(): Dedupe<T> {
  const promises = new Map<string, Promise<T>>();
  return {
    load(key, run) {
      const known = promises.get(key);
      if (known) return known;
      const started = run();
      promises.set(key, started);
      // A failure is not cached; only the entry that is still this promise is removed (a newer one may have replaced it).
      started.catch(() => {
        if (promises.get(key) === started) promises.delete(key);
      });
      return started;
    },
    forget: (key) => void promises.delete(key),
    clear: () => promises.clear(),
    get size() {
      return promises.size;
    },
  };
}

export interface VocabularyTerm {
  key: string;
  labels: Record<string, string>;
  active: boolean;
}

/** What a widget shows of a service: its name (the heading tells two charts of two services apart) and its short name. */
export interface ServiceName {
  id: string;
  name: string;
  slug: string;
}

export interface AnalyticsReads {
  /** The name of a service (`GET /services/{id}`), read once per visit. */
  service(id: string): Promise<ServiceName>;
  /** The figures and the points of each KPI of a service in a window (`GET /kpi/analytics/summary`): one read for every widget. */
  summary(query: ReadQuery): Promise<AnalyticsSummary>;
  /** The points only (`GET /kpi/analytics/series`). */
  series(query: ReadQuery): Promise<AnalyticsSeries>;
  /** The caller's repaired defaults and the categories a filter offers (`GET /kpi/analytics/defaults`). */
  defaults(): Promise<AnalyticsDefaults>;
  /** The terms of a vocabulary (the labels of units), read once per visit. */
  terms(vocabulary: string): Promise<VocabularyTerm[]>;
  /** Forgets what is kept of one kind (the defaults after the dialog saved them) or of everything. */
  invalidate(what?: ReadKind | 'defaults' | 'terms' | 'service'): void;
}

/** The store over the typed client. Nothing here builds a URL: the client does. */
export function createAnalyticsReads(api: ApiClient): AnalyticsReads {
  const summaries = createDedupe<AnalyticsSummary>();
  const series = createDedupe<AnalyticsSeries>();
  const defaults = createDedupe<AnalyticsDefaults>();
  const vocabularies = createDedupe<VocabularyTerm[]>();
  const services = createDedupe<ServiceName>();
  const params = (query: ReadQuery) => {
    const one = normalise(query);
    return {
      service: one.service,
      range: one.range,
      category: one.category,
      page: String(one.page),
      pageSize: String(one.pageSize),
      ...(one.indicators.length > 0 ? { indicators: one.indicators.join(',') } : {}),
    };
  };
  return {
    summary: (query) =>
      summaries.load(readKey('summary', query), () =>
        unwrap(api.GET('/kpi/analytics/summary', { params: { query: params(query) } })),
      ),
    series: (query) =>
      series.load(readKey('series', query), () =>
        unwrap(api.GET('/kpi/analytics/series', { params: { query: params(query) } })),
      ),
    service: (id) =>
      services.load(id, async () => {
        const { name, slug } = await unwrap(
          api.GET('/services/{id}', { params: { path: { id } } }),
        );
        return { id, name, slug };
      }),
    defaults: () => defaults.load('defaults', () => unwrap(api.GET('/kpi/analytics/defaults'))),
    terms: (vocabulary) =>
      vocabularies.load(vocabulary, async () =>
        (
          await unwrap(
            api.GET('/vocabularies/{vocabulary}/terms', {
              params: { path: { vocabulary }, query: { page: '0', pageSize: '500' } },
            }),
          )
        ).result.map(({ key, labels, active }) => ({ key, labels, active })),
      ),
    invalidate(what) {
      if (what === undefined || what === 'summary') summaries.clear();
      if (what === undefined || what === 'series') series.clear();
      if (what === undefined || what === 'defaults') defaults.clear();
      if (what === undefined || what === 'terms') vocabularies.clear();
      if (what === undefined || what === 'service') services.clear();
    },
  };
}

const KEY = Symbol('scorpion.analytics-reads');

/** The dashboard makes one store when it mounts; the widgets in it read through it. */
export function setAnalyticsReads(reads: AnalyticsReads): void {
  setContext(KEY, reads);
}

export function getAnalyticsReads(): AnalyticsReads {
  const reads = getContext<AnalyticsReads | undefined>(KEY);
  if (!reads) throw new Error('getAnalyticsReads() needs a component inside the dashboard');
  return reads;
}
