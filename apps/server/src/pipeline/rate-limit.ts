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
 * A bearer token or API key, as an opaque id for the bucket: its hash, so the secret itself is
 * never written to the database or the log. Session cookies are not keyed here; they count
 * against the address.
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

export interface RateLimitOptions {
  limiter: RateLimiter;
  group: RateLimitGroup;
  /** The bucket's size and rate; a function when the limits can change while the server runs. */
  limit: RateLimit | (() => Promise<RateLimit>);
  clientIp: ClientIpResolver;
  log: Logger;
}

/**
 * Step 2: a token bucket per client address and, when the request carries a bearer token or API
 * key, one per credential. A denied request is answered with 429 problem+json and `Retry-After`
 * before the body is read or the handler runs. The buckets are per route group, so a flood of
 * logins does not use up the budget of the rest of the API.
 */
export function rateLimit(options: RateLimitOptions): MiddlewareHandler<AppEnv> {
  const { limiter, group, limit, clientIp, log } = options;
  return async (c, next) => {
    // No address (no socket) means one shared bucket: stricter, never open.
    const keys = [`ip:${group}:${clientIp(c) ?? 'unknown'}`];
    const credential = credentialKey({ get: (name) => c.req.header(name) });
    if (credential) keys.push(`credential:${group}:${credential}`);

    const current = typeof limit === 'function' ? await limit() : limit;
    let retryAfter = 0;
    for (const key of keys) {
      const decision = await limiter.consume(key, current);
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
