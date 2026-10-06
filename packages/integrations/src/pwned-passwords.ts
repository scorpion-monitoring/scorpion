// The Have I Been Pwned range API, used to refuse a password that appears in a leak (ASVS 6.2.4,
// 6.2.12). k-anonymity: only the first 5 hex characters of the password's SHA-1 are sent, with
// `Add-Padding: true` so the size of the answer says nothing. The password and the rest of the hash
// never leave this file. A timeout, a bounded in-memory cache of ranges, and a stub for tests.
import { createHash } from 'node:crypto';

export type BreachResult =
  /** The password is in the set. */
  | 'breached'
  /** The range was read and the password is not in it. */
  | 'clean'
  /** The service did not answer (timeout, network, status, size). The caller decides; Scorpion accepts the password. */
  | 'unavailable';

export interface PwnedPasswords {
  check(password: string): Promise<BreachResult>;
}

export const PWNED_RANGE_URL = 'https://api.pwnedpasswords.com/range';
export const PWNED_TIMEOUT_MS = 2000;
export const PWNED_CACHE_TTL_MS = 24 * 3600 * 1000;
export const PWNED_CACHE_MAX = 1000;
/** A range answer is about 40 KB padded; anything far beyond that is not one. */
const MAX_BODY_CHARS = 1_000_000;

let failures = 0;

/** How many checks found the service unavailable since the process started. The server turns it into a counter. */
export function pwnedPasswordFailures(): number {
  return failures;
}

export interface PwnedPasswordsOptions {
  /** Without a trailing slash. For a mirror, or a test server. */
  baseUrl?: string;
  timeoutMs?: number;
  fetch?: typeof fetch;
  now?: () => number;
  cacheTtlMs?: number;
  cacheMax?: number;
}

const sha1 = (value: string) =>
  createHash('sha1').update(value, 'utf8').digest('hex').toUpperCase();

/** The suffixes with a count above zero; padding lines (`…:0`) are fake entries and are dropped. */
function parseRange(body: string): Set<string> {
  const suffixes = new Set<string>();
  for (const line of body.split('\n')) {
    const [suffix, count] = line.trim().split(':');
    if (suffix && /^[0-9A-F]{35}$/.test(suffix) && Number(count) > 0) suffixes.add(suffix);
  }
  return suffixes;
}

export function createPwnedPasswords(options: PwnedPasswordsOptions = {}): PwnedPasswords {
  const baseUrl = options.baseUrl ?? PWNED_RANGE_URL;
  const timeoutMs = options.timeoutMs ?? PWNED_TIMEOUT_MS;
  const doFetch = options.fetch ?? fetch;
  const now = options.now ?? Date.now;
  const ttl = options.cacheTtlMs ?? PWNED_CACHE_TTL_MS;
  const max = options.cacheMax ?? PWNED_CACHE_MAX;
  const cache = new Map<string, { at: number; suffixes: Set<string> }>();

  async function range(prefix: string): Promise<Set<string> | undefined> {
    const hit = cache.get(prefix);
    if (hit && now() - hit.at < ttl) return hit.suffixes;
    try {
      const response = await doFetch(`${baseUrl}/${prefix}`, {
        headers: { 'Add-Padding': 'true', 'User-Agent': 'scorpion-password-check' },
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!response.ok) return undefined;
      const body = await response.text();
      if (body.length > MAX_BODY_CHARS) return undefined;
      const suffixes = parseRange(body);
      cache.delete(prefix);
      // Oldest first: a Map keeps insertion order.
      while (cache.size >= max) cache.delete(cache.keys().next().value as string);
      cache.set(prefix, { at: now(), suffixes });
      return suffixes;
    } catch {
      return undefined;
    }
  }

  return {
    async check(password) {
      const hash = sha1(password);
      const suffixes = await range(hash.slice(0, 5));
      if (!suffixes) {
        failures += 1;
        return 'unavailable';
      }
      return suffixes.has(hash.slice(5)) ? 'breached' : 'clean';
    },
  };
}

export interface StubPwnedPasswords extends PwnedPasswords {
  /** Every password that was asked about, in order. Tests only. */
  readonly asked: readonly string[];
}

/**
 * The adapter for tests and for a profile that must not call out: knows the passwords it is given,
 * or says `unavailable` for all of them. Never touches the network.
 */
export function createStubPwnedPasswords(
  options: { breached?: readonly string[]; unavailable?: boolean } = {},
): StubPwnedPasswords {
  const breached = new Set(options.breached ?? []);
  const asked: string[] = [];
  return {
    asked,
    check(password) {
      asked.push(password);
      if (options.unavailable) {
        failures += 1;
        return Promise.resolve('unavailable');
      }
      return Promise.resolve(breached.has(password) ? 'breached' : 'clean');
    },
  };
}
