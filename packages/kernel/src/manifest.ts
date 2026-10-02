import type { AnyHandler, AppRoute } from '@scorpion/contracts';
import { z } from 'zod';
import { KernelStartupError } from './errors.ts';
import type { ModuleContext, ModuleServices } from './context.ts';

/** `kpi.ingestion`, `core.ui-shell`, `maturity`: dot-separated segments of lower-case kebab case. */
export const MODULE_ID = /^[a-z][a-z0-9]*(-[a-z0-9]+)*(\.[a-z][a-z0-9]*(-[a-z0-9]+)*)*$/;
/** `service.created@1`. The version is part of the name. */
export const EVENT_NAME = /^[a-z][a-zA-Z0-9]*(\.[a-zA-Z][a-zA-Z0-9]*)+@[1-9][0-9]*$/;
/** Lifecycle event emitted by the kernel after startup. Not versioned, not stored in the outbox. */
export const SYSTEM_READY = 'system.ready';

/** Command names: lower-case kebab case, as in `create-admin`. */
export const COMMAND_NAME = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;
/** Commands of the server itself; a module cannot take these names. */
export const RESERVED_COMMANDS: readonly string[] = [
  'start',
  'worker',
  'migrate',
  'profile:generate',
  'help',
];

export interface PermissionDef {
  /** What the permission is checked against; `global` when omitted. */
  scope?: string;
  description: string;
}

export interface JobDef<C = ModuleContext> {
  /** Prefixed with the module id: `kpi.ingestion.reminder`. */
  name: string;
  /** Cron expression in UTC (five fields). A new schedule also runs once right after it is created. */
  schedule?: string;
  /** Validates the data passed to `ctx.jobs.enqueue()`. Without it the job takes no data. */
  data?: z.ZodType;
  handler: (job: JobRun, ctx: C) => Promise<void>;
  retry: { limit: number; delaySeconds: number; backoff?: boolean };
  /** Seconds before a running handler is considered failed. */
  timeoutSeconds: number;
}

export interface JobRun<Data = unknown> {
  id: string;
  name: string;
  data: Data;
  /** 1 for the first attempt. */
  attempt: number;
  /** Aborted when the job times out or the process is shutting down. */
  signal: AbortSignal;
}

export interface DomainEvent<Payload = unknown> {
  id: string;
  /** `service.created@1`. */
  name: string;
  payload: Payload;
  occurredAt: Date;
}

export type EventHandler<C = ModuleContext> = (event: DomainEvent, ctx: C) => Promise<void>;

/** What a command may use to talk to the person at the terminal. Never put a secret in `out` or `err`. */
export interface CommandIo {
  out(text: string): void;
  err(text: string): void;
  /**
   * Asks for a secret (a password) without echoing it: from the terminal when there is one, else
   * as one line of standard input. A secret must never come from the command line (`argv`), where
   * the process list and the shell history keep it.
   */
  readSecret(prompt: string): Promise<string>;
}

/** A command of the `scorpion` CLI that a module contributes (`scorpion <name>`). */
export interface CommandDef<C = ModuleContext> {
  /** `create-admin`. Unique across the profile and not one of `RESERVED_COMMANDS`. */
  name: string;
  /** One line for the usage text. */
  description: string;
  /** The arguments, for the usage text: `create-admin --username <name> --email <address>`. */
  usage?: string;
  /**
   * Runs once the database is migrated and the module's services are built, but with no HTTP
   * server, no routes and no `system.ready`. Returns the exit code (0 when it returns nothing).
   */
  run: (args: readonly string[], io: CommandIo, ctx: C) => Promise<number | void>;
}

/** What a module's `routes(r, ctx)` receives. Every route is checked when it is registered. */
export interface RouteRegistrar {
  /** A route under `/api/internal` for the SvelteKit UI. */
  internal<R extends AppRoute>(route: R, handler: AnyHandler): void;
  /** A route of a public API version, for example `r.public('v1', route, handler)`. */
  public<R extends AppRoute>(version: 'v1', route: R, handler: AnyHandler): void;
  /** The service object this module's `services()` returned. Handlers call it; they hold no logic. */
  service<T = unknown>(): T;
}

export interface ModuleManifest<Services = unknown, C = ModuleContext> {
  /** Dotted id. The package name is `@scorpion/<id with dots as dashes>`. */
  id: string;
  version: string;
  /**
   * Prefix of the module's table names. Defaults to the id with dots and dashes as underscores
   * plus `_` (`kpi.ingestion` → `kpi_ingestion_`). See ADR 0004.
   */
  tablePrefix?: string;
  /** Permission ids, each starting with `<id>.`. */
  permissions?: Record<string, PermissionDef>;
  /** Validates the module's settings JSON. */
  settings?: z.ZodType;
  /** Drizzle tables (lazy import). */
  schema?: () => Promise<Record<string, unknown>>;
  /** Folder with the module's Drizzle migrations: an absolute path or a `file:` URL. */
  migrations?: string | URL;
  services?: (ctx: C) => Services | Promise<Services>;
  routes?: (r: RouteRegistrar, ctx: C) => void;
  jobs?: JobDef<C>[];
  /** Commands of the `scorpion` CLI. They run with the module's services and no web server. */
  commands?: CommandDef<C>[];
  events?: {
    /** Event name → payload schema. */
    emits?: Record<string, z.ZodType>;
    /** Event name → handler. Only events of the module itself or of its dependencies. */
    on?: Record<string, EventHandler<C>>;
  };
  /** Registries this module declares: name → schema of one entry. */
  registries?: Record<string, z.ZodType>;
  /** Entries for registries: registry name → entries. */
  contributes?: Record<string, readonly unknown[]>;
  /** Lazy import of the module's UI. Stored only; the shell uses it from M5. */
  ui?: () => Promise<unknown>;
}

