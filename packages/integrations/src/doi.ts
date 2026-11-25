// The DOI resolver: the metadata of a DOI by content negotiation at doi.org (CSL-JSON), for the publications of
// `bibliometrics` (ADR-0056). A 5 second deadline for the whole lookup, at most five redirects and only to `https:`, a
// body size cap, a shape check (an HTML page is a failure, not data), bounds on every parsed field, one retry with
// backoff on 429 and 5xx, and a stub for tests. No dependency: it uses Node's `fetch`.
//
// The DOI is checked by `normaliseDoi` before any request and put into the path segment by segment, so what a person
// types cannot choose the host. Nothing here logs: a failure is a fixed `reason` code, never a URL.

/** The longest DOI accepted, after normalisation. */
export const DOI_MAX_LENGTH = 256;
/** The longest input `normaliseDoi` looks at (a DOI with a URL prefix around it). */
export const DOI_MAX_INPUT_LENGTH = 512;
export const DOI_RESOLVER_URL = 'https://doi.org/';
export const DOI_ACCEPT = 'application/vnd.citationstyles.csl+json';
export const DOI_TIMEOUT_MS = 5000;
export const DOI_MAX_REDIRECTS = 5;
/** A CSL-JSON record of a large consortium paper with every reference is about 300 KB; anything beyond 1 MiB is not one. */
export const DOI_MAX_BODY_BYTES = 1024 * 1024;
export const DOI_ATTEMPTS = 2;
export const DOI_BACKOFF_MS = 250;

/** Bounds of the parsed fields. */
export const DOI_MAX_TITLE = 1000;
export const DOI_MAX_AUTHORS = 100;
export const DOI_MAX_AUTHOR_NAME = 200;
export const DOI_MAX_CONTAINER = 500;
export const DOI_MAX_TYPE = 64;

// `10.` + a registrant code of digits (sub-codes after dots) + `/` + a suffix of visible characters.
const DOI_PATTERN = /^10\.\d{4,9}(?:\.\d+)*\/[^\s/][^\s]*$/u;
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/u;
const PREFIXES = [
  'https://doi.org/',
  'http://doi.org/',
  'https://dx.doi.org/',
  'http://dx.doi.org/',
  'doi.org/',
  'dx.doi.org/',
  'doi:',
];

export type NormalisedDoi = { ok: true; doi: string } | { ok: false; problem: string };

/**
 * The DOI in its stored form: without a `https://doi.org/`, `http://dx.doi.org/`, `doi.org/` or `doi:` prefix (any
 * case), trimmed and lower-cased (DOIs are case-insensitive). A DOI given as a URL loses its fragment and is
 * percent-decoded. Anything that is not `10.<registrant>/<suffix>` of at most 256 characters without whitespace is refused.
 */
export function normaliseDoi(input: unknown): NormalisedDoi {
  if (typeof input !== 'string') return { ok: false, problem: 'must be a DOI' };
  if (input.length > DOI_MAX_INPUT_LENGTH)
    return { ok: false, problem: `must be at most ${DOI_MAX_LENGTH} characters` };
  let value = input.trim();
  const lower = value.toLowerCase();
  const prefix = PREFIXES.find((candidate) => lower.startsWith(candidate));
  if (prefix) {
    value = value.slice(prefix.length);
    if (prefix.includes('/')) {
      // A URL: the fragment is not part of the DOI, and the path may be percent-encoded.
      const hash = value.indexOf('#');
      if (hash >= 0) value = value.slice(0, hash);
      if (value.includes('?')) return { ok: false, problem: 'must not carry a query' };
      try {
        value = decodeURIComponent(value);
      } catch {
        return { ok: false, problem: 'must be a DOI such as 10.1234/abc' };
      }
    }
    value = value.trim();
  }
  value = value.toLowerCase();
  if (value.length > DOI_MAX_LENGTH)
    return { ok: false, problem: `must be at most ${DOI_MAX_LENGTH} characters` };
  if (CONTROL.test(value) || !DOI_PATTERN.test(value))
    return { ok: false, problem: 'must be a DOI such as 10.1234/abc' };
  return { ok: true, doi: value };
}

