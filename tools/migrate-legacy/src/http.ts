// The client of the legacy REST API: GET only, the API key in the header `X-API-Key`, retries with backoff for the
// answers that may pass (429, 5xx, a lost connection, a timeout). The key is held in a closure and never put into an
// error, a log line or a file; the lines it logs name the path and the query only.

export const RETRY_STATUSES: ReadonlySet<number> = new Set([429, 500, 502, 503, 504]);

export class LegacyApiError extends Error {
  readonly status: number | undefined;
  constructor(message: string, status?: number) {
    super(message);
    this.status = status;
  }
}

export interface LegacyClientOptions {
  baseUrl: string;
  key: string;
  fetch?: typeof fetch;
  /** Attempts per request, the first included. Default 5. */
  attempts?: number;
  /** The wait before the second attempt; it doubles each time. Default 1 s. */
  backoffMs?: number;
  /** Per attempt. Default 120 s (a long measurement history is one large answer). */
  timeoutMs?: number;
  sleep?: (ms: number) => Promise<void>;
  /** One line per request, for the operator: the path and the query, never a header. */
  log?: (line: string) => void;
}

export interface LegacyClient {
  /** The normalised base URL (no credentials, query or fragment), as the manifest records it. */
  readonly baseUrl: string;
  get(path: string, query?: Readonly<Record<string, string | number>>): Promise<unknown>;
}

/** Checks and normalises the base URL: http(s), no user info, no query, no fragment, no trailing slash. */
export function normaliseBaseUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new LegacyApiError(`--from is not a URL.`);
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new LegacyApiError('--from must be an http or https URL.');
  }
  if (url.username || url.password) {
    throw new LegacyApiError(
      '--from must not hold credentials; the key comes from LEGACY_API_KEY.',
    );
  }
  if (url.search || url.hash)
    throw new LegacyApiError('--from must not have a query or a fragment.');
  return `${url.origin}${url.pathname.replace(/\/+$/, '')}`;
}

const defaultSleep = (ms: number) => new Promise<void>((done) => setTimeout(done, ms));

export function createLegacyClient(options: LegacyClientOptions): LegacyClient {
  const baseUrl = normaliseBaseUrl(options.baseUrl);
  const key = options.key;
  if (!key) throw new LegacyApiError('LEGACY_API_KEY is empty.');
  const doFetch = options.fetch ?? fetch;
  const attempts = Math.max(1, options.attempts ?? 5);
  const backoff = options.backoffMs ?? 1000;
  const timeoutMs = options.timeoutMs ?? 120_000;
  const sleep = options.sleep ?? defaultSleep;
  const log = options.log ?? (() => {});

  return {
    baseUrl,
    async get(path, query = {}) {
      const search = new URLSearchParams(
        Object.entries(query).map(([name, value]): [string, string] => [name, String(value)]),
      ).toString();
      const shown = search ? `${path}?${search}` : path;
      let last = 'no answer';
      for (let attempt = 1; attempt <= attempts; attempt++) {
        let response: Response;
        try {
          response = await doFetch(`${baseUrl}${shown}`, {
            method: 'GET',
            headers: { 'X-API-Key': key, Accept: 'application/json' },
            redirect: 'error',
            signal: AbortSignal.timeout(timeoutMs),
          });
        } catch (error) {
          last = (error as Error).name === 'TimeoutError' ? 'timed out' : 'no connection';
          log(`GET ${shown}: ${last} (attempt ${attempt} of ${attempts})`);
          if (attempt < attempts) await sleep(backoff * 2 ** (attempt - 1));
          continue;
        }
        if (response.ok) {
          const body: unknown = await response.json().catch(() => {
            throw new LegacyApiError(`GET ${shown} answered ${response.status} without JSON.`);
          });
          log(`GET ${shown}: ${response.status}`);
          return body;
        }
        await response.body?.cancel().catch(() => {});
        if (response.status === 401 || response.status === 403) {
          throw new LegacyApiError(
            `GET ${shown} was refused (${response.status}): the legacy API did not accept LEGACY_API_KEY.`,
            response.status,
          );
        }
        if (!RETRY_STATUSES.has(response.status)) {
          throw new LegacyApiError(`GET ${shown} answered ${response.status}.`, response.status);
        }
        last = String(response.status);
        log(`GET ${shown}: ${response.status} (attempt ${attempt} of ${attempts})`);
        if (attempt < attempts) {
          const retryAfter = Number(response.headers.get('retry-after'));
          const wait = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 0;
          await sleep(Math.min(Math.max(wait, backoff * 2 ** (attempt - 1)), 60_000));
        }
      }
      throw new LegacyApiError(`GET ${shown} failed after ${attempts} attempts (${last}).`);
    },
  };
}
