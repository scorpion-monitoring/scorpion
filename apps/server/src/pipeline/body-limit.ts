import { bodyLimit } from 'hono/body-limit';
import type { MiddlewareHandler } from 'hono';
import { problemResponse, type AppEnv } from '@scorpion/contracts';

export const DEFAULT_MAX_BODY_BYTES = 1024 * 1024;

/** Step 4: refuses a request body above the limit with 413, before it is read into memory. */
export function limitBody(maxBytes: number = DEFAULT_MAX_BODY_BYTES): MiddlewareHandler<AppEnv> {
  return bodyLimit({
    maxSize: maxBytes,
    onError: (c) =>
      problemResponse({
        type: 'about:blank',
        title: 'Content Too Large',
        status: 413,
        detail: `The request body is larger than the ${maxBytes} bytes this server accepts.`,
        requestId: (c as { get(key: 'requestId'): string | undefined }).get('requestId'),
      }),
  });
}

/** A route that accepts a larger body than the rest (an upload), as the router will see its path. */
export interface BodyLimitOverride {
  method: string;
  /** The route's path with `{param}` segments, below `BASE_PATH`. */
  path: string;
  maxBytes: number;
}

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Step 4 with exceptions. Every request is limited to `defaultBytes`, except a request for one of
 * the `overrides`, which is limited to the route's own number. The limit is looked up by method and
 * path (the body is refused before routing and authentication run, so the route is not known yet);
 * an override can only raise the limit, and nothing else is affected.
 */
export function limitBodyPerRoute(
  defaultBytes: number,
  overrides: readonly BodyLimitOverride[],
): MiddlewareHandler<AppEnv> {
  const fallback = limitBody(defaultBytes);
  const raised = overrides
    .filter((override) => override.maxBytes > defaultBytes)
    .map((override) => ({
      method: override.method.toUpperCase(),
      pattern: new RegExp(
        `^${override.path
          .split(/\{\w+\}/)
          .map(escapeRegExp)
          .join('[^/]+')}/?$`,
      ),
      limit: limitBody(override.maxBytes),
    }));
  if (raised.length === 0) return fallback;
  return (c, next) => {
    const match = raised.find(
      (candidate) => candidate.method === c.req.method && candidate.pattern.test(c.req.path),
    );
    return (match?.limit ?? fallback)(c, next);
  };
}
