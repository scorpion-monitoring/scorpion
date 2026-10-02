import { ANONYMOUS, type AnyHandler, type AppRoute } from '@scorpion/contracts';
import type { Authorizer } from '@scorpion/kernel';

/**
 * Step 6: the authorisation hook. Runs after input validation and before the handler. A public
 * route skips it; every other route is decided by the authoriser, which is the deny-all default
 * until `core.authz` provides one (ADR 0005).
 *
 * Regression test for defect 1 (a plain User on every admin endpoint gets 403): named
 * `defect-01.privilege-escalation.test.ts`, written in M3 when core.authz fills this hook.
 */
export function withAuthorization(
  registered: { module: string; route: AppRoute; path: string },
  handler: AnyHandler,
  authorizer: Authorizer,
): AnyHandler {
  const { module, route, path } = registered;
  if (route.public === true) return handler;
  // Hono's handler generics are erased in `AnyHandler`, so its context is `any` here.
  /* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-return */
  return async (c, next) => {
    await authorizer({
      context: c,
      actor: c.get('actor') ?? ANONYMOUS,
      module,
      permission: route.permission!,
      method: route.method.toUpperCase(),
      path,
    });
    return handler(c, next);
  };
  /* eslint-enable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-return */
}
