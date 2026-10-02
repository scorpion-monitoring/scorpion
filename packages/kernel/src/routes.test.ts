import { createRoute, z, type AppRoute } from '@scorpion/contracts';
import { describe, expect, it } from 'vitest';
import { useKernels } from '../test/helpers.ts';
import { anonymousOnly, AUTHENTICATOR_REGISTRY, type Authenticator } from './authn.ts';
import { AUTHORIZER_REGISTRY, denyByDefault, type Authorizer } from './authz.ts';
import { KernelStartupError } from './errors.ts';
import { defineModule } from './manifest.ts';

const kernels = useKernels();

const ok = { 200: { description: 'ok' } };
const route = (path: string, access: Record<string, unknown>, method: 'get' | 'post' = 'get') =>
  ({ method, path, responses: ok, ...access }) as AppRoute;
const handler = () => new Response('ok');

async function problemsOf(promise: Promise<unknown>): Promise<readonly string[]> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof KernelStartupError) return error.problems;
    throw error;
  }
  throw new Error('expected startup to fail');
}

describe('route registration', () => {
  it('registers the routes of a module on the surface it names, with the module that owns them', async () => {
    const kernel = await kernels.fixture('routes');
    await kernel.start();

    const summary = kernel.routes.map((r) => `${r.surface} ${r.route.method} ${r.route.path}`);
    expect(summary).toContain('internal get /things');
    expect(summary).toContain('internal post /things');
    expect(summary).toContain('v1 get /ping');
    expect(new Set(kernel.routes.map((r) => r.module))).toEqual(new Set(['fixture.routes']));
    expect(kernel.routes.every((r) => typeof r.handler === 'function')).toBe(true);
  });

  it('fails a route without permission or public: true, naming the module and the route', async () => {
    const kernel = await kernels.fixture('no-permission');
    const problems = await problemsOf(kernel.start());
    expect(problems).toEqual([
      'fixture.no-permission: GET /unprotected needs a permission (or public: true with a publicReason)',
    ]);
  });

  it('says so in the startup message', async () => {
    const kernel = await kernels.fixture('no-permission');
    await expect(kernel.start()).rejects.toThrowError(
      /Cannot register routes:[\s\S]*fixture\.no-permission: GET \/unprotected/,
    );
  });

  const bad: [string, Record<string, unknown>, string][] = [
    [
      'a permission the module does not declare',
      { permission: 'other.write' },
      'names permission "other.write", which its module does not declare',
    ],
    ['a public route without a reason', { public: true }, 'is public: true without a publicReason'],
    [
      'a public route with a permission',
      { public: true, publicReason: 'r', permission: 'mine.read' },
      'is public but also names a permission',
    ],
    [
      'an empty permission',
      { permission: '' },
      'needs a permission (or public: true with a publicReason)',
    ],
  ];
  it.each(bad)('fails %s', async (_name, access, expected) => {
    const kernel = await kernels.inline([
      defineModule({
        id: 'mine',
        version: '1.0.0',
        permissions: { 'mine.read': { description: 'Read' } },
        routes: (r) => r.internal(route('/x', access), handler),
      }),
    ]);
    const problems = await problemsOf(kernel.start());
    expect(problems).toEqual([`mine: GET /x ${expected}`]);
  });

  it('does not accept the permission of another module', async () => {
    const kernel = await kernels.inline(
      [
        defineModule({
          id: 'owner',
          version: '1.0.0',
          permissions: { 'owner.read': { description: 'Read' } },
        }),
        defineModule({
          id: 'thief',
          version: '1.0.0',
          routes: (r) => r.internal(route('/x', { permission: 'owner.read' }), handler),
        }),
      ],
      { thief: ['owner'] },
    );
    expect(await problemsOf(kernel.start())).toEqual([
      'thief: GET /x names permission "owner.read", which its module does not declare',
    ]);
  });

  it('reports the problems of every module at once', async () => {
    const broken = (id: string) =>
      defineModule({
        id,
        version: '1.0.0',
        routes: (r) => r.internal(route(`/${id}`, {}), handler),
      });
    const kernel = await kernels.inline([broken('one'), broken('two')]);
    expect(await problemsOf(kernel.start())).toHaveLength(2);
  });

  it('rejects the same method and path twice on one surface, also across modules', async () => {
    const same = (id: string, surface: 'internal' | 'v1' = 'internal') =>
      defineModule({
        id,
        version: '1.0.0',
        routes: (r) => {
          const definition = route('/x', { public: true, publicReason: 'test' });
          if (surface === 'internal') r.internal(definition, handler);
          else r.public('v1', definition, handler);
        },
      });
    const kernel = await kernels.inline([same('one'), same('two')]);
    expect(await problemsOf(kernel.start())).toEqual([
      'two: GET /x is already registered by one on the internal surface',
    ]);

    const otherSurface = await kernels.inline([same('one'), same('two', 'v1')]);
    await expect(otherSurface.start()).resolves.toBeUndefined();
  });

  it('rejects a path without a leading slash and a missing handler', async () => {
    const kernel = await kernels.inline([
      defineModule({
        id: 'mine',
        version: '1.0.0',
        routes: (r) => {
          r.internal(route('x', { public: true, publicReason: 'test' }), handler);
          r.internal(route('/y', { public: true, publicReason: 'test' }), undefined as never);
        },
      }),
    ]);
    expect(await problemsOf(kernel.start())).toEqual([
      'mine: GET x has a path that does not start with "/"',
      'mine: GET /y has no handler',
    ]);
  });

  it('refuses a route registered after routes() has returned', async () => {
    let late: (() => void) | undefined;
    const kernel = await kernels.inline([
      defineModule({
        id: 'mine',
        version: '1.0.0',
        routes: (r) => {
          late = () => r.internal(route('/late', { public: true, publicReason: 'test' }), handler);
        },
      }),
    ]);
    await kernel.start();
    expect(late).toThrowError(/registered a route too late/);
  });

  it('gives routes() the module’s own service', async () => {
    let seen: unknown;
    const kernel = await kernels.inline([
      defineModule({
        id: 'mine',
        version: '1.0.0',
        services: () => ({ hello: 'world' }),
        routes: (r) => {
          seen = r.service();
        },
      }),
    ]);
    await kernel.start();
    expect(seen).toEqual({ hello: 'world' });
  });

  it('leaves the kernel with no routes when no module has any', async () => {
    const kernel = await kernels.fixture('b-only');
    await kernel.start();
    expect(kernel.routes).toEqual([]);
  });

  it('accepts a route made with createRoute()', async () => {
    const definition = createRoute({
      method: 'get',
      path: '/things',
      permission: 'mine.read',
      request: { query: z.object({ q: z.string().optional() }) },
      responses: ok,
    });
    const kernel = await kernels.inline([
      defineModule({
        id: 'mine',
        version: '1.0.0',
        permissions: { 'mine.read': { description: 'Read' } },
        routes: (r) => r.internal(definition, handler),
      }),
    ]);
    await kernel.start();
    expect(kernel.routes).toHaveLength(1);
  });
});

