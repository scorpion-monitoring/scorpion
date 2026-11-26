// The OpenAlex adapter: the citation counts of DOIs (`cited_by_count`), for the citation refresh of `bibliometrics`
// (ADR-0056). One request per batch of at most 100 DOIs (OpenAlex's limit of values in one OR filter), a 5 second
// deadline per request, at most three attempts with backoff on 429 and 5xx honouring `Retry-After`, a body size cap, a
// shape check (an HTML page is a failure, not data), and a stub for tests. No dependency: it uses Node's `fetch`.
//
// The API key is optional (help.openalex.org, checked 2026-11-25: free, it raises the daily budget tenfold) and goes in
// the `Authorization` header, never in a URL. Nothing here logs: a failure is a fixed `reason` code, never a URL.
//
// `corpus=all`: OpenAlex leaves its "expansion" corpus out by default, and Zenodo records (the software DOIs that services
// cite most) usually live there; a lookup by DOI cannot match a wrong work, so the wider corpus costs nothing in quality and
// the same in budget.
import { normaliseDoi } from './doi.ts';

export const OPENALEX_WORKS_URL = 'https://api.openalex.org/works';
/** OpenAlex takes at most 100 values in one OR filter, and `per_page` is at most 100. */
export const OPENALEX_BATCH_SIZE = 100;
export const OPENALEX_TIMEOUT_MS = 5000;
export const OPENALEX_ATTEMPTS = 3;
export const OPENALEX_BACKOFF_MS = 500;
/** The longest wait a `Retry-After` may ask for before the batch is given up (OpenAlex asks about 1 s per-second limits). */
export const OPENALEX_MAX_RETRY_AFTER_MS = 30_000;
/** 100 results of `doi` and `cited_by_count` are about 10 KB; 1 MiB is far beyond any real answer. */
export const OPENALEX_MAX_BODY_BYTES = 1024 * 1024;

/** Why a batch failed. A fixed code, safe to log and store; never a URL, a key or a body. */
export type OpenAlexFailure =
  | 'timeout'
  | 'network'
  | 'too-large'
  | 'not-json'
  | 'unexpected-shape'
  | 'unavailable'
  | 'rate-limited'
  | 'key-refused'
  | 'http-error'
  | 'invalid-doi'
  | 'unsupported-doi'
  | 'incomplete';

export interface OpenAlexCounts {
  /** `cited_by_count` by normalised DOI, for the DOIs OpenAlex knows. */
  counts: Map<string, number>;
  /** The DOIs OpenAlex answered for and does not know. Never a zero: they have no count. */
  notFound: string[];
  /** The DOIs of batches that did not work, with the reason. Unknown, not zero, and not "not found" either. */
  failed: { dois: string[]; reason: OpenAlexFailure }[];
}

export interface OpenAlex {
  /**
   * The citation counts of `dois` (normalised or not; each is normalised, and duplicates are asked once). Split into
   * batches of at most 100, one request each. Never throws for a failed request: its DOIs are in `failed`.
   */
  citedByCount(
    dois: readonly string[],
    options?: { signal?: AbortSignal },
  ): Promise<OpenAlexCounts>;
}

export interface OpenAlexOptions {
  fetch?: typeof fetch;
  /** Optional. Sent as `Authorization: Bearer <key>`; never in the URL. */
  apiKey?: string | undefined;
  /** The deadline of one request (each attempt has its own). */
  timeoutMs?: number;
  attempts?: number;
  backoffMs?: number;
  maxBodyBytes?: number;
  /** For tests: replaces the wait between attempts. */
  sleep?: (ms: number) => Promise<void>;
}

class Failed extends Error {
  readonly reason: OpenAlexFailure;
  constructor(reason: OpenAlexFailure) {
    super(reason);
    this.reason = reason;
  }
}

/** The body as text, refused past `max` bytes (by `content-length` first, then while reading). */
async function readCapped(response: Response, max: number): Promise<string> {
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > max) {
    await response.body?.cancel();
    throw new Failed('too-large');
  }
  if (!response.body) return '';
  const reader = (response.body as ReadableStream<Uint8Array>).getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel();
      throw new Failed('too-large');
    }
    chunks.push(value);
  }
  return new TextDecoder().decode(Buffer.concat(chunks));
}