const zodType = z.custom<z.ZodType>((value) => value instanceof z.ZodType, 'expected a Zod schema');
const fn = z.custom<(...args: never[]) => unknown>(
  (value) => typeof value === 'function',
  'expected a function',
);
const recordOf = <T extends z.ZodType>(value: T) => z.record(z.string(), value);

const manifestSchema = z.strictObject({
  id: z
    .string()
    .regex(MODULE_ID, 'must be dot-separated lower-case kebab case, e.g. "kpi.ingestion"'),
  version: z.string().regex(/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/, 'must be a semantic version'),
  tablePrefix: z
    .string()
    .regex(/^[a-z][a-z0-9]*(_[a-z0-9]+)*_$/, 'must be lower-case snake case ending in "_"')
    .optional(),
  permissions: recordOf(
    z.strictObject({ scope: z.string().min(1).optional(), description: z.string().min(1) }),
  ).optional(),
  settings: zodType.optional(),
  schema: fn.optional(),
  migrations: z.union([z.string().min(1), z.instanceof(URL)]).optional(),
  services: fn.optional(),
  routes: fn.optional(),
  jobs: z
    .array(
      z.strictObject({
        name: z.string().min(1),
        schedule: z.string().min(1).optional(),
        data: zodType.optional(),
        handler: fn,
        retry: z.strictObject({
          limit: z.number().int().min(0).max(100),
          delaySeconds: z.number().int().min(0),
          backoff: z.boolean().optional(),
        }),
        timeoutSeconds: z.number().int().min(1),
      }),
    )
    .optional(),
  commands: z
    .array(
      z.strictObject({
        name: z.string().regex(COMMAND_NAME, 'must be lower-case kebab case, e.g. "create-admin"'),
        description: z.string().min(1),
        usage: z.string().min(1).optional(),
        run: fn,
      }),
    )
    .optional(),
  events: z
    .strictObject({
      emits: recordOf(zodType).optional(),
      on: recordOf(fn).optional(),
    })
    .optional(),
  registries: recordOf(zodType).optional(),
  contributes: recordOf(z.array(z.unknown())).optional(),
  ui: fn.optional(),
});

/**
 * Declares a module. Validated by the loader at startup; see `validateManifest`.
 *
 * Name the dependencies you use as type arguments so that `ctx.deps` is typed from their
 * `public.ts`: `defineModule<Service, 'kpi.framework', 'kpi.impact'>({ ... })` for one required
 * and one optional dependency. The type arguments only shape `ctx.deps`; the dependencies
 * themselves come from package.json (ADR 0002).
 */
export function defineModule<
  Services = unknown,
  Required extends keyof ModuleServices = never,
  Optional extends keyof ModuleServices = never,
>(manifest: ModuleManifest<Services, ModuleContext<Required, Optional>>): ModuleManifest {
  return manifest as unknown as ModuleManifest;
}

function describeIssues(error: z.ZodError): string[] {
  return error.issues.map((issue) => {
    const path = issue.path.map(String).join('.');
    return path ? `${path}: ${issue.message}` : issue.message;
  });
}

/** Checks the shape of a manifest and the rules that need no other module. */
export function validateManifest(manifest: unknown, source: string): ModuleManifest {
  const parsed = manifestSchema.safeParse(manifest);
  if (!parsed.success) {
    const id = (manifest as { id?: unknown } | null)?.id;
    const who = typeof id === 'string' ? `module "${id}"` : `manifest of ${source}`;
    throw new KernelStartupError(`Invalid ${who}:`, describeIssues(parsed.error));
  }
  const value = manifest as ModuleManifest;
  const problems: string[] = [];

  for (const id of Object.keys(value.permissions ?? {})) {
    if (!id.startsWith(`${value.id}.`) || id.length === value.id.length + 1) {
      problems.push(`permission "${id}" must be prefixed with the module id ("${value.id}.")`);
    }
  }
  for (const job of value.jobs ?? []) {
    if (!job.name.startsWith(`${value.id}.`)) {
      problems.push(`job "${job.name}" must be prefixed with the module id ("${value.id}.")`);
    }
  }
  const jobNames = (value.jobs ?? []).map((job) => job.name);
  for (const name of jobNames.filter((name, index) => jobNames.indexOf(name) !== index)) {
    problems.push(`job "${name}" is declared twice`);
  }
  const commandNames = (value.commands ?? []).map((command) => command.name);
  for (const name of commandNames) {
    if (RESERVED_COMMANDS.includes(name))
      problems.push(`command "${name}" is a command of the server`);
  }
  for (const name of commandNames.filter((name, index) => commandNames.indexOf(name) !== index)) {
    problems.push(`command "${name}" is declared twice`);
  }
  for (const name of Object.keys(value.events?.emits ?? {})) {
    if (!EVENT_NAME.test(name)) {
      problems.push(`event "${name}" must be versioned, for example "service.created@1"`);
    }
  }
  for (const name of Object.keys(value.events?.on ?? {})) {
    if (name !== SYSTEM_READY && !EVENT_NAME.test(name)) {
      problems.push(`subscription "${name}" must be a versioned event name or "${SYSTEM_READY}"`);
    }
  }
  if (problems.length > 0) throw new KernelStartupError(`Invalid module "${value.id}":`, problems);
  return value;
}
