import { describe, expect, it } from 'vitest';
import { PROBLEM_CONTENT_TYPE } from './problem.ts';
import { checkRouteAccess, createRoute, describeRoute, z, type AppRoute } from './route.ts';
import { generateOpenApiDocument } from './openapi.ts';

const codes = (route: { responses: object }) => Object.keys(route.responses).map(Number).sort();
const ok = {
  200: {
    description: 'ok',
    content: { 'application/json': { schema: z.object({ ok: z.boolean() }) } },
  },
};

describe('createRoute', () => {
  it('keeps the permission and adds the standard problem responses', () => {
    const route = createRoute({
      method: 'get',
      path: '/things',
      permission: 'mod.things.read',
      responses: ok,
    });
    expect(route.permission).toBe('mod.things.read');
    expect(codes(route)).toEqual([200, 401, 403, 500]); // no input, so no 422
  });

  it('adds 422 when the route takes input', () => {
    const route = createRoute({
      method: 'get',
      path: '/things',
      permission: 'mod.things.read',
      request: { query: z.object({ q: z.string().optional() }) },
      responses: ok,
    });
    expect(codes(route)).toEqual([200, 401, 403, 422, 500]);
  });

  it('leaves 401 and 403 out of a public route', () => {
    const route = createRoute({
      method: 'get',
      path: '/ping',
      public: true,
      publicReason: 'liveness probe',
      responses: ok,
    });
    expect(codes(route)).toEqual([200, 500]);
  });

  it('lets a route declare its own error responses', () => {
    const own = {
      description: 'custom',
      content: { 'application/json': { schema: z.object({}) } },
    };
    const route = createRoute({
      method: 'get',
      path: '/x',
      permission: 'mod.x',
      responses: { ...ok, 403: own },
    });
    expect((route.responses as Record<number, unknown>)[403]).toBe(own);
  });

  it('refuses at compile time a route with neither permission nor public', () => {
    // @ts-expect-error a route needs `permission` or `public: true`
    createRoute({ method: 'get', path: '/x', responses: ok });
    // @ts-expect-error `public: true` needs a `publicReason`
    createRoute({ method: 'get', path: '/x', public: true, responses: ok });
    // @ts-expect-error a route cannot have both
    createRoute({
      method: 'get',
      path: '/x',
      public: true,
      publicReason: 'r',
      permission: 'p',
      responses: ok,
    });
  });
});

describe('checkRouteAccess', () => {
  const declared = new Set(['mod.things.read']);
  const route = (extra: Partial<AppRoute>): AppRoute => ({
    method: 'get',
    path: '/x',
    responses: {},
    ...extra,
  });

  const cases: [string, Partial<AppRoute>, string | undefined][] = [
    ['a declared permission', { permission: 'mod.things.read' }, undefined],
    ['a public route with a reason', { public: true, publicReason: 'health probe' }, undefined],
    ['neither', {}, 'needs a permission (or public: true with a publicReason)'],
    [
      'an empty permission',
      { permission: '' },
      'needs a permission (or public: true with a publicReason)',
    ],
    [
      'public: false without a permission',
      { public: false },
      'needs a permission (or public: true with a publicReason)',
    ],
    [
      'a permission the module does not declare',
      { permission: 'other.write' },
      'names permission "other.write", which its module does not declare',
    ],
    ['public without a reason', { public: true }, 'is public: true without a publicReason'],
    [
      'public with a blank reason',
      { public: true, publicReason: '   ' },
      'is public: true without a publicReason',
    ],
    [
      'public and a permission',
      { public: true, publicReason: 'r', permission: 'mod.things.read' },
      'is public but also names a permission',
    ],
  ];
  it.each(cases)('%s', (_name, extra, expected) => {
    expect(checkRouteAccess(route(extra), declared)).toBe(expected);
  });
});

describe('describeRoute', () => {
  it('names a route by method and path', () => {
    expect(describeRoute({ method: 'post', path: '/things/{id}' })).toBe('POST /things/{id}');
  });
});

describe('generateOpenApiDocument', () => {
  const list = createRoute({
    method: 'get',
    path: '/things',
    permission: 'mod.things.read',
    request: { query: z.object({ q: z.string().optional() }) },
    responses: ok,
  });
  const ping = createRoute({
    method: 'get',
    path: '/ping',
    public: true,
    publicReason: 'probe',
    responses: ok,
  });

  it('lists the paths, the servers and the permissions', () => {
    const document = generateOpenApiDocument([list, ping], {
      title: 'Test API',
      version: '1.0.0',
      servers: ['https://example.org/a/b/api/v1'],
    });
    expect(document.openapi).toBe('3.1.0');
    expect(document.info).toMatchObject({ title: 'Test API', version: '1.0.0' });
    expect(document.servers).toEqual([{ url: 'https://example.org/a/b/api/v1' }]);
    expect(Object.keys(document.paths ?? {}).sort()).toEqual(['/ping', '/things']);
    expect(document.paths?.['/things']?.get).toMatchObject({ 'x-permission': 'mod.things.read' });
    expect(document.paths?.['/ping']?.get).toMatchObject({ 'x-public': true });
  });

  it('documents the problem responses with application/problem+json', () => {
    const document = generateOpenApiDocument([list], { title: 'T', version: '1' });
    const responses = (
      document.paths?.['/things']?.get as { responses: Record<string, { content: object }> }
    ).responses;
    expect(Object.keys(responses).sort()).toEqual(['200', '401', '403', '422', '500']);
    expect(Object.keys(responses['403']!.content)).toEqual([PROBLEM_CONTENT_TYPE]);
    expect(JSON.stringify(document.components)).toContain('Problem');
  });

  it('rejects two routes with the same method and path', () => {
    expect(() => generateOpenApiDocument([list, list], { title: 'T', version: '1' })).toThrowError(
      'Route GET /things is defined twice',
    );
  });

  it('produces an empty document for no routes', () => {
    expect(generateOpenApiDocument([], { title: 'T', version: '1' }).paths).toEqual({});
  });
});
