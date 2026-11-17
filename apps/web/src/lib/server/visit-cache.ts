// The visit cache behind `UiLoadContext.remember`: reference data that does not change while a person works is
// read once per visitor and not on every load of a page (a month change reloads the page). It lives in the
// memory of this web process, keyed by a hash of the request's cookie header (its session among them) and the name the page gave; the cookie
// itself is never kept and nothing is written to disk or a log. A few minutes of life bounds how stale it can be.
import { createHash } from 'node:crypto';

export const VISIT_TTL_MS = 5 * 60_000;
export const VISIT_MAX_ENTRIES = 2_000;

interface Entry {
  expires: number;
  value: Promise<unknown>;
}

export interface VisitCache {
  /** `remember` for one visitor: `visitor` is the request's cookie header, or `undefined` for none (then nothing is kept). */
  forVisitor(visitor: string | undefined): <T>(key: string, load: () => Promise<T>) => Promise<T>;
  readonly size: number;
}

export function createVisitCache(
  options: { ttlMs?: number; maxEntries?: number; now?: () => number } = {},
): VisitCache {
  const ttl = options.ttlMs ?? VISIT_TTL_MS;
  const max = options.maxEntries ?? VISIT_MAX_ENTRIES;
  const now = options.now ?? Date.now;
  const entries = new Map<string, Entry>();

  function sweep(at: number) {
    for (const [key, entry] of entries) if (entry.expires <= at) entries.delete(key);
    // A Map keeps insertion order: the oldest go first when the cache is still too big.
    for (const key of entries.keys()) {
      if (entries.size <= max) break;
      entries.delete(key);
    }
  }

  return {
    get size() {
      return entries.size;
    },
    forVisitor(visitor) {
      const id = visitor
        ? createHash('sha256').update(`scorpion:visit:v1:${visitor}`).digest('hex')
        : undefined;
      return <T>(key: string, load: () => Promise<T>): Promise<T> => {
        if (id === undefined) return load();
        const at = now();
        const slot = `${id}:${key}`;
        const hit = entries.get(slot);
        if (hit && hit.expires > at) return hit.value as Promise<T>;
        const value = load();
        entries.set(slot, { expires: at + ttl, value });
        // A failure is not remembered: the next load asks again.
        value.catch(() => {
          if (entries.get(slot)?.value === value) entries.delete(slot);
        });
        sweep(at);
        return value;
      };
    },
  };
}

/** The cache of this web process. */
export const visits = createVisitCache();
