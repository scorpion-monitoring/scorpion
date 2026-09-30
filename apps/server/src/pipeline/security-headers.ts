import type { MiddlewareHandler } from 'hono';
import type { AppEnv } from '@scorpion/contracts';
import { setResponseHeader } from './request-id.ts';

/**
 * Step 2. Headers that harden every response, errors and 404s included.
 *
 * The Content-Security-Policy is strict and has no `unsafe-inline`: this server answers JSON, so
 * it needs to load nothing. A route that serves other content (uploaded files, M3) sets its own
 * policy and this one stays out of the way.
 */
export function securityHeaders(): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    await next();
    setResponseHeader(c, 'strict-transport-security', 'max-age=31536000; includeSubDomains');
    setResponseHeader(
      c,
      'content-security-policy',
      "default-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
      { onlyIfMissing: true },
    );
    setResponseHeader(c, 'x-content-type-options', 'nosniff');
    setResponseHeader(c, 'referrer-policy', 'no-referrer');
    setResponseHeader(c, 'x-frame-options', 'DENY');
    setResponseHeader(c, 'cross-origin-resource-policy', 'same-origin', { onlyIfMissing: true });
  };
}
