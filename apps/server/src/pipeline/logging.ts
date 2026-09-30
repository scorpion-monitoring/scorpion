import type { MiddlewareHandler } from 'hono';
import type { AppEnv } from '@scorpion/contracts';
import type { Logger } from '@scorpion/kernel';

export interface RequestInfo {
  method: string;
  /** The route pattern that matched, or `unmatched`. Never the concrete path, so metrics stay small. */
  route: string;
  status: number;
  durationSeconds: number;
}

/**
 * Step 3: one log line per request, and the numbers for the metrics. The line has the method, the
 * path (not the query string, which can carry tokens), the status, the duration and the request id.
 */
export function requestLogging(
  log: Logger,
  observe?: (info: RequestInfo) => void,
): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const started = process.hrtime.bigint();
    await next();
    const durationSeconds = Number(process.hrtime.bigint() - started) / 1e9;
    const status = c.res.status;
    const matched = c.req.routePath !== '/*' && c.req.routePath !== '*';
    const route = matched ? c.req.routePath : 'unmatched';
    const line = {
      requestId: c.get('requestId'),
      method: c.req.method,
      path: c.req.path,
      status,
      durationMs: Math.round(durationSeconds * 1000),
    };
    if (status >= 500) log.error(line, 'request failed');
    else if (status >= 400) log.warn(line, 'request rejected');
    else log.info(line, 'request');
    observe?.({ method: c.req.method, route, status, durationSeconds });
  };
}
