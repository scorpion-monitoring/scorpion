import { HTTPException } from 'hono/http-exception';
import type { ErrorHandler, NotFoundHandler } from 'hono';
import { randomUUID } from 'node:crypto';
import {
  DomainError,
  Invalid,
  NotFound,
  problemFor,
  problemResponse,
  type AppEnv,
  type FieldProblem,
} from '@scorpion/contracts';
import type { Logger } from '@scorpion/kernel';

const STATUS_TITLES: Record<number, string> = {
  400: 'Bad Request',
  401: 'Unauthorized',
  403: 'Forbidden',
  404: 'Not Found',
  405: 'Method Not Allowed',
  408: 'Request Timeout',
  409: 'Conflict',
  413: 'Content Too Large',
  415: 'Unsupported Media Type',
  422: 'Unprocessable Content',
  429: 'Too Many Requests',
};

/** Zod issues → the per-field list of a problem. `target` is where Hono found the input. */
export function fieldProblems(
  issues: readonly { path: readonly PropertyKey[]; message: string }[],
  target: string,
): FieldProblem[] {
  const place = target === 'json' ? 'body' : target === 'param' ? 'path' : target;
  return issues.map((issue) => ({
    in: place,
    path: issue.path.map(String).join('.'),
    message: issue.message,
  }));
}

/**
 * Step 8: the error mapper.
 *
 * - A domain error becomes a problem with its own status.
 * - A framework HTTP error (a JSON body that does not parse, an unsupported media type) becomes a
 *   problem with the same status; bad JSON is a 422 like any other bad input.
 * - Anything else is a bug. The full error goes to the log with the request id; the caller gets a
 *   500 with the request id and no message, no stack trace, nothing about the internals.
 */
export function errorMapper(log: Logger): ErrorHandler<AppEnv> {
  return (error, c) => {
    const requestId = c.get('requestId') ?? randomUUID();
    if (error instanceof DomainError) {
      return problemResponse(problemFor(error, requestId));
    }
    if (error instanceof HTTPException && error.status >= 400 && error.status < 500) {
      if (error.status === 400 && /malformed json/i.test(error.message)) {
        return problemResponse(
          problemFor(new Invalid('The request body is not valid JSON.'), requestId),
        );
      }
      return problemResponse({
        type: 'about:blank',
        title: STATUS_TITLES[error.status] ?? 'Bad Request',
        status: error.status,
        detail: error.message || undefined,
        requestId,
      });
    }
    log.error({ requestId, err: error, method: c.req.method, path: c.req.path }, 'unhandled error');
    return problemResponse({
      type: 'about:blank',
      title: 'Internal Server Error',
      status: 500,
      detail: 'An unexpected error occurred. Quote the request id when you report it.',
      requestId,
    });
  };
}

export function notFoundHandler(): NotFoundHandler<AppEnv> {
  return (c) =>
    problemResponse(
      problemFor(
        new NotFound('No route matches this request.'),
        c.get('requestId') ?? randomUUID(),
      ),
    );
}
