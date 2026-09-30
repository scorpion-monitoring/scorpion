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
