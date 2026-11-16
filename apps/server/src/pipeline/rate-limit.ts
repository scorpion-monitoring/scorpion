import { createHash } from 'node:crypto';
import type { MiddlewareHandler } from 'hono';
import { problemResponse, type AppEnv, type RateLimitGroup } from '@scorpion/contracts';
import type { Logger, RateLimit, RateLimiter } from '@scorpion/kernel';
import { z } from 'zod';
import type { ClientIpResolver } from './client-ip.ts';

/**
 * The limits per route group, per address and per credential, when `core.settings` is not in the
 * profile. With it they are the `rateLimits` setting of that module, whose defaults are these
 * numbers (`limitsFromSettings`).
 */
export const RATE_LIMITS: Readonly<Record<RateLimitGroup, RateLimit>> = {
  default: { capacity: 120, refillPerSecond: 2 }, // a burst of 120, then 120 a minute
  strict: { capacity: 10, refillPerSecond: 1 / 6 }, // a burst of 10, then 10 a minute
};

const storedLimits = z.object({
  rateLimits: z.object({
    default: z.object({ burst: z.number().positive(), perMinute: z.number().positive() }),
    strict: z.object({ burst: z.number().positive(), perMinute: z.number().positive() }),
  }),
});

/**
 * The limits an administrator saved: the `rateLimits` setting of `core.settings` (a burst, then a
 * rate per minute, per group) as token buckets. `undefined` for anything else, so the constants hold.
 */
export function limitsFromSettings(
  values: unknown,
): Readonly<Record<RateLimitGroup, RateLimit>> | undefined {
  const parsed = storedLimits.safeParse(values);
  if (!parsed.success) return undefined;
  const { default: standard, strict } = parsed.data.rateLimits;
  return {
    default: { capacity: standard.burst, refillPerSecond: standard.perMinute / 60 },
    strict: { capacity: strict.burst, refillPerSecond: strict.perMinute / 60 },
  };
}

/**
 * How much bigger the address bucket is for a call that carries a token or key, in the `default` group.
 * Many programs, each with its own token, can share one address (a proxy, a campus network, a CI
 * runner): the token's own bucket limits each of them, and this bucket only stops one address from
 * running many tokens at once. It is separate from the bucket of the browsers on that address, so a
 * script with a token does not use up the budget of the people behind the same NAT, and the other way
 * round. The `strict` group is not scaled: its routes are the ones an attacker gains from.
 */
export const TOKEN_ADDRESS_FACTOR = 10;

/**
 * The same for a request that carries a session cookie, in the `default` group. The caller's own bucket
 * is the session's (`sessionRateLimit`, once step 3 has found the session good), so people behind one
 * address stop sharing one budget; this bucket is only the ceiling for the address, as far as the
 * browsers on it go. It is the bucket of requests that present the cookie, good or not: a forged value
 * costs one lookup and is stopped here, and it is not larger than a forged token's.
 */
export const SESSION_ADDRESS_FACTOR = 10;

/**
 * A bearer token or API key, as an opaque id for the bucket: its hash, so the secret itself is
 * never written to the database or the log. A session cookie is not keyed here: only its presence
 * is read (`SESSION_ADDRESS_FACTOR`), and its session is charged after authentication
 * (`sessionRateLimit`).
 */
function credentialKey(headers: { get(name: string): string | undefined }): string | undefined {
  const bearer = /^Bearer\s+(\S+)$/i.exec(headers.get('authorization') ?? '')?.[1];
  const presented = bearer ?? headers.get('x-api-key')?.trim();
  if (!presented) return undefined;
  return createHash('sha256').update(presented).digest('hex').slice(0, 32);
}

/** The 429 answer, with `Retry-After`. */
export function tooManyRequests(requestId: string | undefined, retryAfter: number): Response {
  return problemResponse(
    {
      type: 'about:blank',
      title: 'Too Many Requests',
      status: 429,
      detail: `Too many requests. Try again in ${retryAfter} seconds.`,
      requestId,
    },
    { 'retry-after': String(retryAfter) },
  );
}

/** An opaque bucket id for a session: a hash of the session row's id, never the cookie's value and never written to a log. */
export const sessionBucketId = (sessionId: string): string =>
  createHash('sha256').update(`scorpion:rate:session:v1:${sessionId}`).digest('hex').slice(0, 32);

const sessionBucket = (group: RateLimitGroup, sessionId: string) => ({
  key: `session:${group}:${sessionBucketId(sessionId)}`,
  scale: 1,
});

