import { z } from '@hono/zod-openapi';
import { DomainError, type FieldProblem } from './errors.ts';

export const PROBLEM_CONTENT_TYPE = 'application/problem+json';

/** RFC 9457 problem details, plus the request id and the per-field `errors` of a validation failure. */
export const problemSchema = z
  .object({
    type: z.string().meta({
      description: 'A URI reference that identifies the problem type.',
      example: 'about:blank',
    }),
    title: z.string().meta({ example: 'Not Found' }),
    status: z.int().min(400).max(599),
    detail: z.string().optional(),
    instance: z.string().optional(),
    requestId: z.string().optional().meta({ description: 'Quote this when you report a problem.' }),
    errors: z
      .array(z.object({ in: z.string().optional(), path: z.string(), message: z.string() }))
      .optional(),
  })
  .meta({ id: 'Problem' });

export type Problem = z.infer<typeof problemSchema>;

export function problemFor(error: DomainError, requestId?: string): Problem {
  return {
    type: error.type ?? 'about:blank',
    title: error.title,
    status: error.status,
    detail: error.message,
    ...(requestId ? { requestId } : {}),
    ...(error.errors && error.errors.length > 0
      ? { errors: [...error.errors] as FieldProblem[] }
      : {}),
  };
}

/** The response for a problem, with the `application/problem+json` content type. */
export function problemResponse(problem: Problem, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(problem), {
    status: problem.status,
    headers: { ...headers, 'content-type': PROBLEM_CONTENT_TYPE },
  });
}
