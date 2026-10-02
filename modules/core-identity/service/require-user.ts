import { Unauthorized, isUser, type Actor, type UserActor } from '@scorpion/contracts';

/** The service-layer guard: an anonymous caller is a 401, whatever the route did or did not check. */
export function requireUser(actor: Actor): UserActor {
  if (!isUser(actor)) throw new Unauthorized();
  return actor;
}
