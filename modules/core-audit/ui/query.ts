// What the address of the Logs page says, as plain functions: the filters of `GET /audit`. A value that
// is not valid is dropped, so a bookmarked or edited address never breaks the page. Dates are days (UTC).
export const LOG_METHODS = ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE'] as const;
export const LOG_OUTCOMES = ['ok', 'denied', 'error'] as const;
export const LOG_SOURCES = ['event', 'api'] as const;
export const LOG_PAGE_SIZE = 50;

export interface LogsQuery {
  method: (typeof LOG_METHODS)[number] | undefined;
  user: string | undefined;
  endpoint: string | undefined;
  action: string | undefined;
  outcome: (typeof LOG_OUTCOMES)[number] | undefined;
  source: (typeof LOG_SOURCES)[number] | undefined;
  /** `YYYY-MM-DD`, at or after the start of that day (UTC). */
  from: string | undefined;
  /** `YYYY-MM-DD`, up to the end of that day (UTC). */
  to: string | undefined;
}

export const EMPTY_QUERY: LogsQuery = {
  method: undefined,
  user: undefined,
  endpoint: undefined,
  action: undefined,
  outcome: undefined,
  source: undefined,
  from: undefined,
  to: undefined,
};

const oneOf = <T extends string>(list: readonly T[], value: string | null): T | undefined =>
  list.find((entry) => entry === value);

const text = (value: string | null, max: number): string | undefined => {
  const trimmed = value?.trim();
  return trimmed ? trimmed.slice(0, max) : undefined;
};

/** A real calendar day, not just a shape (`2026-02-31` is dropped). */
export function validDay(value: string | null | undefined): string | undefined {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value
    ? undefined
    : value;
}

export function parseLogsQuery(params: URLSearchParams): LogsQuery {
  return {
    method: oneOf(LOG_METHODS, params.get('method')),
    user: text(params.get('user'), 200),
    endpoint: text(params.get('endpoint'), 500),
    action: text(params.get('action'), 200),
    outcome: oneOf(LOG_OUTCOMES, params.get('outcome')),
    source: oneOf(LOG_SOURCES, params.get('source')),
    from: validDay(params.get('from')),
    to: validDay(params.get('to')),
  };
}

/** The address query for a state; what is not set is left out, so the plain list has a plain address. */
export function logsQueryString(query: LogsQuery): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries({ ...query } as Record<string, string | undefined>)) {
    if (value) params.set(key, value);
  }
  const text = params.toString();
  return text ? `?${text}` : '';
}

/** The query the API takes (every value a string, as the generated client types it). */
export function logsApiQuery(query: LogsQuery): Record<string, string> {
  const { from, to, ...rest } = query;
  const set = Object.entries(rest as Record<string, string | undefined>).filter(
    (entry): entry is [string, string] => !!entry[1],
  );
  return {
    ...Object.fromEntries(set),
    ...(from ? { from: `${from}T00:00:00.000Z` } : {}),
    ...(to ? { to: `${to}T23:59:59.999Z` } : {}),
  };
}

export const isFiltered = (query: LogsQuery): boolean =>
  Object.values(query).some((value) => value !== undefined);
