import { Hono } from 'hono';
import { createRoute, z, type AppEnv, type AppRoute } from '@scorpion/contracts';
import { createLogger, denyByDefault, loadConfig, type RegisteredRoute } from '@scorpion/kernel';
import { describe, expect, it } from 'vitest';
import { createApp } from '../app.ts';
import { createMetrics } from '../metrics.ts';
import { DEFAULT_MAX_BODY_BYTES, limitBodyPerRoute } from './body-limit.ts';

const config = loadConfig({ DATABASE_URL: 'postgres://unused@localhost/unused' });
const binary = {
  required: true as const,
  content: { 'application/octet-stream': { schema: z.string() } },
};

const upload = createRoute({
  method: 'post',
  path: '/things/{id}/file',
  permission: 'x.upload',
  maxBodyBytes: 3 * 1024 * 1024,
  request: { body: binary },
  responses: { 200: { description: 'ok' } },
});
const other = createRoute({
  method: 'post',
  path: '/things/{id}/other',
  permission: 'x.other',
  request: { body: binary },
  responses: { 200: { description: 'ok' } },
});

const handler = (async (c: {
  req: { arrayBuffer(): Promise<ArrayBuffer> };
  json(v: unknown): Response;
}) => c.json({ received: (await c.req.arrayBuffer()).byteLength })) as never;
const routes: RegisteredRoute[] = [
  { module: 'x', surface: 'internal', route: upload as AppRoute, handler },
  { module: 'x', surface: 'internal', route: other as AppRoute, handler },
];

function app(basePath = '/') {
  const instance = createApp({
    config: { ...config, BASE_PATH: basePath },
    log: createLogger({ level: 'silent' }),
    routes,
    authorizer: () => undefined,
    probes: {
      readiness: () =>
        Promise.resolve({
          ready: true,
          checks: { database: 'ok', migrations: 'complete', kernel: 'started' } as const,
        }),
      metrics: createMetrics(),
    },
  });
  const prefix = basePath === '/' ? '' : basePath;
  return (path: string, bytes: number, method = 'POST') =>
    Promise.resolve(
      instance.request(`${prefix}/api/internal${path}`, {
        method,
        headers: { 'content-type': 'application/octet-stream', 'content-length': String(bytes) },
        body: new Uint8Array(bytes),
      }),
    );
}

const MiB = 1024 * 1024;

describe('per-route body limits', () => {
  it('lets the upload route take more than the server-wide limit', async () => {
    const call = app();
    expect(DEFAULT_MAX_BODY_BYTES).toBe(MiB);
    const reply = await call('/things/1/file', 2 * MiB);
    expect(reply.status).toBe(200);
    expect(await reply.json()).toEqual({ received: 2 * MiB });
  });

  it("refuses a body over the route's own limit with 413", async () => {
    const reply = await app()('/things/1/file', 3 * MiB + 1);
    expect(reply.status).toBe(413);
  });

  it('keeps the server-wide limit for every other route, also with the same path shape', async () => {
    const call = app();
    expect((await call('/things/1/other', MiB + 1)).status).toBe(413);
    expect((await call('/things/1/other', MiB)).status).toBe(200);
  });

  it("applies the override to the route's method and path only", async () => {
    const call = app();
    expect((await call('/things/1/file/extra', 2 * MiB)).status).toBe(413);
    expect((await call('/things//file', 2 * MiB)).status).toBe(413);
    expect((await call('/things/1/file', 2 * MiB, 'PUT')).status).toBe(413);
  });

  it('works under a base path of several segments', async () => {
    const call = app('/a/b/c');
    expect((await call('/things/1/file', 2 * MiB)).status).toBe(200);
    expect((await call('/things/1/other', 2 * MiB)).status).toBe(413);
  });

  it('never lowers the limit: an override below the default is ignored', async () => {
    const small = new Hono<AppEnv>();
    small.use('*', limitBodyPerRoute(MiB, [{ method: 'POST', path: '/x', maxBytes: 10 }]));
    small.post('/x', (c) => c.json({ ok: true }));
    const reply = await small.request('/x', {
      method: 'POST',
      headers: { 'content-length': '1000' },
      body: new Uint8Array(1000),
    });
    expect(reply.status).toBe(200);
  });
});
