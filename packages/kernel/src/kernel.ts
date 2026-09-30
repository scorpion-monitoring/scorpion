import { getTableName, is } from 'drizzle-orm';
import { PgTable } from 'drizzle-orm/pg-core';
import type pg from 'pg';
import { buildComposition, type Composition } from './composition.ts';
import type { Config } from './config.ts';
import type { ModuleContext } from './context.ts';
import { createDb, createPool, type Db } from './db.ts';
import { KernelStartupError } from './errors.ts';
import { childLogger, createLogger, type Logger } from './logger.ts';
import { SYSTEM_READY, type DomainEvent } from './manifest.ts';
import {
  createDispatcher,
  createEvents,
  type Dispatcher,
  type DispatcherOptions,
  type Subscription,
} from './outbox.ts';
import { ids } from './ids.ts';
import {
  KERNEL_MODULE,
  KERNEL_TABLE_PREFIX,
  pendingMigrations,
  runMigrations,
  type MigrationReport,
  type MigrationTarget,
} from './migrate.ts';
import type { Profile } from './profile.ts';
import {
  resolveProfile,
  type ModuleSource,
  type ResolvedModule,
  type ResolvedProfile,
} from './resolve.ts';

export interface KernelOptions {
  profile: Profile;
  /** The modules this build contains; the profile picks from them. */
  sources: readonly ModuleSource[];
  config: Config;
  log?: Logger;
  /** Module id → package name. Default: the workspace's modules. */
  modulePackages?: Readonly<Record<string, string>>;
  /** Tuning for the outbox dispatcher: attempts, backoff, polling. Defaults suit production. */
  dispatcher?: Partial<
    Pick<
      DispatcherOptions,
      | 'maxAttempts'
      | 'backoffMs'
      | 'leaseMs'
      | 'batchSize'
      | 'concurrency'
      | 'handlerTimeoutMs'
      | 'pollIntervalMs'
    >
  >;
  /** An existing pool to use (and not to close). Default: the kernel opens and owns one. */
  pool?: pg.Pool;
}

export interface Kernel {
  readonly profile: ResolvedProfile;
  readonly composition: Composition;
  readonly config: Config;
  readonly log: Logger;
  readonly db: Db;
  readonly pool: pg.Pool;
  /** Public service objects by module id, once `start()` has built them. */
  readonly services: ReadonlyMap<string, unknown>;
  /** Loader step 2 alone: apply pending migrations. */
  migrate(): Promise<MigrationReport>;
  /** Modules whose migrations have not all been applied. Empty when the database is ready. */
  pendingMigrations(): Promise<{ module: string; pending: number }[]>;
  /** Loader steps 2 to 6. */
  start(): Promise<void>;
  /** The outbox dispatcher. Started by `startWorkers()`; tests can call `dispatchOnce()`. */
  readonly dispatcher: Dispatcher;
  /**
   * Starts the background work: the outbox dispatcher. `WORKER_MODE=inline` runs it in the web
   * process; `scorpion worker` runs it alone.
   */
  startWorkers(): Promise<void>;
  /** Stops the background work, waits for running handlers, closes the pool if the kernel opened it. */
  stop(): Promise<void>;
}

const KERNEL_MIGRATIONS = new URL('../migrations', import.meta.url);

/** Nothing outside `deps` is reachable through the proxy: an undeclared module id throws. */
function dependencyView(module: ResolvedModule, services: ReadonlyMap<string, unknown>) {
  const visible = new Map<string, unknown>();
  for (const id of [...module.dependsOn, ...module.presentOptional])
    visible.set(id, services.get(id));
  const absentOptional = new Set(
    module.optionalDependsOn.filter((id) => !module.presentOptional.includes(id)),
  );
  return new Proxy(Object.create(null) as Record<string, unknown>, {
    get(_target, key) {
      if (typeof key !== 'string') return undefined;
      if (visible.has(key)) return visible.get(key);
      if (absentOptional.has(key)) return undefined;
      throw new KernelStartupError(`Module "${module.id}" cannot reach "${key}":`, [
        `"${key}" is not a dependency of "${module.id}" (declare it in package.json)`,
      ]);
    },
    has: (_target, key) => typeof key === 'string' && visible.has(key),
    ownKeys: () => [...visible.keys()],
    getOwnPropertyDescriptor: (_target, key) =>
      typeof key === 'string' && visible.has(key)
        ? { enumerable: true, configurable: true, value: visible.get(key) }
        : undefined,
    set() {
      throw new TypeError('ctx.deps is read-only');
    },
  });
}

/**
 * Loader step 1 and the checks of steps 3 and 4 run right here, before anything touches the
 * database: they have no side effects, so a broken manifest never leaves a half-migrated
 * database behind. `start()` then runs the remaining steps in order.
 */
