import type { UiRoute } from '@scorpion/contracts';
import { ApiError } from '@scorpion/contracts/client';
import type { Navigation, Session } from '@scorpion/contracts/client';
import { isHttpError, isRedirect } from '@sveltejs/kit';
import { describe, expect, it } from 'vitest';
import { loadPage, safeQuery, type PageRequest, type PageTable } from './page.ts';

const component = () => Promise.reject(new Error('not rendered here'));
const calls: { params: Record<string, string> }[] = [];
const routes: [string, UiRoute][] = [
  ['/', { path: '/', component }],
  ['/admin/users', { path: '/admin/users', component }],
  [
    '/admin/users/:id',
    {
      path: '/admin/users/:id',
      component,
      load: ({ params }) => {
        calls.push({ params });
        return { id: params.id };
      },
    },
  ],
  [
    '/boom',
    {
      path: '/boom',
      component,
      load: () => {
        throw new Error('a bug in a loader');
      },
    },
  ],
  [
    '/gone',
    {
      path: '/gone',
      component,
      load: () => {
        throw new ApiError(404, undefined);
      },
    },
  ],
  [
    '/down',
    {
      path: '/down',
      component,
      load: () => {
        throw new ApiError(500, undefined);
      },
    },
  ],
];
const table: PageTable = {
  patterns: routes.map(([pattern]) => pattern),
  pages: new Map(routes.map(([pattern, route]) => [pattern, { package: 'fixture', route }])),
};

const session = { user: { id: 'u' }, roles: ['user'], csrfToken: 't' } as unknown as Session;
function request(
  path: string,
  options: { signedIn?: boolean; routes?: string[]; basePath?: string } = {},
): PageRequest {
  return {
    url: new URL(`http://localhost${path}`),
    basePath: options.basePath ?? '/',
    api: {} as never,
    session: () => Promise.resolve(options.signedIn ? session : null),
    navigation: () =>
      Promise.resolve({
        routes: options.routes ?? ['/'],
        nav: [],
        widgets: [],
        themes: [],
      } as Navigation),
    publicApi: { openapi: '3.1.0', info: { title: 't', version: '1' } },
  };
}

async function outcome(table_: PageTable, req: PageRequest) {
  try {
    return { result: await loadPage(table_, req) };
  } catch (thrown) {
    return { thrown };
  }
}

describe('loadPage', () => {
  it('opens a page the caller may open and passes the parameters to its load', async () => {
    const { result } = await outcome(
      table,
      request('/admin/users/42', { signedIn: true, routes: ['/', '/admin/users/:id'] }),
    );
    expect(result).toEqual({
      pattern: '/admin/users/:id',
      params: { id: '42' },
      data: { id: '42' },
    });
    expect(calls.at(-1)?.params).toEqual({ id: '42' });
  });

  it('gives a page without a load the data null', async () => {
    const { result } = await outcome(table, request('/'));
    expect(result).toEqual({ pattern: '/', params: {}, data: null });
  });

  it('answers 404 for a path no module registered, without asking who the caller is', async () => {
    const { thrown } = await outcome(table, request('/nothing/here', { signedIn: true }));
    expect(isHttpError(thrown) && thrown.status).toBe(404);
  });

  it('answers 403 to a signed-in caller the API did not list the page for: a plain user at an admin path', async () => {
    const { thrown } = await outcome(
      table,
      request('/admin/users', { signedIn: true, routes: ['/'] }),
    );
    expect(isHttpError(thrown) && thrown.status).toBe(403);
    const sub = await outcome(table, request('/admin/users/7', { signedIn: true, routes: ['/'] }));
    expect(isHttpError(sub.thrown) && sub.thrown.status).toBe(403);
  });

  it('sends an anonymous caller to sign in, with the page they wanted as a returnTo under the base path', async () => {
    for (const [basePath, expected] of [
      ['/', '/login?returnTo=%2Fadmin%2Fusers%3Ftab%3D2'],
      ['/a/b/c', '/a/b/c/login?returnTo=%2Fa%2Fb%2Fc%2Fadmin%2Fusers%3Ftab%3D2'],
    ] as const) {
      const { thrown } = await outcome(table, request('/admin/users?tab=2', { basePath }));
      expect(isRedirect(thrown)).toBe(true);
      expect(isRedirect(thrown) && thrown.status).toBe(303);
      expect(isRedirect(thrown) && thrown.location).toBe(expected);
    }
  });

  it('never runs the load of a page the caller may not open', async () => {
    const before = calls.length;
    await outcome(table, request('/admin/users/9', { signedIn: true, routes: ['/'] }));
    expect(calls.length).toBe(before);
  });

  it('turns what a load throws into an HTTP error, and never returns a response (defect 12)', async () => {
    const gone = await outcome(table, request('/gone', { routes: ['/gone'] }));
    expect(isHttpError(gone.thrown) && gone.thrown.status).toBe(404);
    const down = await outcome(table, request('/down', { routes: ['/down'] }));
    expect(isHttpError(down.thrown) && down.thrown.status).toBe(502);
    const bug = await outcome(table, request('/boom', { routes: ['/boom'] }));
    expect(bug.result).toBeUndefined();
    expect((bug.thrown as Error).message).toBe('a bug in a loader');
  });

  it('does not match a path with an encoded slash or a dot segment', async () => {
    for (const path of ['/admin/users/a%2Fb', '/admin/users/%2e%2e']) {
      const { thrown } = await outcome(
        table,
        request(path, { signedIn: true, routes: ['/admin/users/:id'] }),
      );
      expect(isHttpError(thrown) && thrown.status, path).toBe(404);
    }
  });

  it('never redirects anywhere but to the login page of this application, whatever the path or the query says (open redirect)', async () => {
    const hostile = [
      '/admin/users?next=//evil.example',
      '/admin/users?returnTo=https://evil.example/',
      '//evil.example/admin/users',
      '/%2F%2Fevil.example',
      '/\\evil.example',
      '/admin/users#//evil.example',
    ];
    for (const basePath of ['/', '/a/b']) {
      for (const path of hostile) {
        const { thrown } = await outcome(table, request(path, { basePath }));
        if (isRedirect(thrown)) {
          const prefix = basePath === '/' ? '' : basePath;
          expect(thrown.location.startsWith(`${prefix}/login?returnTo=`), path).toBe(true);
          // What is behind returnTo is one encoded value: it cannot end the query or start another URL.
          const target = new URL(thrown.location, 'http://app.test');
          expect(target.origin, path).toBe('http://app.test');
          expect([...target.searchParams.keys()], path).toEqual(['returnTo']);
        } else {
          // A path that is not a page of the application is a 404, never a redirect.
          expect(isHttpError(thrown) && thrown.status, path).toBe(404);
        }
      }
    }
  });
});

