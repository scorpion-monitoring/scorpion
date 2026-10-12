// The SPDX license list, for the licence field of a service. A 5 second timeout, retry with backoff, a
// cache port (the caller stores the list, 24 hours), a bundled fallback copy for when the network and
// the cache both fail, and a stub for tests. No dependency: it uses Node's `fetch`.
//
// `has(id)` is true for current and deprecated ids: a deprecated licence is accepted and marked, not
// refused (a service that already carries it must stay editable).
import { BUNDLED_SPDX_ROWS, BUNDLED_SPDX_VERSION } from './spdx-bundled.generated.ts';

export interface SpdxLicense {
  /** The SPDX id in its canonical case, for example `Apache-2.0`. */
  id: string;
  name: string;
  osiApproved: boolean;
  deprecated: boolean;
}

/** The list as fetched, with the release it came from and when. */
export interface SpdxList {
  /** The `licenseListVersion`, for example `3.29.0`. */
  version: string;
  /** Milliseconds since the epoch. */
  fetchedAt: number;
  licenses: SpdxLicense[];
}

/** Where the caller keeps the fetched list between processes. A failing cache never fails a lookup. */
export interface SpdxCache {
  read(): Promise<SpdxList | undefined>;
  write(list: SpdxList): Promise<void>;
}

export interface Spdx {
  /** Licences whose id or name matches `query` without case: exact id, id prefix, id, then name; at most `limit`. */
  search(query: string, options?: { limit?: number }): Promise<SpdxLicense[]>;
  /** The licence with this id (any case), or `undefined`. */
  find(id: string): Promise<SpdxLicense | undefined>;
  /** True for a current or a deprecated id. */
  has(id: string): Promise<boolean>;
}

export const SPDX_URL =
  'https://raw.githubusercontent.com/spdx/license-list-data/main/json/licenses.json';
export const SPDX_TIMEOUT_MS = 5000;
export const SPDX_TTL_MS = 24 * 3600 * 1000;
export const SPDX_ATTEMPTS = 3;
export const SPDX_BACKOFF_MS = 200;
export const SPDX_DEFAULT_LIMIT = 20;
export const SPDX_MAX_LIMIT = 100;
/** The list is about 340 KB; anything far beyond that is not it. */
const MAX_BODY_CHARS = 5_000_000;

/**
 * Reads the `licenses.json` of the SPDX license-list-data repository: `undefined` when the shape is not
 * recognised, so an HTML error page or a changed format counts as a failed fetch.
 */
export function normaliseSpdxList(raw: unknown, fetchedAt = 0): SpdxList | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined;
  const { licenseListVersion, licenses } = raw as {
    licenseListVersion?: unknown;
    licenses?: unknown;
  };
  if (typeof licenseListVersion !== 'string' || !Array.isArray(licenses)) return undefined;
  const found = new Map<string, SpdxLicense>();
  for (const entry of licenses) {
    if (typeof entry !== 'object' || entry === null) continue;
    const { licenseId, name, isOsiApproved, isDeprecatedLicenseId } = entry as Record<
      string,
      unknown
    >;
    if (typeof licenseId !== 'string' || licenseId === '' || typeof name !== 'string') continue;
    found.set(licenseId.toLowerCase(), {
      id: licenseId,
      name,
      osiApproved: isOsiApproved === true,
      deprecated: isDeprecatedLicenseId === true,
    });
  }
  if (found.size === 0) return undefined;
  const sorted = [...found.values()].sort((a, b) => a.id.localeCompare(b.id, 'en'));
  return { version: licenseListVersion, fetchedAt, licenses: sorted };
}

/** The copy that ships with the code. */
export function bundledSpdxList(): SpdxList {
  return {
    version: BUNDLED_SPDX_VERSION,
    fetchedAt: 0,
    licenses: BUNDLED_SPDX_ROWS.map(([id, name, osi, deprecated]) => ({
      id,
      name,
      osiApproved: osi === 1,
      deprecated: deprecated === 1,
    })),
  };
}

