import { describe, expect, it } from 'vitest';
import { ApiError, createApiClient, retryAfterSeconds, unwrap } from './client.ts';

interface Seen {
  method: string;
  url: string;
  headers: Headers;
  body: string;
}

function setup(
  answer: () => Response,
  options: Partial<Parameters<typeof createApiClient>[0]> = {},
) {
  const seen: Seen[] = [];
  const api = createApiClient({
    basePath: '/',
    fetch: async (input, init) => {
      const request = new Request(input, init);
      seen.push({
        method: request.method,
        url: request.url,
        headers: request.headers,
        body: await request.clone().text(),
      });
      return answer();
    },
    ...options,
  });
  return { api, seen };
}

const json = (body: unknown, status = 200) => Response.json(body, { status });
const problem = (status: number, extra: object = {}) =>
  new Response(JSON.stringify({ type: 'about:blank', title: 'Problem', status, ...extra }), {
    status,
    headers: { 'content-type': 'application/problem+json' },
  });

describe('the base of a request', () => {
  it.each([
    ['/', 'http://api.test', 'http://api.test/api/internal/auth/me'],
    ['/a/b/c', 'http://api.test', 'http://api.test/a/b/c/api/internal/auth/me'],
    ['/a', 'http://127.0.0.1:3001', 'http://127.0.0.1:3001/a/api/internal/auth/me'],
  ])('BASE_PATH %s on %s', async (basePath, origin, expected) => {
    const { api, seen } = setup(() => json({}), { basePath, origin });
    await api.GET('/auth/me');
    expect(seen[0]!.url).toBe(expected);
  });

  it('is relative to the page in the browser (no origin)', async () => {
    const { api, seen } = setup(() => json({}), { basePath: '/a/b' });
    // A test fetch must be absolute for `Request`; the path part is what a browser would resolve.
    await api
      .GET('/auth/me', { baseUrl: 'http://page.test/a/b/api/internal' })
      .catch(() => undefined);
    expect(new URL(seen[0]!.url).pathname).toBe('/a/b/api/internal/auth/me');
  });

  it('refuses a BASE_PATH the server would refuse', () => {
    expect(() => createApiClient({ basePath: 'a/b', origin: 'http://x' })).toThrow();
    expect(() => createApiClient({ basePath: '/a/../b', origin: 'http://x' })).toThrow();
  });
});

describe('the headers of a request', () => {
  it('sends the CSRF token on every unsafe method and on no safe one', async () => {
    const { api, seen } = setup(() => json({}), { origin: 'http://x', csrfToken: () => 'tok' });
    await api.GET('/auth/me');
    await api.POST('/auth/logout');
    await api.DELETE('/account/sessions/{id}', { params: { path: { id: 'abc' } } });
    expect(seen.map((s) => [s.method, s.headers.get('x-csrf-token')])).toEqual([
      ['GET', null],
      ['POST', 'tok'],
      ['DELETE', 'tok'],
    ]);
  });

  it('reads the token when the request is made, so a new session is used at once', async () => {
    const state: { token?: string } = {};
    const { api, seen } = setup(() => json({}), {
      origin: 'http://x',
      csrfToken: () => state.token,
    });
    await api.POST('/auth/logout');
    state.token = 'later';
    await api.POST('/auth/logout');
    expect(seen.map((s) => s.headers.get('x-csrf-token'))).toEqual([null, 'later']);
  });

  it('forwards the cookie and the extra headers of a server-side call', async () => {
    const { api, seen } = setup(() => json({}), {
      origin: 'http://x',
      cookie: () => '__Host-session=abc',
      headers: () => ({ 'x-forwarded-for': '203.0.113.9' }),
    });
    await api.GET('/auth/me');
    expect(seen[0]!.headers.get('cookie')).toBe('__Host-session=abc');
    expect(seen[0]!.headers.get('x-forwarded-for')).toBe('203.0.113.9');
  });

  it('adds no cookie header when there is none to forward', async () => {
    const { api, seen } = setup(() => json({}), { origin: 'http://x', cookie: () => undefined });
    await api.GET('/auth/me');
    expect(seen[0]!.headers.has('cookie')).toBe(false);
  });
});

describe('unwrap', () => {
  it('returns the data of a success', async () => {
    const { api } = setup(() => json({ roles: ['user'] }), { origin: 'http://x' });
    expect(await unwrap(api.GET('/auth/me'))).toEqual({ roles: ['user'] });
  });

  it('throws an ApiError with the problem for a failure, and keeps the field errors of a 422', async () => {
    const errors = [{ in: 'body', path: 'password', message: 'is too short' }];
    const { api } = setup(() => problem(422, { detail: 'The request is not valid.', errors }), {
      origin: 'http://x',
    });
    const failure = await unwrap(api.GET('/auth/me')).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(ApiError);
    expect(failure).toMatchObject({ status: 422, message: 'The request is not valid.' });
    expect((failure as ApiError).problem?.errors).toEqual(errors);
  });

  it('carries the Retry-After of a throttled answer and the stable type of a problem', async () => {
    const { api } = setup(
      () =>
        new Response(JSON.stringify({ type: 'account-pending', title: 'Too Many', status: 429 }), {
          status: 429,
          headers: { 'content-type': 'application/problem+json', 'retry-after': '12' },
        }),
      { origin: 'http://x' },
    );
    const failure = (await unwrap(api.GET('/auth/me')).catch((e: unknown) => e)) as ApiError;
    expect(failure.retryAfterSeconds).toBe(12);
    expect(failure.type).toBe('account-pending');
  });

  it.each([
    ['5', 5],
    [' 30 ', 30],
    ['Wed, 21 Oct 2026 07:28:00 GMT', undefined],
    ['-3', undefined],
    ['1.5', undefined],
    [null, undefined],
  ])('reads a Retry-After of %j as %j', (header, expected) => {
    expect(retryAfterSeconds(header)).toBe(expected);
  });

  it('has no type for about:blank', async () => {
    const { api } = setup(() => problem(404, { detail: 'No.' }), { origin: 'http://x' });
    const failure = (await unwrap(api.GET('/auth/me')).catch((e: unknown) => e)) as ApiError;
    expect(failure.type).toBeUndefined();
    expect(failure.retryAfterSeconds).toBeUndefined();
  });

  it('throws an ApiError without a problem when the body is not one (a proxy error page)', async () => {
    const { api } = setup(() => new Response('Bad gateway', { status: 502 }), {
      origin: 'http://x',
    });
    const failure = await unwrap(api.GET('/auth/me')).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(ApiError);
    expect(failure).toMatchObject({ status: 502, problem: undefined });
  });

  it('lets a network failure through as it is', async () => {
    const api = createApiClient({
      basePath: '/',
      origin: 'http://x',
      fetch: () => Promise.reject(new TypeError('fetch failed')),
    });
    await expect(unwrap(api.GET('/auth/me'))).rejects.toThrow('fetch failed');
  });
});

describe('the client in a browser with a strict Content-Security-Policy', () => {
  it('asks zod not to compile parsers with `new Function`, which the policy would block', async () => {
    const { z } = await import('@hono/zod-openapi');
    expect(z.config().jitless).toBe(true);
  });
});
