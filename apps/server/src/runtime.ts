// The three long-running or one-shot processes of the server: `start`, `worker` and `migrate`.
// The CLI wires them to the process (environment, signals, exit codes); tests call them directly.
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { serve } from '@hono/node-server';
import {
  createKernel,
  type CommandIo,
  type Config,
  type Kernel,
  type Logger,
  type MigrationReport,
  type ModuleSource,
  type Profile,
} from '@scorpion/kernel';
import { createApp } from './app.ts';
import { createMetrics, type Metrics } from './metrics.ts';
import type { ReadinessResult, SystemProbes } from './system-routes.ts';

export interface RuntimeOptions {
  config: Config;
  log: Logger;
  /** The profile this build was made for, and its modules (the generated file). */
  profile: Profile;
  sources: readonly ModuleSource[];
  /** Module id → package name, when it is not the workspace's (tests). */
  modulePackages?: Readonly<Record<string, string>>;
  /** How long a shutdown lets running requests, jobs and event handlers finish. Default 30 s. */
  shutdownTimeoutMs?: number;
  /** Listen on this port instead of `config.PORT` (0 picks a free one). */
  port?: number;
  /** Job and dispatcher tuning, for tests. */
  kernelOptions?: Partial<Pick<Parameters<typeof createKernel>[0], 'dispatcher' | 'jobs'>>;
}

/** The process was started for another profile than the one configured. */
export function profileMismatch(
  config: Pick<Config, 'PROFILE'>,
  profile: Profile,
): string | undefined {
  if (config.PROFILE === profile.name) return undefined;
  return (
    `This server was built for profile "${profile.name}" but PROFILE is "${config.PROFILE}". ` +
    `A build contains the modules of one profile; build the image for "${config.PROFILE}" ` +
    `(pnpm build --profile ${config.PROFILE}) or set PROFILE=${profile.name}.`
  );
}

function newKernel(options: RuntimeOptions, metrics?: Metrics): Kernel {
  return createKernel({
    profile: options.profile,
    sources: options.sources,
    modulePackages: options.modulePackages,
    config: options.config,
    log: options.log,
    onJobRun: metrics?.onJobRun,
    ...options.kernelOptions,
  });
}

/** Asks the database, briefly, whether the server can do its work. */
async function readiness(
  kernel: Kernel,
  state: () => ReadinessResult['checks']['kernel'],
): Promise<ReadinessResult> {
  const kernelState = state();
  let database: ReadinessResult['checks']['database'] = 'unavailable';
  let migrations: ReadinessResult['checks']['migrations'] = 'unknown';
  try {
    await withTimeout(kernel.pool.query('select 1'), 2000);
    database = 'ok';
    migrations =
      (await withTimeout(kernel.pendingMigrations(), 2000)).length === 0 ? 'complete' : 'pending';
  } catch {
    // The state stays as far as we got: unavailable, or unknown migrations.
  }
  return {
    ready: database === 'ok' && migrations === 'complete' && kernelState === 'started',
    checks: { database, migrations, kernel: kernelState },
  };
}

function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`timed out after ${ms} ms`)), ms);
  });
  return Promise.race([work, timeout]).finally(() => clearTimeout(timer));
}

export interface RunningServer {
  /** The port the server listens on. */
  port: number;
  kernel: Kernel;
  metrics: Metrics;
  /**
   * Resolves once migrations are done, the modules are built and the full application serves
   * requests. Rejects if start-up fails. The server already listens before that, answering
   * `/healthz` and `/metrics` and reporting `/readyz` as not ready.
   */
  ready: Promise<void>;
  /**
   * Graceful shutdown: `/readyz` turns 503, no new connections are accepted, running requests,
   * jobs and event handlers get up to `shutdownTimeoutMs` to finish, the pools are closed.
   */
  stop(): Promise<void>;
}

/**
 * `scorpion start`. Building the kernel checks the profile (missing dependency, cycle, bad
 * manifest), so a broken profile throws here, before anything listens.
 */