describe('the returnTo of a sign-in redirect', () => {
  it.each([
    ['', ''],
    ['?tab=2', '?tab=2'],
    ['?x=\\', '?x=%5C'],
    ['?a=b\\c&d=1', '?a=b%5Cc&d=1'],
    ['?x=\u0001', '?x=%01'],
  ])('encodes %j as %j', (search, expected) => {
    expect(safeQuery(search)).toBe(expected);
  });

  it('is still a redirect to the login page for an address with a raw backslash in its query', async () => {
    const { thrown } = await outcome(table, request('/admin/users?x=\\'));
    expect(isRedirect(thrown)).toBe(true);
    expect(isRedirect(thrown) && thrown.location).toBe(
      '/login?returnTo=%2Fadmin%2Fusers%3Fx%3D%255C',
    );
  });
});

describe('a fresh install (no administrator yet)', () => {
  const first: [string, UiRoute] = [
    '/first-admin',
    { path: '/first-admin', component, load: () => ({ form: true }) },
  ];
  const fresh: PageTable = {
    patterns: [...table.patterns, first[0]],
    pages: new Map([...table.pages, [first[0], { package: 'fixture', route: first[1] }]]),
  };
  const needs = (value: boolean) => ({
    ...request('/'),
    needsFirstAdmin: () => Promise.resolve(value),
  });

  it('shows the first-admin form on the start page and nothing else', async () => {
    const result = await loadPage(fresh, needs(true));
    expect(result).toMatchObject({ pattern: '/first-admin', data: { form: true } });
  });

  it.each(['/admin/users', '/first-admin', '/login', '/no/such/page'])(
    'turns %s away to the start page',
    async (path) => {
      const thrown = await loadPage(fresh, {
        ...request(path),
        needsFirstAdmin: () => Promise.resolve(true),
      }).catch((e: unknown) => e);
      expect(isRedirect(thrown) && thrown.location, path).toBe('/');
    },
  );

  it('keeps the base path in that redirect', async () => {
    const thrown = await loadPage(fresh, {
      ...request('/admin/users', { basePath: '/a/b' }),
      needsFirstAdmin: () => Promise.resolve(true),
    }).catch((e: unknown) => e);
    expect(isRedirect(thrown) && thrown.location).toBe('/a/b/');
  });

  it('is the ordinary start page once an administrator exists', async () => {
    expect((await loadPage(fresh, needs(false))).pattern).toBe('/');
    const thrown = await loadPage(fresh, {
      ...request('/no/such/page'),
      needsFirstAdmin: () => Promise.resolve(false),
    }).catch((e: unknown) => e);
    expect(isHttpError(thrown) && thrown.status).toBe(404);
  });

  it('does nothing without the page (a profile without sign-in)', async () => {
    const result = await loadPage(table, needs(true));
    expect(result.pattern).toBe('/');
  });
});