/** `Retry-After` in milliseconds (seconds or an HTTP date), or `undefined`. */
function retryAfter(value: string | null): number | undefined {
  if (value === null) return undefined;
  if (/^\d{1,6}$/.test(value.trim())) return Number(value.trim()) * 1000;
  const at = Date.parse(value);
  return Number.isNaN(at) ? undefined : Math.max(at - Date.now(), 0);
}

/** The address of one batch. The key is never part of it. */
export function openAlexWorksUrl(dois: readonly string[]): URL {
  const url = new URL(OPENALEX_WORKS_URL);
  url.searchParams.set('filter', `doi:${dois.join('|')}`);
  url.searchParams.set('select', 'doi,cited_by_count');
  url.searchParams.set('per_page', String(OPENALEX_BATCH_SIZE));
  url.searchParams.set('corpus', 'all');
  return url;
}

/**
 * Reads one answer: `undefined` when it is not `{ results: [{ doi, cited_by_count }] }`. A result whose DOI is not one we
 * asked for is ignored; two results for one DOI keep the higher count.
 */
export function parseWorks(
  raw: unknown,
  asked: ReadonlySet<string>,
): { counts: Map<string, number>; complete: boolean } | undefined {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return undefined;
  const { results, meta } = raw as { results?: unknown; meta?: unknown };
  if (!Array.isArray(results)) return undefined;
  const counts = new Map<string, number>();
  for (const item of results) {
    if (typeof item !== 'object' || item === null) return undefined;
    const { doi, cited_by_count: count } = item as Record<string, unknown>;
    if (typeof count !== 'number' || !Number.isSafeInteger(count) || count < 0) return undefined;
    if (doi === null) continue; // a work without a DOI cannot be one we asked for
    if (typeof doi !== 'string') return undefined;
    const checked = normaliseDoi(doi);
    if (!checked.ok || !asked.has(checked.doi)) continue;
    counts.set(checked.doi, Math.max(counts.get(checked.doi) ?? 0, count));
  }
  // More results than one page holds: the DOIs not on this page are unknown, not "not found".
  const total = (meta as { count?: unknown } | null | undefined)?.count;
  const complete = typeof total !== 'number' || total <= results.length;
  return { counts, complete };
}

/** A DOI that cannot stand in an OR filter: OpenAlex splits filter values on `|` and filters on `,`. */
const unsupported = (doi: string) => doi.includes('|') || doi.includes(',');