export function createKernel(options: KernelOptions): Kernel {
  const { config } = options;
  const log = options.log ?? createLogger({ level: config.LOG_LEVEL });
  const profile = resolveProfile({
    profile: options.profile,
    sources: options.sources,
    modulePackages: options.modulePackages,
  });
  const composition = buildComposition(profile);
  for (const note of composition.skipped) log.info(`skipped: ${note}`);

  const ownsPool = options.pool === undefined;
  let poolClosed = false;
  const pool = options.pool ?? createPool(config);
  const db = createDb(pool);
  const services = new Map<string, unknown>();
  const contexts = new Map<string, ModuleContext>();

  // Event name → the modules that subscribe to it (composition has checked they may).
  const subscribers = new Map<string, string[]>();
  const subscriptions: Subscription[] = [];
  for (const module of profile.modules) {
    for (const [eventName, handler] of Object.entries(module.manifest.events?.on ?? {})) {
      if (eventName === SYSTEM_READY || !composition.events.has(eventName)) continue;
      subscribers.set(eventName, [...(subscribers.get(eventName) ?? []), module.id]);
      subscriptions.push({ subscriber: module.id, eventName, handler });
    }
  }

  const targets = (): MigrationTarget[] => [
    { id: KERNEL_MODULE, migrations: KERNEL_MIGRATIONS, tablePrefix: KERNEL_TABLE_PREFIX },
    ...profile.modules.map((module) => ({
      id: module.id,
      migrations: module.manifest.migrations,
      tablePrefix: composition.tablePrefixes.get(module.id)!,
    })),
  ];

  /** The Drizzle tables a module declares must carry its prefix, as its migrations must. */
  async function checkSchemas(): Promise<void> {
    const problems: string[] = [];
    for (const module of profile.modules) {
      if (!module.manifest.schema) continue;
      const prefix = composition.tablePrefixes.get(module.id)!;
      for (const value of Object.values(await module.manifest.schema())) {
        if (is(value, PgTable) && !getTableName(value).startsWith(prefix)) {
          problems.push(`${module.id}: table "${getTableName(value)}" must start with "${prefix}"`);
        }
      }
    }
    if (problems.length > 0)
      throw new KernelStartupError('Module schemas break the table-prefix rule:', problems);
  }

  function contextFor(module: ResolvedModule): ModuleContext {
    const cached = contexts.get(module.id);
    if (cached) return cached;
    const reachable = new Set([module.id, ...module.dependsOn, ...module.presentOptional]);
    const context: ModuleContext = {
      moduleId: module.id,
      db,
      log: childLogger(log, { module: module.id }),
      events: createEvents({
        moduleId: module.id,
        schemas: new Map(Object.entries(module.manifest.events?.emits ?? {})),
        subscribers,
      }),
      config,
      deps: dependencyView(module, services),
      registry(name) {
        const registry = composition.registries.get(name);
        if (!registry)
          throw new KernelStartupError(`Unknown registry "${name}":`, [`no module declares it`]);
        if (!reachable.has(registry.owner)) {
          throw new KernelStartupError(`Module "${module.id}" cannot read registry "${name}":`, [
            `it belongs to ${registry.owner}, which is not a dependency`,
          ]);
        }
        return Object.freeze(registry.entries.map((entry) => entry.value));
      },
    };
    contexts.set(module.id, context);
    return context;
  }

  const moduleById = new Map(profile.modules.map((module) => [module.id, module]));
  const dispatcher = createDispatcher({
    ...options.dispatcher,
    db,
    connectionString: config.DATABASE_URL,
    log: childLogger(log, { module: 'kernel' }),
    subscriptions,
    contextFor: (id) => contextFor(moduleById.get(id)!),
  });

  async function migrate(): Promise<MigrationReport> {
    return runMigrations(pool, targets(), log);
  }

  async function start(): Promise<void> {
    await checkSchemas(); // no side effects, so it runs before the database is touched
    await migrate(); // step 2
    log.info(
      { profile: profile.name, modules: profile.modules.map((module) => module.id) },
      'permissions, settings, events and registries registered',
    ); // steps 3 and 4 ran in createKernel()
    for (const module of profile.modules) {
      // step 5
      if (module.manifest.services)
        services.set(module.id, await module.manifest.services(contextFor(module)));
    }
    // step 6: subscriptions are wired (the dispatcher looks handlers up by module and event);
    // routes and jobs join in with the parts they need.
    const ready: DomainEvent = {
      id: ids.uuidv7(),
      name: SYSTEM_READY,
      payload: {},
      occurredAt: new Date(),
    };
    for (const module of profile.modules) {
      await module.manifest.events?.on?.[SYSTEM_READY]?.(ready, contextFor(module));
    }
  }

  return {
    profile,
    composition,
    config,
    log,
    db,
    pool,
    services,
    migrate,
    pendingMigrations: () => pendingMigrations(pool, targets()),
    start,
    dispatcher,
    startWorkers: () => dispatcher.start(),
    stop: async () => {
      await dispatcher.stop();
      if (ownsPool && !poolClosed) {
        poolClosed = true;
        await pool.end();
      }
    },
  };
}
