import { ANONYMOUS, Unauthorized, type AppEnv, type AppRoute } from '@scorpion/contracts';
import type { Authenticator } from '@scorpion/kernel';
import type { MiddlewareHandler } from 'hono';

/**
 * Step 3: authentication. Hands the request's credentials to the authenticator
 * (`kernel.authenticator`, contributed by `core.identity`) and stores the result as `actor` for
 * the later steps and the handler. No credentials means the anonymous actor.
 *
 * Bad credentials are a 401 on a route that needs a caller. A `public: true` route does not need
 * one, so there they only mean "not signed in": a stale session cookie must not stop someone from
 * logging in again. An authenticator that fails in any other way is a bug and ends in a 500;
 * the request is never let through as someone else.
 */
export function authenticate(
  authenticator: Authenticator,
  route: Pick<AppRoute, 'public'>,
): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    try {
      const actor = await authenticator({ context: c });
      if (actor !== undefined && actor.kind !== 'user' && actor.kind !== 'anonymous') {
        throw new TypeError('the authenticator returned something that is not an Actor');
      }
      c.set('actor', actor ?? ANONYMOUS);
    } catch (error) {
      if (!(route.public === true && error instanceof Unauthorized)) throw error;
      c.set('actor', ANONYMOUS);
    }
    await next();
  };
}