/** The address of a (normalised) DOI at doi.org; each path segment is encoded, so the host is always doi.org. */
export function doiUrl(doi: string): string {
  return DOI_RESOLVER_URL + doi.split('/').map(encodeURIComponent).join('/');
}

/** When a work was issued, at the precision the agency knows: `2020`, `2020-09` or `2020-09-16`. */
export interface DoiIssued {
  date: string;
  precision: 'year' | 'month' | 'day';
}

export interface DoiMetadata {
  title: string;
  /** Display names, in the agency's order, at most 100. */
  authors: string[];
  issued: DoiIssued | null;
  /** The journal, or the repository (DataCite's `publisher`, such as Zenodo) when there is no container. */
  container: string | null;
  /** The CSL type (`journal-article`, `software`, `dataset`, ...). */
  type: string | null;
}

/** Why a lookup failed. A fixed code, safe to log and store; never a URL or a body. */
export type DoiFailure =
  | 'timeout'
  | 'network'
  | 'redirect-refused'
  | 'too-many-redirects'
  | 'too-large'
  | 'not-csl-json'
  | 'unexpected-shape'
  | 'unavailable'
  | 'http-error'
  | 'invalid-doi';

export type DoiResult =
  | { status: 'ok'; metadata: DoiMetadata }
  | { status: 'not-found' }
  | { status: 'failed'; reason: DoiFailure };

export interface DoiResolver {
  /** Never throws: a failure is `{ status: 'failed', reason }`. */
  resolve(doi: string, options?: { signal?: AbortSignal }): Promise<DoiResult>;
}

// ----- CSL-JSON --------------------------------------------------------------------------------

const ENTITIES: Record<string, string> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
};

