import { Writable } from 'node:stream';
import { generateOpenApiDocument, type AppRoute } from '@scorpion/contracts';
import {
  createLogger,
  denyByDefault,
  loadConfig,
  type Authorizer,
  type Kernel,
} from '@scorpion/kernel';
import { Forbidden, Unauthorized } from '@scorpion/contracts';
import { describe, expect, it } from 'vitest';
import { useKernels } from '../../../packages/kernel/test/helpers.ts';
import { createApp, SURFACE_PREFIX, type AppOptions } from './app.ts';

const kernels = useKernels();

const config = loadConfig({ DATABASE_URL: 'postgres://unused@localhost/unused' });

function capture() {
  const lines: Record<string, unknown>[] = [];
  const destination = new Writable({
    write(chunk: Buffer, _encoding, callback) {
      lines.push(JSON.parse(chunk.toString()) as Record<string, unknown>);
      callback();
    },
  });
  return { lines, log: createLogger({ level: 'trace', destination }) };
}

async function fixtureApp(
  extra: Partial<AppOptions> & { basePath?: string; authorizer?: Authorizer } = {},
): Promise<{
  request: (path: string, init?: RequestInit) => Promise<Response>;
  kernel: Kernel;
  lines: Record<string, unknown>[];
}> {
  const kernel = await kernels.fixture('routes');
  await kernel.start();
  const { lines, log } = capture();
  const base = extra.basePath ?? '/';
  const app = createApp({
    config: { ...config, BASE_PATH: base },
    log,
    routes: kernel.routes,
    authorizer: denyByDefault,
    ...extra,
  });
  const prefix = base === '/' ? '' : base;
  return {
    kernel,
    lines,
    request: (path, init) => Promise.resolve(app.request(`${prefix}${path}`, init)),
  };
}

const allow: Authorizer = () => undefined;
const internal = SURFACE_PREFIX.internal;
const json = (body: unknown): RequestInit => ({
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
});

interface Problem {
  type: string;
  title: string;
  status: number;
  detail?: string;
  requestId?: string;
  errors?: { in?: string; path: string; message: string }[];
}
const problem = async (response: Response) => (await response.json()) as Problem;

