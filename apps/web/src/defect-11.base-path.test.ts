// Defect 11 (FEATURES §5): the legacy app parsed paths as if `BASE_PATH` had one segment. Here a base
// of three segments goes through every place that handles it: the API (the server hook), the web front
// that takes the prefix off, the web hook that calls the API, and the redirect of a page that needs a
// sign-in. `url()` is the only constructor, and its own table is in packages/contracts.
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { serve } from '@hono/node-server';
import { isLocalPath, url } from '@scorpion/contracts';
import { createLogger } from '@scorpion/kernel';
import { isRedirect } from '@sveltejs/kit';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createApp } from '../../server/src/app.ts';
import { createFront } from './front/front.ts';
import { loadPage } from './lib/server/page.ts';

const BASE = '/a/b/c';
const servers: http.Server[] = [];
let web = 0;
let apiPort = 0;

const get = (port: number, path: string) =>
  new Promise<{ status: number; body: string }>((resolve, reject) => {
    http
      .get({ host: '127.0.0.1', port, path }, (response) => {
        let body = '';
        response.on('data', (chunk: Buffer) => (body += chunk.toString()));
        response.on('end', () => resolve({ status: response.statusCode ?? 0, body }));
      })
      .on('error', reject);
  });

beforeAll(async () => {
  // The real HTTP application, mounted under the base path (the server hook).
  const app = createApp({
    config: { BASE_PATH: BASE, PROFILE: 'defect-11' },
    log: createLogger({ level: 'silent' }),
    routes: [],
    authorizer: { authorize: () => Promise.resolve() } as never,
    probes: {
      readiness: () =>
        Promise.resolve({
          ready: true,
          checks: { database: 'ok', migrations: 'complete', kernel: 'started' } as const,
        }),
      metrics: { render: () => Promise.resolve(''), contentType: 'text/plain' } as never,
    },
  });
  const api = serve({ fetch: app.fetch, port: 0, hostname: '127.0.0.1' }) as http.Server;
  await new Promise((resolve) => api.once('listening', resolve));
  servers.push(api);
  apiPort = (api.address() as AddressInfo).port;
  // The web front in front of it, with a stand-in for the page server that answers with the path it got.
  const front = http.createServer(
    createFront({
      basePath: BASE,
      apiOrigin: `http://127.0.0.1:${apiPort}`,
      next: (request, response) => {
        response.writeHead(200, { 'content-type': 'text/plain' });
        response.end(`page ${request.url}`);
      },
    }),
  );
  await new Promise<void>((resolve) => front.listen(0, '127.0.0.1', resolve));
  servers.push(front);
  web = (front.address() as AddressInfo).port;
});
afterAll(async () => {
  await Promise.all(
    servers.map((server) => new Promise((resolve) => server.close(() => resolve(undefined)))),
  );
});

describe(`BASE_PATH=${BASE}`, () => {
  it('serves the API under the base path and nowhere else (the server hook)', async () => {
    expect((await get(apiPort, `${BASE}/healthz`)).status).toBe(200);
    for (const path of [
      '/healthz',
      '/a/healthz',
      '/a/b/healthz',
      `${BASE}/c/healthz`,
      '/a/b/cc/healthz',
    ]) {
      expect((await get(apiPort, path)).status, path).toBe(404);
    }
  });

  it('reaches the API through the web origin, and hands a page the path without the base (the web front)', async () => {
    expect((await get(web, `${BASE}/healthz`)).status).toBe(200);
    expect((await get(web, `${BASE}/readyz`)).status).toBe(200);
    expect((await get(web, `${BASE}/docs?x=1`)).body).toBe('page /docs?x=1');
    expect((await get(web, BASE)).body).toBe('page /');
    for (const path of ['/healthz', '/docs', '/a/b/healthz', `${BASE}x/docs`]) {
      expect((await get(web, path)).status, path).toBe(404);
    }
  });

  it('calls the API under the base path (the web hook)', async () => {
    const urls: string[] = [];
    vi.stubGlobal('fetch', (input: Request) => {
      urls.push(input.url);
      return Promise.resolve(Response.json({ user: {}, roles: [], csrfToken: null }));
    });
    vi.stubEnv('BASE_PATH', BASE);
    vi.stubEnv('API_ORIGIN', 'http://127.0.0.1:9');
    vi.resetModules();
    try {
      const { handle } = await import('./hooks.server.ts');
      const event = {
        request: new Request(`http://localhost${BASE}/x`, {
          headers: { 'x-forwarded-for': '203.0.113.9' },
        }),
        locals: {} as App.Locals,
      };
      await handle({
        event: event as never,
        resolve: async () => {
          await event.locals.session();
          await event.locals.navigation();
          return new Response('ok');
        },
      });
      expect(urls).toEqual([
        `http://127.0.0.1:9${BASE}/api/internal/auth/me`,
        `http://127.0.0.1:9${BASE}/api/internal/ui/navigation`,
      ]);
    } finally {
      vi.unstubAllGlobals();
      vi.unstubAllEnvs();
    }
  });

  it('redirects a visitor who must sign in to a login page under the base path, and back to a page under it', async () => {
    const component = () => Promise.reject(new Error('not rendered'));
    const thrown = await loadPage(
      {
        patterns: ['/admin'],
        pages: new Map([['/admin', { package: 'fixture', route: { path: '/admin', component } }]]),
      },
      {
        url: new URL(`http://localhost/admin?tab=1`),
        basePath: BASE,
        api: {} as never,
        session: () => Promise.resolve(null),
        navigation: () => Promise.resolve({ routes: [], nav: [], widgets: [], themes: [] }),
        publicApi: { openapi: '3.1.0', info: { title: 't', version: '1' } },
      },
    ).catch((error: unknown) => error);
    expect(isRedirect(thrown)).toBe(true);
    const location = isRedirect(thrown) ? thrown.location : '';
    expect(location.startsWith(`${BASE}/login?returnTo=`)).toBe(true);
    const returnTo = new URL(location, 'http://localhost').searchParams.get('returnTo');
    expect(returnTo).toBe(`${BASE}/admin?tab=1`);
    expect(isLocalPath(BASE, returnTo)).toBe(true);
  });

  it('builds every link with url(), and refuses a return path outside the base', () => {
    expect(url(BASE, '/')).toBe(`${BASE}/`);
    expect(url(BASE, '/login')).toBe(`${BASE}/login`);
    for (const candidate of [
      '/admin',
      '/a/b/admin',
      `${BASE}x/admin`,
      'https://evil.example/a/b/c/x',
      '//evil.example',
    ]) {
      expect(isLocalPath(BASE, candidate), candidate).toBe(false);
    }
  });
});
