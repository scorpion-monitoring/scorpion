import { createRoute, z } from '@scorpion/contracts';
import {
  createLogger,
  defineModule,
  loadConfig,
  MIGRATION_LOCK,
  type ModuleSource,
  type Profile,
} from '@scorpion/kernel';
import pg from 'pg';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  allFixtureSources,
  FIXTURE_MODULE_PACKAGES,
  fixtureProfile,
} from '../../../packages/kernel/test/fixtures/index.ts';
import { useKernels } from '../../../packages/kernel/test/helpers.ts';
import { profileMismatch, startServer, startWorker, type RuntimeOptions } from './runtime.ts';

const kernels = useKernels();
const fixtures = await allFixtureSources();
const running: { stop(): Promise<void> }[] = [];

afterEach(async () => {
  await Promise.all(running.splice(0).map((r) => r.stop()));
});

async function options(
  profileName: string,
  env: Record<string, string> = {},
  databaseUrl?: string,
): Promise<RuntimeOptions> {
  const profile = await fixtureProfile(profileName);
  return {
    config: loadConfig({
      DATABASE_URL: databaseUrl ?? (await kernels.newDatabase()),
      PROFILE: profile.name,
      LOG_LEVEL: 'silent',
      ...env,
    }),
    log: createLogger({ level: 'silent' }),
    profile,
    sources: fixtures,
    modulePackages: FIXTURE_MODULE_PACKAGES,
    port: 0,
    shutdownTimeoutMs: 10_000,
    kernelOptions: {
      jobs: { pollingIntervalSeconds: 0.5, cronIntervalSeconds: 1 },
      dispatcher: { pollIntervalMs: 100 },
    },
  };
}

const get = async (port: number, path: string, init?: RequestInit) =>
  fetch(`http://127.0.0.1:${port}${path}`, init);
const readiness = async (port: number, base = '') => {
  const response = await get(port, `${base}/readyz`);
  return {
    status: response.status,
    body: (await response.json()) as { status: string; checks: Record<string, string> },
  };
};

describe('/readyz', () => {
  it('is 503 while the migrations have not run, and 200 once they have', async () => {
    const url = await kernels.newDatabase();
    // Another process holds the migration lock, so this server's migrations wait.
    const holder = new pg.Client({ connectionString: url });
    await holder.connect();
    await holder.query('select pg_advisory_lock($1, $2)', [...MIGRATION_LOCK]);

    const server = startServer(await options('ab', {}, url));
    running.push(server);

    const before = await readiness(server.port);
    expect(before.status).toBe(503);
    expect(before.body).toEqual({
      status: 'unavailable',
      checks: { database: 'ok', migrations: 'pending', kernel: 'starting' },
    });
    expect((await get(server.port, '/healthz')).status).toBe(200); // alive, though not ready

    await holder.query('select pg_advisory_unlock($1, $2)', [...MIGRATION_LOCK]);
    await holder.end();
    await server.ready;

    const after = await readiness(server.port);
    expect(after.status).toBe(200);
    expect(after.body).toEqual({
      status: 'ready',
      checks: { database: 'ok', migrations: 'complete', kernel: 'started' },
    });
  });

  it('is 503 with the database unavailable, while /healthz stays 200 and never touches the database', async () => {
    const server = startServer(
      await options('b-only', {}, 'postgres://scorpion:pw-secret@127.0.0.1:1/none'),
    );
    running.push(server);
    await expect(server.ready).rejects.toThrow();

    expect(await readiness(server.port)).toEqual({
      status: 503,
      body: {
        status: 'unavailable',
        checks: { database: 'unavailable', migrations: 'unknown', kernel: 'starting' },
      },
    });
    const health = await get(server.port, '/healthz');
    expect(health.status).toBe(200);
    expect(await health.json()).toEqual({ status: 'ok', profile: 'fixture-b-only' });
  });

  it('serves the probes but nothing else while the kernel starts', async () => {
    const url = await kernels.newDatabase();
    const holder = new pg.Client({ connectionString: url });
    await holder.connect();
    await holder.query('select pg_advisory_lock($1, $2)', [...MIGRATION_LOCK]);
    const server = startServer(await options('routes', {}, url));
    running.push(server);

    const booting = await get(server.port, '/api/internal/ping');
    expect(booting.status).toBe(503);
    expect(booting.headers.get('retry-after')).toBe('5');
    expect(booting.headers.get('content-type')).toContain('application/problem+json');
    expect((await get(server.port, '/metrics')).status).toBe(200);

    await holder.query('select pg_advisory_unlock($1, $2)', [...MIGRATION_LOCK]);
    await holder.end();
    await server.ready;
    expect((await get(server.port, '/api/internal/ping')).status).toBe(200);
  });

  it('is under BASE_PATH like every other route', async () => {
    const server = startServer(await options('b-only', { BASE_PATH: '/a/b' }));
    running.push(server);
    await server.ready;
    expect((await readiness(server.port, '/a/b')).status).toBe(200);
    expect((await get(server.port, '/a/b/healthz')).status).toBe(200);
    expect((await get(server.port, '/readyz')).status).toBe(404);
  });

  it('turns 503 as soon as shutdown begins', async () => {
    const server = startServer(await options('b-only'));
    await server.ready;
    expect((await readiness(server.port)).status).toBe(200);
    // Hold the server open with a connection that is not idle while stop() starts.
    const stopping = server.stop();
    await stopping;
    await expect(get(server.port, '/healthz')).rejects.toThrow(); // no longer listening
  });
});