/** One line of display text: markup tags removed (Crossref titles carry `<i>`), whitespace collapsed, cut at `max`. */
function cleanText(value: unknown, max: number): string | null {
  const raw = Array.isArray(value) ? value.find((item) => typeof item === 'string') : value;
  if (typeof raw !== 'string') return null;
  const text = raw
    .slice(0, max * 4)
    .replace(/<[^>]{0,200}>/g, '')
    .replace(/&(?:amp|lt|gt|quot|#39);/g, (entity) => ENTITIES[entity] ?? entity)
    .replace(/[\u0000-\u001f\u007f-\u009f]/gu, ' ') // eslint-disable-line no-control-regex
    .replace(/\s+/gu, ' ')
    .trim();
  if (text === '') return null;
  return [...text].slice(0, max).join('');
}

function authorName(entry: unknown): string | null {
  if (typeof entry !== 'object' || entry === null) return null;
  const { literal, given, family, name } = entry as Record<string, unknown>;
  const whole = cleanText(literal, DOI_MAX_AUTHOR_NAME) ?? cleanText(name, DOI_MAX_AUTHOR_NAME);
  if (whole) return whole;
  const parts = [cleanText(given, DOI_MAX_AUTHOR_NAME), cleanText(family, DOI_MAX_AUTHOR_NAME)];
  const joined = parts.filter((part): part is string => part !== null).join(' ');
  return joined === '' ? null : [...joined].slice(0, DOI_MAX_AUTHOR_NAME).join('');
}

const pad = (n: number) => String(n).padStart(2, '0');

function datePart(value: unknown): number | undefined {
  const n = typeof value === 'string' && /^\d{1,4}$/.test(value) ? Number(value) : value;
  return typeof n === 'number' && Number.isInteger(n) ? n : undefined;
}

/** `issued.date-parts[0]`: a year from 1000 to 9999, then a month and a day if they make a real date. */
export function parseIssued(issued: unknown): DoiIssued | null {
  if (typeof issued !== 'object' || issued === null) return null;
  const parts = (issued as { 'date-parts'?: unknown })['date-parts'];
  if (!Array.isArray(parts) || !Array.isArray(parts[0])) return null;
  const [y, m, d] = (parts[0] as unknown[]).map(datePart);
  if (y === undefined || y < 1000 || y > 9999) return null;
  if (m === undefined || m < 1 || m > 12) return { date: String(y), precision: 'year' };
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  if (d === undefined || d < 1 || d > days) return { date: `${y}-${pad(m)}`, precision: 'month' };
  return { date: `${y}-${pad(m)}-${pad(d)}`, precision: 'day' };
}

/**
 * Reads a CSL-JSON record: `undefined` when it is not one (not an object, or no title), so a changed format or an
 * error document counts as a failed lookup. Every field is bounded.
 */
export function parseCslJson(raw: unknown): DoiMetadata | undefined {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return undefined;
  const record = raw as Record<string, unknown>;
  const title = cleanText(record.title, DOI_MAX_TITLE);
  if (!title) return undefined;
  const authors: string[] = [];
  if (Array.isArray(record.author)) {
    for (const entry of record.author.slice(0, DOI_MAX_AUTHORS * 2)) {
      const name = authorName(entry);
      if (name) authors.push(name);
      if (authors.length === DOI_MAX_AUTHORS) break;
    }
  }
  const type =
    typeof record.type === 'string' && /^[a-z][a-z0-9-]{0,63}$/.test(record.type)
      ? record.type
      : null;
  return {
    title,
    authors,
    issued: parseIssued(record.issued),
    container:
      cleanText(record['container-title'], DOI_MAX_CONTAINER) ??
      cleanText(record.publisher, DOI_MAX_CONTAINER),
    type,
  };
}

// ----- The resolver ------------------------------------------------------------------------------

export interface DoiResolverOptions {
  fetch?: typeof fetch;
  /** The deadline of one lookup, every redirect and retry included. */
  timeoutMs?: number;
  maxRedirects?: number;
  maxBodyBytes?: number;
  attempts?: number;
  backoffMs?: number;
  /** For tests: replaces the wait between attempts. */
  sleep?: (ms: number) => Promise<void>;
}

class Failed extends Error {
  readonly reason: DoiFailure;
  constructor(reason: DoiFailure) {
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

const isJsonType = (contentType: string | null) =>
  contentType !== null && /^application\/(?:vnd\.citationstyles\.csl\+)?json\b/i.test(contentType);

const retryable = (status: number) => status === 429 || status >= 500;

/** `Retry-After` in milliseconds (seconds or an HTTP date), or `undefined`. */
function retryAfter(value: string | null): number | undefined {
  if (value === null) return undefined;
  if (/^\d{1,6}$/.test(value.trim())) return Number(value.trim()) * 1000;
  const at = Date.parse(value);
  return Number.isNaN(at) ? undefined : Math.max(at - Date.now(), 0);
}

export function createDoiResolver(options: DoiResolverOptions = {}): DoiResolver {
  const doFetch = options.fetch ?? fetch;
  const timeoutMs = options.timeoutMs ?? DOI_TIMEOUT_MS;
  const maxRedirects = options.maxRedirects ?? DOI_MAX_REDIRECTS;
  const maxBody = options.maxBodyBytes ?? DOI_MAX_BODY_BYTES;
  const attempts = Math.max(options.attempts ?? DOI_ATTEMPTS, 1);
  const backoff = options.backoffMs ?? DOI_BACKOFF_MS;
  const sleep =
    options.sleep ?? ((ms: number) => new Promise<void>((done) => setTimeout(done, ms)));

  /** One walk from doi.org through the redirects. `retry` carries the wait a 429 or 5xx asked for. */
  async function walk(
    doi: string,
    signal: AbortSignal,
  ): Promise<DoiResult | { retry: number | undefined }> {
    let url = new URL(doiUrl(doi));
    for (let hop = 0; ; hop++) {
      const response = await doFetch(url, {
        redirect: 'manual',
        headers: { accept: DOI_ACCEPT, 'user-agent': 'scorpion-doi-resolver' },
        signal,
      });
      if (response.status >= 300 && response.status < 400) {
        await response.body?.cancel();
        const location = response.headers.get('location');
        if (!location) throw new Failed('http-error');
        if (hop + 1 > maxRedirects) throw new Failed('too-many-redirects');
        let next: URL;
        try {
          next = new URL(location, url);
        } catch {
          throw new Failed('redirect-refused');
        }
        if (next.protocol !== 'https:' || next.username !== '' || next.password !== '')
          throw new Failed('redirect-refused');
        url = next;
        continue;
      }
      if (response.ok) {
        if (!isJsonType(response.headers.get('content-type'))) {
          await response.body?.cancel();
          throw new Failed('not-csl-json');
        }
        const body = await readCapped(response, maxBody);
        let parsed: unknown;
        try {
          parsed = JSON.parse(body);
        } catch {
          throw new Failed('not-csl-json');
        }
        const metadata = parseCslJson(parsed);
        if (!metadata) throw new Failed('unexpected-shape');
        return { status: 'ok', metadata };
      }
      await response.body?.cancel();
      // doi.org itself says the DOI does not exist. A 404 of an agency after a redirect is a registered DOI whose
      // metadata the agency did not give: that is a failure, retried later, not "not found".
      if (response.status === 404 && hop === 0) return { status: 'not-found' };
      if (retryable(response.status))
        return { retry: retryAfter(response.headers.get('retry-after')) };
      throw new Failed('http-error');
    }
  }

  return {
    async resolve(doi, resolveOptions) {
      const checked = normaliseDoi(doi);
      if (!checked.ok) return { status: 'failed', reason: 'invalid-doi' };
      const deadline = AbortSignal.timeout(timeoutMs);
      const signal = resolveOptions?.signal
        ? AbortSignal.any([deadline, resolveOptions.signal])
        : deadline;
      const started = Date.now();
      try {
        for (let attempt = 0; attempt < attempts; attempt++) {
          const result = await walk(checked.doi, signal);
          if (!('retry' in result)) return result;
          if (attempt + 1 >= attempts) break;
          const wait = result.retry ?? backoff * 2 ** attempt;
          // A wait past the deadline is not worth starting.
          if (Date.now() - started + wait >= timeoutMs) break;
          await sleep(wait);
        }
        return { status: 'failed', reason: 'unavailable' };
      } catch (error) {
        if (error instanceof Failed) return { status: 'failed', reason: error.reason };
        if (signal.aborted) return { status: 'failed', reason: 'timeout' };
        return { status: 'failed', reason: 'network' };
      }
    },
  };
}

export interface StubDoiResolver extends DoiResolver {
  /** Every DOI asked, in order. Tests only. */
  readonly calls: readonly string[];
}

/**
 * The resolver for tests and for `NODE_ENV=test`: answers from `table` (by normalised DOI; a `DoiMetadata` is an
 * `ok` answer) and says `not-found` for anything else. Never touches the network.
 */
export function createStubDoiResolver(
  table: Readonly<Record<string, DoiMetadata | DoiResult>> = {},
): StubDoiResolver {
  const calls: string[] = [];
  const keyOf = (doi: string) => {
    const checked = normaliseDoi(doi);
    return checked.ok ? checked.doi : doi;
  };
  const entries = new Map<string, DoiResult>(
    Object.entries(table).map(([doi, answer]) => [
      keyOf(doi),
      'status' in answer ? answer : { status: 'ok', metadata: answer },
    ]),
  );
  return {
    calls,
    resolve(doi) {
      calls.push(doi);
      const checked = normaliseDoi(doi);
      if (!checked.ok) return Promise.resolve({ status: 'failed', reason: 'invalid-doi' });
      return Promise.resolve(entries.get(checked.doi) ?? { status: 'not-found' });
    },
  };
}
