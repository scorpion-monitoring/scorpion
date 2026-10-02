// The session half of `kernel.authenticator`: the cookie becomes an Actor. It reads only headers,
// never the body, and every failure it knows about is an `Unauthorized`.
import { Unauthorized, type Actor } from '@scorpion/contracts';
import type { Authenticator } from '@scorpion/kernel';
import { CSRF_HEADER, isSafeMethod, readSessionCookie, writeSessionCookie } from './cookie.ts';
import { csrfTokenMatches } from './service/session-id.ts';
import { SESSION_LIFETIME_MS, type SessionService } from './service/sessions.ts';

export function createSessionAuthenticator(sessions: () => SessionService): Authenticator {
  return async ({ context: c }): Promise<Actor | undefined> => {
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
