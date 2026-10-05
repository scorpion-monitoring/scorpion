// The one entry in `kernel.authenticator`: a personal access token or a session cookie becomes an
// Actor. It reads only headers, never the body, and every failure it knows about is an
// `Unauthorized`.
//
// A token is `Authorization: Bearer <token>` or `X-API-Key: <token>`; `Authorization` wins when both
// are there. **A request that carries a token is a token request and nothing else**: the session
// cookie is not looked at, so it cannot lend the request session privileges, add a CSRF check
// the caller could not satisfy, or turn a good token into a 401 because a stale cookie came
// along (ADR 0008). Presenting a token and getting it wrong is a 401 even if the cookie is good.
import { Unauthorized, type Actor } from '@scorpion/contracts';
import type { Authenticator } from '@scorpion/kernel';
import type { Context } from 'hono';
import { CSRF_HEADER, isSafeMethod, readSessionCookie, writeSessionCookie } from './cookie.ts';
import { csrfTokenMatches } from './service/session-id.ts';
import { SESSION_LIFETIME_MS, type SessionService } from './service/sessions.ts';
import type { TokenAuthenticator } from './service/tokens.ts';

/**
 * The token a request presents, if any: `''` for a header that is there but empty. Only a Bearer
 * `Authorization` counts; another scheme (Basic) is not ours and is ignored.
 */
export function presentedToken(c: Context): string | undefined {
  const authorization = c.req.header('authorization');
  if (authorization !== undefined) {
    const scheme = authorization.slice(0, 6).toLowerCase();
    if (scheme === 'bearer' && (authorization.length === 6 || authorization[6] === ' ')) {
      return authorization.slice(7);
    }
  }
  return c.req.header('x-api-key');
}

export function createAuthenticator(deps: {
  sessions: () => SessionService;
  tokens: () => TokenAuthenticator;
}): Authenticator {
  const { sessions, tokens } = deps;
  return async ({ context: c }): Promise<Actor | undefined> => {
    const presented = presentedToken(c);
    if (presented !== undefined) {
      const verified = await tokens().authenticate(presented);
      if (!verified) throw new Unauthorized('The access token is not valid.');
      return {
        kind: 'user',
        userId: verified.userId,
        username: verified.username,
        roles: [], // roles are data owned by core.authz (M3)
        via: 'token',
        scopes: verified.scopes,
        tokenId: verified.tokenId,
      };
    }

    const id = readSessionCookie(c);
    if (id === undefined) return undefined;

    const resolved = await sessions().resolve(id);
    if (!resolved) throw new Unauthorized('The session is not valid. Sign in again.');

    // A cookie is sent by the browser without being asked, so a request that changes something
    // must also carry the token only our own pages know (ADR 0007).
    if (!isSafeMethod(c.req.method) && !csrfTokenMatches(id, c.req.header(CSRF_HEADER))) {
      throw new Unauthorized('The CSRF token is missing or wrong.');
    }

    // The expiry slides, so the cookie's must too.
    if (resolved.renewed) writeSessionCookie(c, id, new Date(Date.now() + SESSION_LIFETIME_MS));

    return {
      kind: 'user',
      userId: resolved.userId,
      username: resolved.username,
      roles: [], // roles are data owned by core.authz (M3)
      via: 'session',
    };
  };
}
