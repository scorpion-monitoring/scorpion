// The authorisation extension point (ADR 0005). The kernel owns the registry `kernel.authorizer`;
// `core.authz` contributes the one entry in M3. Until an entry exists, every non-public route is
// denied.
import type { Actor, Context } from '@scorpion/contracts';
import { Forbidden } from '@scorpion/contracts';
import { z } from 'zod';

export const AUTHORIZER_REGISTRY = 'kernel.authorizer';

/** What the authoriser is asked about: one call to one non-public route. */
export interface AuthorizationRequest {
  /** The request, after input validation. Read the caller's credentials from it. */
  context: Context;
  /** Who is calling, as the authentication step resolved it (`anonymous` without credentials). */
  actor: Actor;
  /** The module that owns the route. */
  module: string;
  /** The permission the route declares. */
  permission: string;
  method: string;
  /** The route pattern, `/api/internal/things/{id}`, not the concrete URL. */
  path: string;
}

/** Resolves when the call is allowed; throws `Unauthorized` or `Forbidden` (or any error, which is a 500) otherwise. */
export type Authorizer = (request: AuthorizationRequest) => void | Promise<void>;

export const authorizerEntrySchema = z.strictObject({
  authorize: z.custom<Authorizer>((value) => typeof value === 'function', 'expected a function'),
});

/** The authoriser in force while no module has contributed one: nothing non-public gets through. */
export const denyByDefault: Authorizer = () => {
  throw new Forbidden(
    'Access is denied. No authorisation module is installed, so only public routes are served.',
  );
};