describe('/metrics', () => {
  it('exposes default metrics, request durations by route and status, outbox lag and job durations', async () => {
    const server = startServer(await options('ab'));
    running.push(server);
    await server.ready;
    await server.kernel.startWorkers();
    const a = server.kernel.services.get('fixture.a') as { ping(message: string): Promise<string> };
    await a.ping('for the metrics');
    await get(server.port, '/healthz');
    await get(server.port, '/no/such/thing');

    await vi.waitFor(
      async () => {
        const text = await (await get(server.port, '/metrics')).text();
        expect(text).toMatch(
          /scorpion_job_duration_seconds_count\{job="fixture\.a\.ping",status="succeeded"\} 1/,
        );
      },
      { timeout: 15_000, interval: 250 },
    );

    const response = await get(server.port, '/metrics');
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/plain');
    const text = await response.text();
    expect(text).toContain('process_cpu_user_seconds_total');
    expect(text).toContain('nodejs_eventloop_lag_seconds');
    expect(text).toMatch(
      /scorpion_http_request_duration_seconds_count\{method="GET",route="\/healthz",status="200"\} [1-9]/,
    );
    expect(text).toMatch(
      /scorpion_http_request_duration_seconds_count\{method="GET",route="unmatched",status="404"\} 1/,
    );
    expect(text).toMatch(/scorpion_outbox_lag_seconds \d/);
    expect(text).toMatch(/scorpion_outbox_pending_deliveries \d/);
    expect(text).toMatch(/scorpion_outbox_dead_deliveries 0/);
    expect(text).toContain('scorpion_job_duration_seconds_bucket');
  }, 30_000);

  it('labels requests with the route pattern, not the concrete path', async () => {
    const server = startServer(await options('routes'));
    running.push(server);
    await server.ready;
    // Denied by default (403), but the route label is what matters.
    await get(server.port, '/api/internal/things/t01');
    await get(server.port, '/api/internal/things/t02');
    const text = await (await get(server.port, '/metrics')).text();
    expect(text).toMatch(/route="\/api\/internal\/things\/:id",status="403"\} 2/);
    expect(text).not.toContain('things/t01');
  });

  it('reports a growing outbox lag when nothing delivers', async () => {
    const server = startServer(await options('ab', { WORKER_MODE: 'separate' }));
    running.push(server);
    await server.ready;
    const b = server.kernel.services.get('fixture.b') as {
      createThing(name: string): Promise<string>;
    };
    await b.createThing('waits');
    await new Promise((resolve) => setTimeout(resolve, 1200));
    const text = await (await get(server.port, '/metrics')).text();
    const lag = Number(/scorpion_outbox_lag_seconds ([\d.]+)/.exec(text)?.[1]);
    expect(lag).toBeGreaterThan(1);
    expect(text).toMatch(/scorpion_outbox_pending_deliveries 1/);
  });

  it('keeps answering when the database is down', async () => {
    const server = startServer(
      await options('b-only', {}, 'postgres://scorpion:pw@127.0.0.1:1/none'),
    );
    running.push(server);
    await server.ready.catch(() => undefined);
    const response = await get(server.port, '/metrics');
    expect(response.status).toBe(200);
    expect(await response.text()).toContain('scorpion_outbox_lag_seconds 0');
  });
});