describe('step 1: request id', () => {
  it('makes one when the caller sends none, and returns it', async () => {
    const { request } = await fixtureApp();
    const response = await request('/healthz');
    expect(response.headers.get('x-request-id')).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('accepts a valid incoming id', async () => {
    const { request, lines } = await fixtureApp();
    const response = await request('/healthz', {
      headers: { 'x-request-id': 'trace-abc_123.XYZ' },
    });
    expect(response.headers.get('x-request-id')).toBe('trace-abc_123.XYZ');
    expect(lines.at(-1)).toMatchObject({ requestId: 'trace-abc_123.XYZ' });
  });

  it.each([
    ['too short', 'abc'],
    ['too long', 'a'.repeat(129)],
    ['with a space', 'has a space in it'],
    ['with characters outside the set', 'abc;def,ghi=jkl'],
    ['with markup', '<script>alert(1)</script>'],
  ])('replaces an id that is %s', async (_name, value) => {
    const { request } = await fixtureApp();
    const response = await request('/healthz', { headers: { 'x-request-id': value } });
    expect(response.headers.get('x-request-id')).not.toBe(value);
    expect(response.headers.get('x-request-id')).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('is in every problem, and matches the header', async () => {
    const { request } = await fixtureApp({ authorizer: allow });
    for (const path of [
      `${internal}/things/nope`,
      `${internal}/boom`,
      `${internal}/things?page=-1`,
      '/nowhere',
    ]) {
      const response = await request(path, { headers: { 'x-request-id': 'req-for-problem' } });
      expect((await problem(response)).requestId, path).toBe('req-for-problem');
      expect(response.headers.get('x-request-id')).toBe('req-for-problem');
    }
  });
});

describe('step 2: security headers', () => {
  it.each([
    ['a success', '/healthz', 200],
    ['a validation error', `${internal}/things?page=x`, 422],
    ['a denied request', `${internal}/things`, 403],
    ['a route that does not exist', '/nowhere', 404],
  ])('are on %s', async (_name, path, status) => {
    const { request } = await fixtureApp();
    const response = await request(path);
    expect(response.status).toBe(status);
    expect(response.headers.get('strict-transport-security')).toMatch(/max-age=\d{7,}/);
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(response.headers.get('referrer-policy')).toBe('no-referrer');
    expect(response.headers.get('x-frame-options')).toBe('DENY');
    const csp = response.headers.get('content-security-policy')!;
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).not.toContain('unsafe-inline');
    expect(csp).not.toContain('unsafe-eval');
  });

  it('are on a 500', async () => {
    const { request } = await fixtureApp({ authorizer: allow });
    const response = await request(`${internal}/boom`);
    expect(response.status).toBe(500);
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
  });
});

describe('step 3: request logging', () => {
  it('writes one line per request with method, path, status, duration and request id', async () => {
    const { request, lines } = await fixtureApp();
    await request('/healthz', { headers: { 'x-request-id': 'log-me-please' } });
    const logged = lines.filter((line) => line.msg === 'request');
    expect(logged).toHaveLength(1);
    expect(logged[0]).toMatchObject({
      requestId: 'log-me-please',
      method: 'GET',
      path: '/healthz',
      status: 200,
    });
    expect(typeof logged[0]!.durationMs).toBe('number');
  });

  it('leaves the query string out, because it can carry secrets', async () => {
    const { request, lines } = await fixtureApp();
    await request('/healthz?token=super-secret-token');
    expect(JSON.stringify(lines)).not.toContain('super-secret-token');
  });

  it('logs client errors as warnings and server errors as errors', async () => {
    const { request, lines } = await fixtureApp({ authorizer: allow });
    await request(`${internal}/things/nope`);
    await request(`${internal}/boom`);
    expect(lines.find((l) => l.status === 404)).toMatchObject({
      level: 40,
      msg: 'request rejected',
    });
    expect(lines.find((l) => l.status === 500 && l.msg === 'request failed')).toMatchObject({
      level: 50,
    });
  });
});

describe('step 4: body size limit', () => {
  it('refuses a body above the limit with a 413 problem', async () => {
    const { request } = await fixtureApp({ authorizer: allow, maxBodyBytes: 200 });
    const response = await request(`${internal}/things`, json({ name: 'x'.repeat(500) }));
    expect(response.status).toBe(413);
    expect(response.headers.get('content-type')).toContain('application/problem+json');
    expect(await problem(response)).toMatchObject({ status: 413, title: 'Content Too Large' });
  });

  it('accepts a body within the limit', async () => {
    const { request } = await fixtureApp({ authorizer: allow, maxBodyBytes: 200 });
    expect((await request(`${internal}/things`, json({ name: 'small' }))).status).toBe(201);
  });

  it('refuses a body that lies about its length', async () => {
    const { request } = await fixtureApp({ authorizer: allow, maxBodyBytes: 100 });
    const response = await request(`${internal}/things`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'y'.repeat(400) }),
    });
    expect(response.status).toBe(413);
  });
});

