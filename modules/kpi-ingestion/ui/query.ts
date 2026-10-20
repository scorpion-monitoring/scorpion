// The address of the page: `?service=<id>&period=YYYY-MM&q=<search>`. A link (the reminder of sprint 5, a bookmark) opens the same view. Pure.
export interface SubmitQuery {
  /** The service, by id. */
  service: string | undefined;
  /** The month, `YYYY-MM`. */
  period: string | undefined;
  /** The search of the picker (name or abbreviation). */
  q: string | undefined;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MONTH = /^(\d{4})-(0[1-9]|1[0-2])$/;
export const MAX_SEARCH = 100;

/** Anything that is not a service id, a month or a search is dropped, never an error: the page just opens on what it understands. */
export function parseSubmitQuery(params: URLSearchParams): SubmitQuery {
  const service = params.get('service')?.trim().toLowerCase();
  const period = params.get('period')?.trim();
  const q = params.get('q')?.trim().slice(0, MAX_SEARCH);
  return {
    service: service && UUID.test(service) ? service : undefined,
    period: period && MONTH.test(period) ? period : undefined,
    q: q ? q : undefined,
  };
}

/** `?service=…&period=…`, the empty string for nothing. Keys come in a fixed order so equal views have equal addresses. */
export function submitQueryString(query: Partial<SubmitQuery>): string {
  const params = new URLSearchParams();
  if (query.service) params.set('service', query.service);
  if (query.period) params.set('period', query.period);
  if (query.q) params.set('q', query.q);
  const text = params.toString();
  return text ? `?${text}` : '';
}