describe('the authorisation extension point', () => {
  const allow: Authorizer = () => undefined;

  it('denies everything until a module contributes an authoriser (ADR 0005)', async () => {
    const kernel = await kernels.inline([defineModule({ id: 'mine', version: '1.0.0' })]);
    await kernel.start();
    expect(kernel.authorizer).toBe(denyByDefault);
    expect(() => kernel.authorizer({} as never)).toThrowError(/Access is denied/);
  });

  it('uses the authoriser a module contributes, without that module depending on the kernel', async () => {
    const kernel = await kernels.inline([
      defineModule({
        id: 'authz',
        version: '1.0.0',
        contributes: { [AUTHORIZER_REGISTRY]: [{ authorize: allow }] },
      }),
    ]);
    await kernel.start();
    expect(kernel.authorizer).toBe(allow);
  });

  it('rejects an entry that is not a function', async () => {
    const problems = await problemsOf(
      kernels.inline([
        defineModule({
          id: 'authz',
          version: '1.0.0',
          contributes: { [AUTHORIZER_REGISTRY]: [{ authorize: 'yes' }] },
        }),
      ]),
    );
    expect(problems[0]).toMatch(/^authz: registry "kernel.authorizer" entry 0.authorize: /);
  });

  it('refuses two authorisers', async () => {
    const authz = (id: string) =>
      defineModule({
        id,
        version: '1.0.0',
        contributes: { [AUTHORIZER_REGISTRY]: [{ authorize: allow }] },
      });
    expect(await problemsOf(kernels.inline([authz('one'), authz('two')]))).toEqual([
      'more than one module contributes to "kernel.authorizer": one, two',
    ]);
  });
});

describe('the authentication extension point (ADR 0006)', () => {
  const nobody: Authenticator = () => undefined;

  it('leaves every caller anonymous until a module contributes an authenticator', async () => {
    const kernel = await kernels.inline([defineModule({ id: 'mine', version: '1.0.0' })]);
    await kernel.start();
    expect(kernel.authenticator).toBe(anonymousOnly);
    expect(kernel.authenticator({} as never)).toBeUndefined();
  });

  it('uses the authenticator a module contributes, without that module depending on the kernel', async () => {
    const kernel = await kernels.inline([
      defineModule({
        id: 'identity',
        version: '1.0.0',
        contributes: { [AUTHENTICATOR_REGISTRY]: [{ authenticate: nobody }] },
      }),
    ]);
    await kernel.start();
    expect(kernel.authenticator).toBe(nobody);
  });

  it('rejects an entry that is not a function', async () => {
    const problems = await problemsOf(
      kernels.inline([
        defineModule({
          id: 'identity',
          version: '1.0.0',
          contributes: { [AUTHENTICATOR_REGISTRY]: [{ authenticate: 'yes' }] },
        }),
      ]),
    );
    expect(problems[0]).toMatch(
      /^identity: registry "kernel.authenticator" entry 0.authenticate: /,
    );
  });

  it('refuses two authenticators', async () => {
    const identity = (id: string) =>
      defineModule({
        id,
        version: '1.0.0',
        contributes: { [AUTHENTICATOR_REGISTRY]: [{ authenticate: nobody }] },
      });
    expect(await problemsOf(kernels.inline([identity('one'), identity('two')]))).toEqual([
      'more than one module contributes to "kernel.authenticator": one, two',
    ]);
  });
});
