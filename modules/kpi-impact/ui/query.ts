// The address of the page: `?consortium=<id>&year=YYYY&unpublished=1&page=N`. A link opens the same view. Pure. Anything that is not understood is
// dropped, never an error: the page just opens on what it understands.
export interface EvaluateQuery {
  consortium: string | undefined;
  year: number | undefined;
  /** The switch of decision 16: count the unpublished services too. */
  includeUnpublished: boolean;
  /** From 0, as in the API. */
  page: number;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const YEAR = /^\d{4}$/;
const PAGE = /^\d{1,6}$/;

export function parseEvaluateQuery(params: URLSearchParams): EvaluateQuery {
  const consortium = params.get('consortium')?.trim().toLowerCase();
  const year = params.get('year')?.trim();
  const page = params.get('page')?.trim();
  return {
    consortium: consortium && UUID.test(consortium) ? consortium : undefined,
    year: year && YEAR.test(year) ? Number(year) : undefined,
    includeUnpublished: params.get('unpublished') === '1',
    page: page && PAGE.test(page) ? Number(page) : 0,
  };
}

/** `?consortium=…&year=…`, the empty string for nothing. Keys come in a fixed order so equal views have equal addresses. */
export function evaluateQueryString(query: Partial<EvaluateQuery>): string {
  const params = new URLSearchParams();
  if (query.consortium) params.set('consortium', query.consortium);
  if (query.year !== undefined) params.set('year', String(query.year));
  if (query.includeUnpublished) params.set('unpublished', '1');
  if (query.page) params.set('page', String(query.page));
  const text = params.toString();
  return text ? `?${text}` : '';
}