/** Compares two dotted release numbers (`3.9.0` < `3.29.0`). */
export function compareReleases(a: string, b: string): number {
  const left = a.split('.').map(Number);
  const right = b.split('.').map(Number);
  for (let i = 0; i < Math.max(left.length, right.length); i++) {
    const difference = (left[i] ?? 0) - (right[i] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
}

function rank(license: SpdxLicense, needle: string): number {
  const id = license.id.toLowerCase();
  if (id === needle) return 0;
  if (id.startsWith(needle)) return 1;
  if (id.includes(needle)) return 2;
  if (license.name.toLowerCase().includes(needle)) return 3;
  return -1;
}

/** The search over a list; shared by the adapter and the stub. */
export function searchLicenses(
  list: readonly SpdxLicense[],
  query: string,
  limit = SPDX_DEFAULT_LIMIT,
): SpdxLicense[] {
  const max = Math.min(Math.max(Math.trunc(limit), 1), SPDX_MAX_LIMIT);
  const needle = query.trim().toLowerCase();
  if (needle === '') return list.filter((license) => !license.deprecated).slice(0, max);
  return list
    .map((license) => ({ license, rank: rank(license, needle) }))
    .filter((hit) => hit.rank >= 0)
    .sort(
      (a, b) =>
        a.rank - b.rank ||
        Number(a.license.deprecated) - Number(b.license.deprecated) ||
        a.license.id.localeCompare(b.license.id, 'en'),
    )
    .slice(0, max)
    .map((hit) => hit.license);
}

export interface SpdxOptions {
  /** The full URL of `licenses.json`; for a mirror or a test server. */
  url?: string;
  fetch?: typeof fetch;
  cache?: SpdxCache;
  now?: () => number;
  timeoutMs?: number;
  ttlMs?: number;
  attempts?: number;
  backoffMs?: number;
  /** For tests: replaces the wait between attempts. */
  sleep?: (ms: number) => Promise<void>;
}

export function createSpdx(options: SpdxOptions = {}): Spdx {
  const url = options.url ?? SPDX_URL;
  const doFetch = options.fetch ?? fetch;
  const now = options.now ?? Date.now;
  const timeoutMs = options.timeoutMs ?? SPDX_TIMEOUT_MS;
  const ttl = options.ttlMs ?? SPDX_TTL_MS;
  const attempts = Math.max(options.attempts ?? SPDX_ATTEMPTS, 1);
  const backoff = options.backoffMs ?? SPDX_BACKOFF_MS;
  const sleep =
    options.sleep ?? ((ms: number) => new Promise<void>((done) => setTimeout(done, ms)));

  let memory: { list: SpdxList; index: Map<string, SpdxLicense> } | undefined;
  let inflight: Promise<NonNullable<typeof memory>> | undefined;

  const fresh = (list: SpdxList) => now() - list.fetchedAt < ttl;
  const keep = (list: SpdxList) => {
    memory = { list, index: new Map(list.licenses.map((l) => [l.id.toLowerCase(), l])) };
    return memory;
  };

  async function fetchList(): Promise<SpdxList | undefined> {
    for (let attempt = 0; attempt < attempts; attempt++) {
      if (attempt > 0) await sleep(backoff * 2 ** (attempt - 1));
      try {
        const response = await doFetch(url, {
          headers: { accept: 'application/json', 'user-agent': 'scorpion-licence-list' },
          signal: AbortSignal.timeout(timeoutMs),
        });
        if (!response.ok) continue;
        const body = await response.text();
        if (body.length > MAX_BODY_CHARS) continue;
        const list = normaliseSpdxList(JSON.parse(body), now());
        if (list) return list;
      } catch {
        // A timeout, a network error or a body that is not JSON: try again, then fall back.
      }
    }
    return undefined;
  }

  async function load(): Promise<NonNullable<typeof memory>> {
    if (memory && fresh(memory.list)) return memory;
    inflight ??= (async () => {
      let cached: SpdxList | undefined;
      try {
        cached = await options.cache?.read();
      } catch {
        cached = undefined;
      }
      if (cached && fresh(cached)) return keep(cached);
      const fetched = await fetchList();
      if (fetched) {
        try {
          await options.cache?.write(fetched);
        } catch {
          // The list is good; a cache that cannot store it only costs the next process a fetch.
        }
        return keep(fetched);
      }
      // Stale beats bundled: the cached copy is a later release than the one in the code.
      const stale = cached ?? memory?.list;
      const bundled = bundledSpdxList();
      const chosen =
        stale && compareReleases(stale.version, bundled.version) >= 0 ? stale : bundled;
      // Remember the fallback for a short while only, so a recovered network is noticed.
      return keep({ ...chosen, fetchedAt: now() - ttl + Math.min(ttl, 60_000) });
    })().finally(() => {
      inflight = undefined;
    });
    return inflight;
  }

  const find = async (id: string) => (await load()).index.get(id.trim().toLowerCase());
  return {
    async search(query, searchOptions) {
      return searchLicenses((await load()).list.licenses, query, searchOptions?.limit);
    },
    find,
    async has(id) {
      return (await find(id)) !== undefined;
    },
  };
}

export interface StubSpdx extends Spdx {
  /** Every call, in order (`search:<query>`, `find:<id>`). Tests only. */
  readonly calls: readonly string[];
}

/**
 * The adapter for tests and for `NODE_ENV=test`: answers from the given list, by default the bundled
 * one, and never touches the network.
 */
export function createStubSpdx(options: { licenses?: readonly SpdxLicense[] } = {}): StubSpdx {
  const licenses = options.licenses ?? bundledSpdxList().licenses;
  const index = new Map(licenses.map((l) => [l.id.toLowerCase(), l]));
  const calls: string[] = [];
  return {
    calls,
    search(query, searchOptions) {
      calls.push(`search:${query}`);
      return Promise.resolve(searchLicenses(licenses, query, searchOptions?.limit));
    },
    find(id) {
      calls.push(`find:${id}`);
      return Promise.resolve(index.get(id.trim().toLowerCase()));
    },
    has(id) {
      calls.push(`find:${id}`);
      return Promise.resolve(index.has(id.trim().toLowerCase()));
    },
  };
}
