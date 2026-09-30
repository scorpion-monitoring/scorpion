import { describe, expect, it } from 'vitest';
import { Conflict, DomainError, Forbidden, Invalid, NotFound, Unauthorized } from './errors.ts';
import { PROBLEM_CONTENT_TYPE, problemFor, problemResponse, problemSchema } from './problem.ts';

describe('domain errors', () => {
  const cases: [string, DomainError, number, string][] = [
    ['NotFound', new NotFound(), 404, 'Not Found'],
    ['Conflict', new Conflict(), 409, 'Conflict'],
    ['Forbidden', new Forbidden(), 403, 'Forbidden'],
    ['Unauthorized', new Unauthorized(), 401, 'Unauthorized'],
    ['Invalid', new Invalid(), 422, 'Unprocessable Content'],
  ];
  it.each(cases)('%s maps to its status and title', (name, error, status, title) => {
    expect(error).toBeInstanceOf(DomainError);
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe(name);
    expect(error.status).toBe(status);
    expect(error.title).toBe(title);
    expect(error.message.length).toBeGreaterThan(0);
  });

  it('carries a custom detail', () => {
    expect(new NotFound('No service "abc".').message).toBe('No service "abc".');
  });
});

describe('problemFor', () => {
  it('builds a valid RFC 9457 problem with the request id', () => {
    const problem = problemFor(new NotFound('No such service.'), 'req-123');
    expect(problem).toEqual({
      type: 'about:blank',
      title: 'Not Found',
      status: 404,
      detail: 'No such service.',
      requestId: 'req-123',
    });
    expect(problemSchema.safeParse(problem).success).toBe(true);
  });

  it('lists the field problems of Invalid', () => {
    const problem = problemFor(
      new Invalid('Check the fields.', [{ in: 'body', path: 'name', message: 'Too short' }]),
    );
    expect(problem.errors).toEqual([{ in: 'body', path: 'name', message: 'Too short' }]);
    expect(problem).not.toHaveProperty('requestId');
  });

  it('leaves out an empty errors list', () => {
    expect(problemFor(new Invalid('x', []))).not.toHaveProperty('errors');
  });
});

describe('problemResponse', () => {
  it('uses the problem status and content type', async () => {
    const response = problemResponse(problemFor(new Conflict()), { 'x-request-id': 'r1' });
    expect(response.status).toBe(409);
    expect(response.headers.get('content-type')).toBe(PROBLEM_CONTENT_TYPE);
    expect(response.headers.get('x-request-id')).toBe('r1');
    expect(((await response.json()) as { title: string }).title).toBe('Conflict');
  });
});