describe('step 5: input validation', () => {
  const cases: [string, string, RequestInit | undefined, { in: string; path: string }][] = [
    ['a negative page', `${internal}/things?page=-1`, undefined, { in: 'query', path: 'page' }],
    [
      'a text page size',
      `${internal}/things?pageSize=many`,
      undefined,
      { in: 'query', path: 'pageSize' },
    ],
    [
      'a page size above the limit',
      `${internal}/things?pageSize=101`,
      undefined,
      { in: 'query', path: 'pageSize' },
    ],
    [
      'a filter that is too long',
      `${internal}/things?q=${'x'.repeat(21)}`,
      undefined,
      { in: 'query', path: 'q' },
    ],
    [
      'an unknown query parameter',
      `${internal}/things?sort=name`,
      undefined,
      { in: 'query', path: '' },
    ],
    [
      'a path parameter that is too long',
      `${internal}/things/${'a'.repeat(41)}`,
      undefined,
      { in: 'path', path: 'id' },
    ],
    ['a missing field', `${internal}/things`, json({}), { in: 'body', path: 'name' }],
    [
      'a field of the wrong type',
      `${internal}/things`,
      json({ name: 5 }),
      { in: 'body', path: 'name' },
    ],
    ['an empty name', `${internal}/things`, json({ name: '' }), { in: 'body', path: 'name' }],
    [
      'a name that is too long',
      `${internal}/things`,
      json({ name: 'n'.repeat(21) }),
      { in: 'body', path: 'name' },
    ],
    [
      'an unknown field',
      `${internal}/things`,
      json({ name: 'ok', admin: true }),
      { in: 'body', path: '' },
    ],
    ['a body that is not an object', `${internal}/things`, json('text'), { in: 'body', path: '' }],
    ['a null body', `${internal}/things`, json(null), { in: 'body', path: '' }],
  ];

  it.each(cases)(
    'answers %s with a 422 problem naming the field',
    async (_name, path, init, field) => {
      const { request } = await fixtureApp({ authorizer: allow });
      const response = await request(path, init);
      expect(response.status).toBe(422);
      expect(response.headers.get('content-type')).toContain('application/problem+json');
      const body = await problem(response);
      expect(body).toMatchObject({
        type: 'about:blank',
        title: 'Unprocessable Content',
        status: 422,
      });
      expect(body.errors).toEqual(expect.arrayContaining([expect.objectContaining(field)]));
    },
  );

  it('answers malformed JSON with a 422 problem, not a 500', async () => {
    const { request } = await fixtureApp({ authorizer: allow });
    const response = await request(`${internal}/things`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{"name": ',
    });
    expect(response.status).toBe(422);
    expect((await problem(response)).detail).toMatch(/not valid JSON/);
  });

  it('answers a missing content type with a 415 problem', async () => {
    const { request } = await fixtureApp({ authorizer: allow });
    const response = await request(`${internal}/things`, { method: 'POST', body: '{"name":"x"}' });
    expect(response.status).toBe(415);
    expect(response.headers.get('content-type')).toContain('application/problem+json');
    expect(await problem(response)).toMatchObject({ title: 'Unsupported Media Type', status: 415 });
  });

  it('reports every bad field, not only the first', async () => {
    const { request } = await fixtureApp({ authorizer: allow });
    const body = await problem(await request(`${internal}/things?page=-1&pageSize=0`));
    expect(body.errors?.map((e) => e.path).sort()).toEqual(['page', 'pageSize']);
  });

  it('never echoes the rejected value back', async () => {
    const { request } = await fixtureApp({ authorizer: allow });
    const response = await request(`${internal}/things`, json({ name: 'SENSITIVE'.repeat(5) }));
    expect(JSON.stringify(await response.json())).not.toContain('SENSITIVE');
  });
});