/** The bucket keys of one request, as a pure function of what the request carries (tested as a table). */
export function bucketKeys(input: {
  group: RateLimitGroup;
  address: string;
  /** The hash of the bearer token or API key, if the request presents one. */
  credential?: string | undefined;
  /** Whether the request carries the session cookie (its value is not needed). */
  sessionCookie?: boolean | undefined;
  /** The session row's id, once step 3 has found the session good. */
  sessionId?: string | undefined;
}): { key: string; scale: number }[] {
  const { group, address, credential, sessionCookie, sessionId } = input;
  if (group !== 'default') return [{ key: `ip:${group}:${address}`, scale: 1 }];
  if (credential !== undefined) {
    return [
      { key: `ip-token:${group}:${address}`, scale: TOKEN_ADDRESS_FACTOR },
      { key: `credential:${group}:${credential}`, scale: 1 },
    ];
  }
  const keys = [
    sessionCookie
      ? { key: `ip-session:${group}:${address}`, scale: SESSION_ADDRESS_FACTOR }
      : { key: `ip:${group}:${address}`, scale: 1 },
  ];
  if (sessionId !== undefined) keys.push(sessionBucket(group, sessionId));
  return keys;
}

export interface RateLimitOptions {
  limiter: RateLimiter;
  group: RateLimitGroup;
  /** The bucket's size and rate; a function when the limits can change while the server runs. */
  limit: RateLimit | (() => Promise<RateLimit>);
  clientIp: ClientIpResolver;
  log: Logger;
  /** The name of the session cookie (`kernel.authenticator`'s `sessionCookie`); only its presence is read. */
  sessionCookie?: string | undefined;
}

const scaledBy = (limit: RateLimit, scale: number): RateLimit => ({
  capacity: limit.capacity * scale,
  refillPerSecond: limit.refillPerSecond * scale,
});

/** Whether the request carries a cookie of this name, read from the header without decoding the value. */
function carriesCookie(header: string | undefined, name: string | undefined): boolean {
  if (!name || !header) return false;
  return header.split(';').some((part) => {
    const eq = part.indexOf('=');
    return eq > 0 && part.slice(0, eq).trim() === name && part.length > eq + 1;
  });
}

/**
 * Step 2: a token bucket per client address and, when the request carries a bearer token or API
 * key, one per credential (and then the address bucket is the separate, larger one of
 * `TOKEN_ADDRESS_FACTOR`). A request that carries the session cookie is charged to the larger
 * address bucket of `SESSION_ADDRESS_FACTOR`; its own session is charged by `sessionRateLimit` after
 * authentication. A denied request is answered with 429 problem+json and `Retry-After`
 * before the body is read or the handler runs. The buckets are per route group, so a flood of
 * logins does not use up the budget of the rest of the API.
 */
export function rateLimit(options: RateLimitOptions): MiddlewareHandler<AppEnv> {
  const { limiter, group, limit, clientIp, log, sessionCookie } = options;
  return async (c, next) => {
    // No address (no socket) means one shared bucket: stricter, never open.
    const address = clientIp(c) ?? 'unknown';
    const credential = credentialKey({ get: (name) => c.req.header(name) });
    const current = typeof limit === 'function' ? await limit() : limit;
    const buckets = bucketKeys({
      group,
      address,
      credential,
      sessionCookie: carriesCookie(c.req.header('cookie'), sessionCookie),
    });

    let retryAfter = 0;
    for (const { key, scale } of buckets) {
      const decision = await limiter.consume(key, scaledBy(current, scale));
      if (!decision.allowed) {
        retryAfter = decision.retryAfterSeconds;
        break; // the next bucket is not charged for a request that is refused
      }
    }
    if (retryAfter > 0) {
      log.warn({ requestId: c.get('requestId'), group, path: c.req.path }, 'rate limit exceeded');
      return tooManyRequests(c.get('requestId'), retryAfter);
    }
    return next();
  };
}

/**
 * Step 3b, after authentication: a signed-in caller of a `default` route, by session, is charged to
 * the bucket of that session (a hash of the session row's id). Two people behind one address no
 * longer share a budget, and a person's own navigation no longer drains the address. Callers with a
 * token (their credential bucket is charged in step 2), anonymous callers and the `strict` group
 * pass through unchanged.
 */
export function sessionRateLimit(options: RateLimitOptions): MiddlewareHandler<AppEnv> {
  const { limiter, group, limit, log } = options;
  return async (c, next) => {
    const actor = c.get('actor');
    if (
      group !== 'default' ||
      actor?.kind !== 'user' ||
      actor.via !== 'session' ||
      !actor.sessionId
    )
      return next();
    const current = typeof limit === 'function' ? await limit() : limit;
    const bucket = sessionBucket(group, actor.sessionId);
    const decision = await limiter.consume(bucket.key, scaledBy(current, bucket.scale));
    if (!decision.allowed) {
      log.warn({ requestId: c.get('requestId'), group, path: c.req.path }, 'rate limit exceeded');
      return tooManyRequests(c.get('requestId'), decision.retryAfterSeconds);
    }
    return next();
  };
}
