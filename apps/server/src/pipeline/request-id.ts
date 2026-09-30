import { randomUUID } from 'node:crypto';
import type { MiddlewareHandler } from 'hono';
import type { AppEnv } from '@scorpion/contracts';

/** What an incoming `X-Request-Id` may look like to be trusted (and echoed into logs). */
const VALID_REQUEST_ID = /^[A-Za-z0-9._-]{8,128}$/;

export const REQUEST_ID_HEADER = 'x-request-id';

/**
 * Step 1 of the pipeline. Accepts a valid `X-Request-Id` from the caller (a proxy or a client
 * that traces its calls), otherwise makes one. The id is in every log line and every problem.
 */
export function requestId(): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const incoming = c.req.header(REQUEST_ID_HEADER);
    const id = incoming && VALID_REQUEST_ID.test(incoming) ? incoming : randomUUID();
    c.set('requestId', id);
    await next();
    setResponseHeader(c, REQUEST_ID_HEADER, id);
  };
}

/** Sets a header on the response that exists after `next()`, whatever produced it. */
export function setResponseHeader(
  c: { res: Response },
  name: string,
  value: string,
  options: { onlyIfMissing?: boolean } = {},
): void {
  if (options.onlyIfMissing && c.res.headers.has(name)) return;
  try {
    c.res.headers.set(name, value);
  } catch {
    // Some responses (redirects, fetch results) have immutable headers: rebuild them.
    c.res = new Response(c.res.body, c.res);
    c.res.headers.set(name, value);
  }
}