export function createOpenAlex(options: OpenAlexOptions = {}): OpenAlex {
  const doFetch = options.fetch ?? fetch;
  const timeoutMs = options.timeoutMs ?? OPENALEX_TIMEOUT_MS;
  const attempts = Math.max(options.attempts ?? OPENALEX_ATTEMPTS, 1);
  const backoff = options.backoffMs ?? OPENALEX_BACKOFF_MS;
  const maxBody = options.maxBodyBytes ?? OPENALEX_MAX_BODY_BYTES;
  const sleep =
    options.sleep ?? ((ms: number) => new Promise<void>((done) => setTimeout(done, ms)));
  const headers: Record<string, string> = {
    accept: 'application/json',
    'user-agent': 'scorpion-citation-refresh',
  };
  if (options.apiKey) headers.authorization = `Bearer ${options.apiKey}`;

  /** One attempt. `retry` carries the wait a 429 or 5xx asked for. */
  async function attempt(
    batch: readonly string[],
    signal: AbortSignal | undefined,
  ): Promise<
    | { counts: Map<string, number>; complete: boolean }
    | { retry: number | undefined; reason: OpenAlexFailure }
  > {
    const deadline = AbortSignal.timeout(timeoutMs);
    const combined = signal ? AbortSignal.any([deadline, signal]) : deadline;
    try {
      const response = await doFetch(openAlexWorksUrl(batch), {
        headers,
        redirect: 'error',
        signal: combined,
      });
      if (response.status === 429 || response.status >= 500) {
        await response.body?.cancel();
        return {
          retry: retryAfter(response.headers.get('retry-after')),
          reason: response.status === 429 ? 'rate-limited' : 'unavailable',
        };
      }
      if (response.status === 401 || response.status === 403) {
        await response.body?.cancel();
        throw new Failed('key-refused');
      }
      if (!response.ok) {
        await response.body?.cancel();
        throw new Failed('http-error');
      }
      if (!/^application\/json\b/i.test(response.headers.get('content-type') ?? '')) {
        await response.body?.cancel();
        throw new Failed('not-json');
      }
      const body = await readCapped(response, maxBody);
      let parsed: unknown;
      try {
        parsed = JSON.parse(body);
      } catch {
        throw new Failed('not-json');
      }
      const works = parseWorks(parsed, new Set(batch));
      if (!works) throw new Failed('unexpected-shape');
      return works;
    } catch (error) {
      if (error instanceof Failed) throw error;
      if (combined.aborted) throw new Failed('timeout');
      throw new Failed('network');
    }
  }

  async function askBatch(
    batch: readonly string[],
    signal: AbortSignal | undefined,
  ): Promise<{ counts: Map<string, number>; complete: boolean } | { reason: OpenAlexFailure }> {
    let reason: OpenAlexFailure = 'unavailable';
    for (let tried = 0; tried < attempts; tried++) {
      let result: Awaited<ReturnType<typeof attempt>>;
      try {
        result = await attempt(batch, signal);
      } catch (error) {
        return { reason: error instanceof Failed ? error.reason : 'network' };
      }
      if (!('retry' in result)) return result;
      reason = result.reason;
      if (tried + 1 >= attempts || signal?.aborted) break;
      const wait = result.retry ?? backoff * 2 ** tried;
      if (wait > OPENALEX_MAX_RETRY_AFTER_MS) break;
      await sleep(wait);
    }
    return { reason };
  }

  return {
    async citedByCount(dois, citedOptions) {
      const signal = citedOptions?.signal;
      const result: OpenAlexCounts = { counts: new Map(), notFound: [], failed: [] };
      const invalid: string[] = [];
      const odd: string[] = [];
      const wanted = new Set<string>();
      for (const raw of dois) {
        const checked = normaliseDoi(raw);
        if (!checked.ok) invalid.push(raw);
        else if (unsupported(checked.doi)) odd.push(checked.doi);
        else wanted.add(checked.doi);
      }
      if (invalid.length > 0) result.failed.push({ dois: invalid, reason: 'invalid-doi' });
      if (odd.length > 0) result.failed.push({ dois: odd, reason: 'unsupported-doi' });
      const all = [...wanted];
      for (let start = 0; start < all.length; start += OPENALEX_BATCH_SIZE) {
        const batch = all.slice(start, start + OPENALEX_BATCH_SIZE);
        if (signal?.aborted) {
          result.failed.push({ dois: batch, reason: 'timeout' });
          continue;
        }
        const answer = await askBatch(batch, signal);
        if ('reason' in answer) {
          result.failed.push({ dois: batch, reason: answer.reason });
          continue;
        }
        const missing: string[] = [];
        for (const doi of batch) {
          const count = answer.counts.get(doi);
          if (count === undefined) missing.push(doi);
          else result.counts.set(doi, count);
        }
        if (missing.length === 0) continue;
        if (answer.complete) result.notFound.push(...missing);
        else result.failed.push({ dois: missing, reason: 'incomplete' });
      }
      return result;
    },
  };
}

export interface StubOpenAlex extends OpenAlex {
  /** Every batch asked, in order (normalised DOIs). Tests only. */
  readonly calls: readonly string[][];
}

/**
 * The adapter for tests and for `NODE_ENV=test`: answers from `table` (normalised DOI → count) and says "not found" for
 * anything else, in batches of 100 like the real one. Never touches the network.
 */
export function createStubOpenAlex(table: Readonly<Record<string, number>> = {}): StubOpenAlex {
  const calls: string[][] = [];
  const known = new Map<string, number>();
  for (const [doi, count] of Object.entries(table)) {
    const checked = normaliseDoi(doi);
    known.set(checked.ok ? checked.doi : doi, count);
  }
  return {
    calls,
    citedByCount(dois) {
      const result: OpenAlexCounts = { counts: new Map(), notFound: [], failed: [] };
      const wanted = [
        ...new Set(dois.map((doi) => normaliseDoi(doi)).flatMap((c) => (c.ok ? [c.doi] : []))),
      ];
      for (let start = 0; start < wanted.length; start += OPENALEX_BATCH_SIZE) {
        const batch = wanted.slice(start, start + OPENALEX_BATCH_SIZE);
        calls.push(batch);
        for (const doi of batch) {
          const count = known.get(doi);
          if (count === undefined) result.notFound.push(doi);
          else result.counts.set(doi, count);
        }
      }
      return Promise.resolve(result);
    },
  };
}
