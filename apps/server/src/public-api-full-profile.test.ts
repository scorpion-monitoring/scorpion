// The public API of the `full` profile as the loaded modules register it: the runtime document at
// /api/v1/openapi.json is the committed one (`pnpm openapi:generate`), the list of v1 paths is the list
// somebody chose, and no v1 route but the spec is public (ADR-0037).
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createKernel, createLogger, loadConfig, type Kernel } from '@scorpion/kernel';
import { makeSecretsKey, startPostgres, type StartedPostgres } from '@scorpion/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from './app.ts';
import { moduleIds, profileName, sources } from './generated/profile.ts';
import { createMetrics } from './metrics.ts';

process.env.SECRETS_KEY = makeSecretsKey();

/** Every v1 path of the full profile. A new one is a decision: add it here in the pull request that adds the route. */
const EXPECTED_V1_PATHS = [
  '/categories',
  '/indicators',
  '/kpi/rimo.jsonld',
  '/kpi/rimo.ttl',
  '/openapi.json',
  '/providers',
  '/providers/{id}',
  '/services',
  '/services/{id}',
  '/services/{id}/schema-org',
];
/** The only v1 route that may be `public: true` (ADR-0037). */
const PUBLIC_V1 = ['GET /openapi.json'];

let server: StartedPostgres;
let kernel: Kernel;
let app: ReturnType<typeof createApp>;
beforeAll(async () => {
  server = await startPostgres();
  const log = createLogger({ level: 'silent' });
  kernel = createKernel({
    profile: { name: profileName, modules: [...moduleIds] },
    sources,
    modulePackages: Object.fromEntries(
      sources.map((source, index) => [moduleIds[index]!, source.packageJson.name]),
    ),
    config: loadConfig({
      DATABASE_URL: await server.createDatabase(),
      PROFILE: profileName,
      ORIGIN: 'https://scorpion.example.org',
    }),
    log,
  });
  await kernel.start();
  app = createApp({
    config: kernel.config,
    log,
    routes: kernel.routes,
    authenticator: kernel.authenticator,
    authorizer: kernel.authorizer,
    probes: {
      readiness: () =>
        Promise.resolve({
          ready: true,
          checks: { database: 'ok', migrations: 'complete', kernel: 'started' } as const,
        }),
      metrics: createMetrics(),
    },
  });
}, 180_000);
afterAll(async () => {
  await kernel?.stop();
  await server?.stop();
});

const committed = () =>
  JSON.parse(
    readFileSync(resolve(import.meta.dirname, '../../web/src/generated/openapi-v1.json'), 'utf8'),
  ) as { paths: Record<string, unknown>; info: unknown };

describe('GET /api/v1/openapi.json of the full profile', () => {
  it('is the committed document, apart from the server URL, and anyone may read it', async () => {
    const res = await app.request('http://scorpion.example.org/api/v1/openapi.json');
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const { servers, ...runtime } = (await res.json()) as { servers: { url: string }[] };
    expect(servers).toEqual([{ url: 'http://scorpion.example.org/api/v1' }]);
    expect(runtime).toEqual(committed());
  });

  it('lists exactly the v1 routes somebody chose, and no internal route', () => {
    const document = committed();
    expect(Object.keys(document.paths).sort()).toEqual(EXPECTED_V1_PATHS);
    expect(JSON.stringify(document)).not.toContain('/api/internal');
  });

  it('has no public v1 route but the spec; every other v1 route names a permission [ASVS-8.2.1]', () => {
    const v1 = kernel.routes.filter((entry) => entry.surface === 'v1');
    const open = v1
      .filter((entry) => entry.route.public === true)
      .map((entry) => `${entry.route.method.toUpperCase()} ${entry.route.path}`);
    expect(open.sort()).toEqual(PUBLIC_V1);
    for (const entry of v1.filter((e) => e.route.public !== true)) {
      expect(entry.route.permission, entry.route.path).toBeTruthy();
    }
  });
});