describe('WORKER_MODE', () => {
  const ranPing = async (server: ReturnType<typeof startServer>) => {
    await server.ready;
    const a = server.kernel.services.get('fixture.a') as {
      ping(message: string): Promise<string>;
      notes(): Promise<{ body: string }[]>;
    };
    await a.ping('who runs me');
    return { notes: () => a.notes() };
  };

  it('inline: the web process runs jobs and event handlers', async () => {
    const server = startServer(await options('ab', { WORKER_MODE: 'inline' }));
    running.push(server);
    const { notes } = await ranPing(server);
    await vi.waitFor(
      async () => expect((await notes()).map((n) => n.body)).toContain('who runs me'),
      {
        timeout: 15_000,
        interval: 250,
      },
    );
  }, 30_000);

  it('separate: the web process only queues; a worker process runs the job', async () => {
    const url = await kernels.newDatabase();
    const server = startServer(await options('ab', { WORKER_MODE: 'separate' }, url));
    running.push(server);
    const { notes } = await ranPing(server);
    await new Promise((resolve) => setTimeout(resolve, 2000));
    expect((await notes()).map((n) => n.body)).not.toContain('who runs me');

    const worker = startWorker(await options('ab', { WORKER_MODE: 'separate' }, url));
    running.push(worker);
    await worker.ready;
    await vi.waitFor(
      async () => expect((await notes()).map((n) => n.body)).toContain('who runs me'),
      {
        timeout: 15_000,
        interval: 250,
      },
    );
  }, 40_000);
});

describe('graceful shutdown', () => {
  const slow = createRoute({
    method: 'get',
    path: '/slow',
    public: true,
    publicReason: 'Test route',
    responses: {
      200: {
        description: 'ok',
        content: { 'application/json': { schema: z.object({ done: z.boolean() }) } },
      },
    },
  });
  const slowModule: ModuleSource = {
    packageJson: { name: '@scorpion/slow' },
    manifest: defineModule({
      id: 'slow',
      version: '1.0.0',
      routes: (r) => {
        r.internal(slow, async (c) => {
          await new Promise((resolve) => setTimeout(resolve, 800));
          return c.json({ done: true }, 200);
        });
      },
    }),
  };

  it('lets a request in flight finish, then closes', async () => {
    const profile: Profile = { name: 'full', modules: ['slow'] };
    const server = startServer({
      ...(await options('b-only')),
      profile,
      sources: [slowModule],
      modulePackages: { slow: '@scorpion/slow' },
      config: loadConfig({ DATABASE_URL: await kernels.newDatabase(), LOG_LEVEL: 'silent' }),
    });
    await server.ready;

    const inFlight = get(server.port, '/api/internal/slow');
    await new Promise((resolve) => setTimeout(resolve, 200));
    const started = Date.now();
    const stopped = server.stop();

    const response = await inFlight;
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ done: true });
    await stopped;
    expect(Date.now() - started).toBeGreaterThanOrEqual(400);
    await expect(get(server.port, '/healthz')).rejects.toThrow();
  });

  it('can be stopped twice', async () => {
    const server = startServer(await options('b-only'));
    await server.ready;
    await server.stop();
    await expect(server.stop()).resolves.toBeUndefined();
  });

  it('stops a server whose start-up failed', async () => {
    const server = startServer(
      await options('b-only', {}, 'postgres://scorpion:pw@127.0.0.1:1/none'),
    );
    await server.ready.catch(() => undefined);
    await expect(server.stop()).resolves.toBeUndefined();
  });
});

describe('start-up refusals', () => {
  it('refuses a profile with a missing dependency before anything listens, naming the path', async () => {
    const base = await options('missing');
    expect(() => startServer(base)).toThrowError(
      /fixture\.missing → fixture\.b \(not in profile "fixture-missing"\)/,
    );
  });

  it('refuses a profile with a dependency cycle', async () => {
    const base = await options('cycle');
    expect(() => startServer(base)).toThrowError(
      /dependency cycle: fixture\.cycle-x → fixture\.cycle-y → fixture\.cycle-x/,
    );
  });

  it('explains a PROFILE that differs from the build', () => {
    expect(profileMismatch({ PROFILE: 'full' }, { name: 'full', modules: [] })).toBeUndefined();
    expect(profileMismatch({ PROFILE: 'core-only' }, { name: 'full', modules: [] })).toMatch(
      /built for profile "full" but PROFILE is "core-only".*pnpm build --profile core-only/,
    );
  });
});
