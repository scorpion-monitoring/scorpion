// The authentication extension point (ADR 0006), modelled on the authoriser (ADR 0005). The kernel
// owns the registry `kernel.authenticator`; `core.identity` contributes the one entry. Without an
// entry every request is anonymous.
import type { Actor, Context } from '@scorpion/contracts';
import { z } from 'zod';

export const AUTHENTICATOR_REGISTRY = 'kernel.authenticator';

/** What the authenticator is asked about: the credentials of one request. */
export interface AuthenticationRequest {
  /**
   * The request. Read the credentials from its headers and cookies; the body has not been
   * validated yet and must not be read.
   */
  context: Context;
}

/**
 * Resolves the credentials of a request to the caller.
 *
 * - No credentials presented: resolve to `undefined` (the caller is anonymous).
 * - Credentials presented and good: resolve to the `Actor`.
 * - Credentials presented and bad (unknown, expired, revoked): throw `Unauthorized`, so the
 *   caller gets a 401 and never a 500.
 *
 * Any other error is a bug and ends in a 500; the request is never let through.
 */
export type Authenticator = (
  request: AuthenticationRequest,
) => Promise<Actor | undefined> | Actor | undefined;

export const authenticatorEntrySchema = z.strictObject({
  authenticate: z.custom<Authenticator>(
    (value) => typeof value === 'function',
    'expected a function',
  ),
});

/** The authenticator in force while no module has contributed one: nobody can sign in. */
export const anonymousOnly: Authenticator = () => undefined;