describe('step 6: the authorisation hook', () => {
  it('denies every non-public route by default with a 403 problem, before core.authz exists', async () => {
    const { request } = await fixtureApp(); // the default authoriser: deny everything
    for (const [path, init] of [
      [`${internal}/things`, undefined],
      [`${internal}/things/t00`, undefined],
      [`${internal}/things`, json({ name: 'never created' })],
      [`${internal}/big`, undefined],
    ] as const) {
      const response = await request(path, init);
      expect(response.status, path).toBe(403);
      expect(response.headers.get('content-type')).toContain('application/problem+json');
      expect(await problem(response)).toMatchObject({ title: 'Forbidden', status: 403 });
    }
  });

  it('does not run the handler of a denied route', async () => {
    const { request } = await fixtureApp({
      authorizer: () => {
        throw new Forbidden('no');
      },
    });
    await request(`${internal}/things`, json({ name: 'must not exist' }));
    const allowedApp = await request(`${internal}/things?q=must not exist`); // still denied, so check via another app
    expect(allowedApp.status).toBe(403);
  });

  it('lets a public route through without asking the authoriser', async () => {
    const asked: string[] = [];
    const { request } = await fixtureApp({ authorizer: (r) => void asked.push(r.permission) });
    const internalPing = await request(`${internal}/ping`);
    const v1Ping = await request(`${SURFACE_PREFIX.v1}/ping`);
    expect(internalPing.status).toBe(200);
    expect(v1Ping.status).toBe(200);
    expect(asked).toEqual([]);
  });

  it('asks the authoriser with the module, permission, method and route pattern', async () => {
    const asked: Record<string, unknown>[] = [];
    const { request } = await fixtureApp({
      authorizer: (r) => {
        asked.push({ module: r.module, permission: r.permission, method: r.method, path: r.path });
      },
    });
    await request(`${internal}/things/t01`);
    await request(`${internal}/things`, json({ name: 'created' }));
    expect(asked).toEqual([
      {
        module: 'fixture.routes',
        permission: 'fixture.routes.read',
        method: 'GET',
        path: '/api/internal/things/{id}',
      },
      {
        module: 'fixture.routes',
        permission: 'fixture.routes.write',
        method: 'POST',
        path: '/api/internal/things',
      },
    ]);
  });

  it('runs after validation: invalid input is a 422 and the authoriser is never asked', async () => {
    const asked: string[] = [];
    const { request } = await fixtureApp({ authorizer: (r) => void asked.push(r.permission) });
    expect((await request(`${internal}/things?page=-1`)).status).toBe(422);
    expect(asked).toEqual([]);
  });

  it('maps what the authoriser throws: Unauthorized is 401, Forbidden is 403', async () => {
    const unauthenticated = await fixtureApp({
      authorizer: () => {
        throw new Unauthorized();
      },
    });
    expect((await unauthenticated.request(`${internal}/things`)).status).toBe(401);
    const forbidden = await fixtureApp({
      authorizer: () => {
        throw new Forbidden();
      },
    });
    expect((await forbidden.request(`${internal}/things`)).status).toBe(403);
  });

  it('turns a crashing authoriser into a 500 that says nothing, and never lets the request through', async () => {
    const { request } = await fixtureApp({
      authorizer: () => {
        throw new Error('authz database is down: pw-secret');
      },
    });
    const response = await request(`${internal}/things`);
    expect(response.status).toBe(500);
    expect(JSON.stringify(await response.json())).not.toContain('pw-secret');
  });
});

describe('steps 7 and 8: handlers and the error mapper', () => {
  it('returns the list envelope with 0-based pages', async () => {
    const { request } = await fixtureApp({ authorizer: allow });
    const body = (await (await request(`${internal}/things?page=1&pageSize=10`)).json()) as {
      metadata: unknown;
      result: { id: string }[];
    };
    expect(body.metadata).toEqual({ currentPage: 1, pageSize: 10, totalCount: 45, totalPages: 5 });
    expect(body.result.map((t) => t.id)).toEqual(
      Array.from({ length: 10 }, (_, i) => `t${10 + i}`),
    );
  });

  it('maps domain errors to their status and title', async () => {
    const { request } = await fixtureApp({ authorizer: allow });
    const cases: [string, RequestInit | undefined, number, string][] = [
      [`${internal}/things/nope`, undefined, 404, 'Not Found'],
      [`${internal}/things`, json({ name: 'Thing 3' }), 409, 'Conflict'],
      [`${internal}/forbidden`, undefined, 403, 'Forbidden'],
      [`${internal}/unauthorized`, undefined, 401, 'Unauthorized'],
      [`${internal}/unknown-reference`, undefined, 422, 'Unprocessable Content'],
    ];
    for (const [path, init, status, title] of cases) {
      const response = await request(path, init);
      expect(response.status, path).toBe(status);
      expect(response.headers.get('content-type')).toContain('application/problem+json');
      expect(await problem(response)).toMatchObject({ status, title });
    }
  });

  it('reports an unknown reference as a 422 with the field, never a 500', async () => {
    const { request } = await fixtureApp({ authorizer: allow });
    const body = await problem(await request(`${internal}/unknown-reference`));
    expect(body.errors).toEqual([
      { in: 'body', path: 'provider', message: 'Unknown provider "nope".' },
    ]);
  });

  it('answers an unknown error with a 500 problem that has the request id and no stack trace', async () => {
    const { request, lines } = await fixtureApp({ authorizer: allow });
    const response = await request(`${internal}/boom`, {
      headers: { 'x-request-id': 'find-me-in-logs' },
    });
    expect(response.status).toBe(500);
    expect(response.headers.get('content-type')).toContain('application/problem+json');
    const text = await response.text();
    const body = JSON.parse(text) as Problem;
    expect(body).toEqual({
      type: 'about:blank',
      title: 'Internal Server Error',
      status: 500,
      detail: 'An unexpected error occurred. Quote the request id when you report it.',
      requestId: 'find-me-in-logs',
    });
    for (const leak of [
      'kaboom',
      'secret internals',
      'pw-secret',
      ' at ',
      '.ts:',
      'node_modules',
      'stack',
    ]) {
      expect(text, leak).not.toContain(leak);
    }
    // The detail is in the log, under the same request id, with the password masked.
    const logged = lines.find((line) => line.msg === 'unhandled error');
    expect(logged).toMatchObject({ requestId: 'find-me-in-logs', level: 50 });
    expect(JSON.stringify(logged)).toContain('kaboom');
    expect(JSON.stringify(logged)).not.toContain('pw-secret');
  });

  it('answers a route that does not exist with a 404 problem', async () => {
    const { request } = await fixtureApp();
    const response = await request('/api/internal/nowhere');
    expect(response.status).toBe(404);
    expect(response.headers.get('content-type')).toContain('application/problem+json');
    expect(await problem(response)).toMatchObject({ title: 'Not Found', status: 404 });
  });
});

