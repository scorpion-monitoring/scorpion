// `preflightCors`: the preflight answer names the methods of the path asked about, not those of the whole v1 surface (M10 sprint 2; the
// backlog item "The preflight answer lists the methods v1 has overall"). On a bare Hono app: no database.
import { Hono } from 'hono';
import { createLogger } from '@scorpion/kernel';
import { describe, expect, it } from 'vitest';
import { methodsForPath, preflightCors, type PreflightRoute } from './preflight.ts';

const ALLOWED = 'https://app.example.org';
const log = createLogger({ level: 'silent' });
const routes: PreflightRoute[] = [
  { method: 'get', path: '/api/v1/providers' },
  { method: 'get', path: '/api/v1/services' },
  { method: 'get', path: '/api/v1/services/{id}' },
  { method: 'get', path: '/api/v1/measurements' },
  { method: 'post', path: '/api/v1/measurements' },
];

const appWith = (base = '') => {
  const app = new Hono();
  app.use(
    '*',
    preflightCors(
      { prefix: `${base}/api/v1`, origins: () => Promise.resolve([ALLOWED]), log },
      routes.map((route) => ({ ...route, path: `${base}${route.path}` })),
    ),
  );
  app.all('*', (c) => c.text('ok'));
  return app;
};
const preflight = (app: Hono, path: string, method = 'POST') =>
  app.request(path, {
    method: 'OPTIONS',
    headers: { origin: ALLOWED, 'access-control-request-method': method },
  });

describe('methodsForPath', () => {
  it.each([
    ['/api/v1/measurements', ['GET', 'POST']],
    ['/api/v1/measurements/', ['GET', 'POST']],
    ['/api/v1/providers', ['GET']],
    ['/api/v1/services/0198f3a5', ['GET']],
    ['/api/v1/services/a/b', []],
    ['/api/v1/nothing', []],
    ['/api/v1/measurementsx', []],
  ])('%s has %j', (path, methods) => {
    expect(methodsForPath(routes, path)).toEqual(methods);
  });
});

describe('preflightCors', () => {
  it('names GET, POST and OPTIONS for /api/v1/measurements and only GET and OPTIONS for the other paths', async () => {
    const app = appWith();
    const withPost = await preflight(app, '/api/v1/measurements');
    expect(withPost.status).toBe(204);
    expect(withPost.headers.get('access-control-allow-methods')).toBe('GET, POST, OPTIONS');
    for (const path of ['/api/v1/providers', '/api/v1/services', '/api/v1/services/abc']) {
      const res = await preflight(app, path, 'GET');
      expect(res.status, path).toBe(204);
      expect(res.headers.get('access-control-allow-methods'), path).toBe('GET, OPTIONS');
    }
  });

  it('works under a base path of several segments', async () => {
    const app = appWith('/a/b');
    expect(
      (await preflight(app, '/a/b/api/v1/measurements')).headers.get(
        'access-control-allow-methods',
      ),
    ).toBe('GET, POST, OPTIONS');
    expect(
      (await preflight(app, '/a/b/api/v1/providers', 'GET')).headers.get(
        'access-control-allow-methods',
      ),
    ).toBe('GET, OPTIONS');
  });

  it('falls back to the methods of the whole surface for a path no route has, and still refuses an origin that is not allowed', async () => {
    const app = appWith();
    expect(
      (await preflight(app, '/api/v1/unknown')).headers.get('access-control-allow-methods'),
    ).toBe('GET, POST, OPTIONS');
    const refused = await app.request('/api/v1/measurements', {
      method: 'OPTIONS',
      headers: { origin: 'https://evil.example', 'access-control-request-method': 'POST' },
    });
    expect(refused.status).toBe(403);
    expect(refused.headers.get('access-control-allow-origin')).toBeNull();
    expect(refused.headers.get('access-control-allow-methods')).toBeNull();
  });

  it('adds the origin to a real answer of an allowed origin and to no other path', async () => {
    const app = appWith();
    const ok = await app.request('/api/v1/measurements', { headers: { origin: ALLOWED } });
    expect(ok.headers.get('access-control-allow-origin')).toBe(ALLOWED);
    expect(ok.headers.get('access-control-allow-credentials')).toBeNull();
    const elsewhere = await app.request('/api/internal/x', { headers: { origin: ALLOWED } });
    expect(elsewhere.headers.get('access-control-allow-origin')).toBeNull();
  });
});