export function startServer(options: RuntimeOptions): RunningServer {
  const { config, log } = options;
  const timeout = options.shutdownTimeoutMs ?? 30_000;
  const metrics = createMetrics();
  const kernel = newKernel(options, metrics);
  metrics.watchOutbox(kernel.db, log);

  let state: ReadinessResult['checks']['kernel'] = 'starting';
  const probes: SystemProbes = { readiness: () => readiness(kernel, () => state), metrics };
  const common = {
    config,
    log,
    probes,
    onRequest: metrics.onRequest,
    rateLimiter: kernel.rateLimiter,
  };

  let current = createApp({ ...common, routes: [], authorizer: kernel.authorizer, booting: true });
  const server = serve(
    { fetch: (request) => current.fetch(request), port: options.port ?? config.PORT },
    (info) =>
      log.info(
        { port: info.port, profile: config.PROFILE, basePath: config.BASE_PATH },
        'listening',
      ),
  ) as Server;

  const ready = (async () => {
    await kernel.start();
    if (config.WORKER_MODE === 'inline') await kernel.startWorkers();
    current = createApp({
      ...common,
      routes: kernel.routes,
      authenticator: kernel.authenticator,
      authorizer: kernel.authorizer,
    });
    state = 'started';
    log.info(
      { modules: kernel.profile.modules.map((m) => m.id), workers: config.WORKER_MODE },
      'ready',
    );
  })();
  // Callers that only need the port do not have to await `ready`; the rejection is still theirs to see.
  ready.catch(() => undefined);

  let stopping: Promise<void> | undefined;
  const stop = () =>
    (stopping ??= (async () => {
      state = 'stopping';
      log.info('shutting down');
      const closed = new Promise<void>((resolve) => {
        server.close(() => resolve());
        server.closeIdleConnections();
      });
      await Promise.race([
        closed,
        new Promise<void>((resolve) => setTimeout(resolve, timeout).unref()),
      ]);
      server.closeAllConnections();
      await ready.catch(() => undefined);
      await kernel.stop(timeout);
      log.info('shutdown complete');
    })());

  const address = server.address() as AddressInfo | null;
  return {
    get port() {
      return (server.address() as AddressInfo | null)?.port ?? address?.port ?? config.PORT;
    },
    kernel,
    metrics,
    ready,
    stop,
  };
}

export interface RunningWorker {
  kernel: Kernel;
  ready: Promise<void>;
  stop(): Promise<void>;
}

/** `scorpion worker`: migrations, then jobs and the outbox dispatcher, and no HTTP. */
export function startWorker(options: RuntimeOptions): RunningWorker {
  const timeout = options.shutdownTimeoutMs ?? 30_000;
  const kernel = newKernel(options);
  const ready = (async () => {
    await kernel.start();
    await kernel.startWorkers();
    options.log.info({ modules: kernel.profile.modules.map((m) => m.id) }, 'worker ready');
  })();
  ready.catch(() => undefined);
  let stopping: Promise<void> | undefined;
  return {
    kernel,
    ready,
    stop: () =>
      (stopping ??= (async () => {
        options.log.info('worker shutting down');
        await ready.catch(() => undefined);
        await kernel.stop(timeout);
        options.log.info('worker shutdown complete');
      })()),
  };
}

/** `scorpion migrate`: apply the pending migrations of every module and return. */
export async function migrate(options: RuntimeOptions): Promise<MigrationReport> {
  const kernel = newKernel(options);
  try {
    return await kernel.migrate();
  } finally {
    await kernel.stop();
  }
}

/**
 * `scorpion <command>` for a command a module contributes: migrations, the module's services, the
 * command, and a clean shutdown. Returns the command's exit code.
 */
export async function runModuleCommand(
  options: RuntimeOptions,
  name: string,
  args: readonly string[],
  io: CommandIo,
): Promise<number> {
  const kernel = newKernel(options);
  try {
    return await kernel.runCommand(name, args, io);
  } finally {
    await kernel.stop();
  }
}
