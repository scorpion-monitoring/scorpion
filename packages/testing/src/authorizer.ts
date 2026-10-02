// A stand-in for `core.authz` for tests of the pipeline itself (transport: ordering of the steps,
// error mapping), where no module or database is involved. A test of what a route or a service
// allows uses the real `core.authz` and roles in the database instead (ADR 0015). It must never be
// contributed by a module that ships.
import { Forbidden, Unauthorized, type Actor } from '@scorpion/contracts';

/** What the pipeline hands an authoriser; this one reads only the actor and the permission. */
export interface TestAuthorizationRequest {
  actor: Actor;
  permission: string;
}

/**
 * An authoriser for tests: an anonymous caller gets 401, a signed-in caller gets through when the
 * route's permission is in `allowed`, and 403 otherwise. `'*'` allows every permission to a
 * signed-in caller. The roles and scopes of the actor are ignored.
 */
export function testAuthorizer(allowed: Iterable<string>) {
  const permissions = new Set(allowed);
  return ({ actor, permission }: TestAuthorizationRequest): void => {
    if (actor.kind === 'anonymous') throw new Unauthorized();
    if (!permissions.has('*') && !permissions.has(permission)) throw new Forbidden();
  };
}

/** The same as a `kernel.authorizer` registry entry, for a fixture module's `contributes`. */
export function testAuthorizerEntry(allowed: Iterable<string>) {
  return { authorize: testAuthorizer(allowed) };
}