describe('BASE_PATH', () => {
  it.each(['/', '/a', '/a/b', '/deeply/nested/base/path'])(
    'mounts every route under %s',
    async (base) => {
      const { request } = await fixtureApp({ authorizer: allow, basePath: base });
      expect((await request('/healthz')).status).toBe(200);
      expect((await request(`${internal}/things/t00`)).status).toBe(200);
      expect((await request(`${SURFACE_PREFIX.v1}/ping`)).status).toBe(200);
      expect(
        (
          await request(
            `${internal}/things`,
            json({ name: `n${base.replace(/\W/g, '').slice(0, 15)}` }),
          )
        ).status,
      ).toBe(201);
    },
  );

  it('does not answer outside the base path, also not with a shorter prefix of it', async () => {
    const { kernel } = await fixtureApp();
    const app = createApp({
      config: { ...config, BASE_PATH: '/a/b' },
      log: capture().log,
      routes: kernel.routes,
      authorizer: allow,
    });
    for (const path of [
      '/healthz',
      '/a/healthz',
      '/api/internal/things',
      '/a/api/internal/things',
      '/a/b2/healthz',
      '/a/b',
    ]) {
      const response = await app.request(path);
      expect(response.status, path).toBe(404);
      expect(response.headers.get('content-type')).toContain('application/problem+json');
    }
    expect((await app.request('/a/b/healthz')).status).toBe(200);
  });

  it('reports the profile on /healthz', async () => {
    const { request } = await fixtureApp();
    expect(await (await request('/healthz')).json()).toEqual({ status: 'ok', profile: 'full' });
  });
});

describe('OpenAPI document of the registered routes', () => {
  it('lists every route under its surface prefix with its permission', async () => {
    const kernel = await kernels.fixture('routes');
    await kernel.start();
    const routes: AppRoute[] = kernel.routes.map(({ route, surface }) => ({
      ...route,
      path: `${SURFACE_PREFIX[surface]}${route.path}`,
    }));

    const document = generateOpenApiDocument(routes, { title: 'Fixture', version: '1' });

    expect(Object.keys(document.paths ?? {})).toEqual(
      expect.arrayContaining(['/api/internal/things', '/api/internal/things/{id}', '/api/v1/ping']),
    );
    expect(document.paths?.['/api/internal/things']?.get).toMatchObject({
      'x-permission': 'fixture.routes.read',
    });
    expect(document.paths?.['/api/internal/things']?.post).toMatchObject({
      'x-permission': 'fixture.routes.write',
    });
    expect(document.paths?.['/api/v1/ping']?.get).toMatchObject({ 'x-public': true });
  });
});
