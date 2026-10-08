import {
  ANONYMOUS,
  Unauthorized,
  type Actor,
  type AppEnv,
  type AppRoute,
} from '@scorpion/contracts';
import type { Authenticator, Logger, RateLimit, RateLimiter } from '@scorpion/kernel';
import type { MiddlewareHandler } from 'hono';
import type { ClientIpResolver } from './client-ip.ts';
import { tooManyRequests } from './rate-limit.ts';

/**
 * Failed token attempts per client address: a burst of 10, then 10 a minute (the `strict` budget).
 * A constant until `core.settings` exists (M3).
 */
export const FAILED_CREDENTIAL_LIMIT: Readonly<RateLimit> = {
  capacity: 10,
  refillPerSecond: 1 / 6,
};

/** The request presents a bearer token or an API key (whether or not it is a good one). */
function presentsToken(headers: { get(name: string): string | undefined }): boolean {
  return (
    /^bearer(\s|$)/i.test(headers.get('authorization') ?? '') ||
    headers.get('x-api-key') !== undefined
  );
}

/**
 * "Is the caller of this request still good?", for a response that lives on after the check of step 3. The
 * credentials are read again from the same request and judged by the same authenticator, passively (no
 * sliding of a session). Good means the same person by the same means: the same session or token.
 * Anything that is not a clean "yes" is a "no", including an error: a stream must never outlive a doubt.
 */
function recheckOf(
  authenticator: Authenticator,
  c: Parameters<Authenticator>[0]['context'],
  first: Actor | undefined,
): () => Promise<boolean> {
  return async () => {
    if (first === undefined || first.kind !== 'user') return false;
    try {
      const again = await authenticator({ context: c, passive: true });
      return (
        again?.kind === 'user' &&
        again.userId === first.userId &&
        again.via === first.via &&
        again.sessionId === first.sessionId &&
        again.tokenId === first.tokenId
      );
    } catch {
      return false;
    }
  };
}

export interface FailedAttemptLimit {
  limiter: RateLimiter;
  clientIp: ClientIpResolver;
  log: Logger;
  limit?: RateLimit;
}

/**
 * Step 3: authentication. Hands the request's credentials to the authenticator
 * (`kernel.authenticator`, contributed by `core.identity`) and stores the result as `actor` for
 * the later steps and the handler. No credentials means the anonymous actor.
 *
 * Bad credentials are a 401 on a route that needs a caller. A `public: true` route does not need
 * one, so there they only mean "not signed in": a stale session cookie must not stop someone from
 * logging in again. An authenticator that fails in any other way is a bug and ends in a 500;
 * the request is never let through as someone else.
 *
 * With `failures`, a bad bearer token or API key is also charged to a strict bucket of the client
 * address, public routes included. The bucket is checked before the token is verified, so an
 * address that has used up its failures gets a 429 and no more guesses are answered, not even a
 * right one, until a token is back.
 */
export function authenticate(
  authenticator: Authenticator,
  route: Pick<AppRoute, 'public'>,
  failures?: FailedAttemptLimit,
): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const tracked = failures !== undefined && presentsToken({ get: (n) => c.req.header(n) });
    const bucket = tracked ? `auth-failure:${failures.clientIp(c) ?? 'unknown'}` : '';
    const limit = failures?.limit ?? FAILED_CREDENTIAL_LIMIT;

    if (tracked) {
      const decision = await failures.limiter.peek(bucket, limit);
      if (!decision.allowed) {
        failures.log.warn(
          { requestId: c.get('requestId'), path: c.req.path },
          'too many failed token attempts',
        );
        return tooManyRequests(c.get('requestId'), decision.retryAfterSeconds);
      }
    }

    try {
      const actor = await authenticator({ context: c });
      if (actor !== undefined && actor.kind !== 'user' && actor.kind !== 'anonymous') {
        throw new TypeError('the authenticator returned something that is not an Actor');
      }
      c.set('actor', actor ?? ANONYMOUS);
      c.set('recheckActor', recheckOf(authenticator, c, actor));
    } catch (error) {
      if (!(error instanceof Unauthorized)) throw error;
      if (tracked) await failures.limiter.consume(bucket, limit);
      if (route.public !== true) throw error;
      c.set('actor', ANONYMOUS);
      c.set('recheckActor', () => Promise.resolve(false));
    }
    return next();
  };
}
