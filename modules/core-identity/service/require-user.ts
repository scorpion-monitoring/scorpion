import { Forbidden, Unauthorized, isUser, type Actor, type UserActor } from '@scorpion/contracts';

/** The service-layer guard: an anonymous caller is a 401, whatever the route did or did not check. */
export function requireUser(actor: Actor): UserActor {
  if (!isUser(actor)) throw new Unauthorized();
  return actor;
}

/** Like `requireUser`, and the caller must have signed in with a session, not an access token. */
export function requireSession(actor: Actor, what = 'This'): UserActor {
  const user = requireUser(actor);
  if (user.via !== 'session')
    throw new Forbidden(`${what} needs a signed-in session, not an access token.`);
  return user;
}
