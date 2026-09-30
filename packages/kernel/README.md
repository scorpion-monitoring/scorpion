# @scorpion/kernel

The kernel turns a list of modules into a running server: it reads their manifests, checks how they
fit together, migrates their tables, builds their services and wires their routes, events and
jobs. This guide is for people who write modules. Nothing in the kernel is specific to a feature;
what a module does is up to the module.

- [How start-up works](#how-start-up-works)
- [A module, start to finish](#a-module-start-to-finish) (a complete minimal module)
- [The manifest](#the-manifest)
- [Dependencies come from package.json](#dependencies-come-from-packagejson)
- [`ctx`: what a module receives](#ctx-what-a-module-receives)
- [Database and migrations](#database-and-migrations)
- [Events](#events)
- [Jobs](#jobs)
- [Registries](#registries)
- [Routes](#routes)
- [Profiles](#profiles)
- [Testing a module](#testing-a-module)
- [Start-up errors](#start-up-errors)

## How start-up works

`createKernel()` and `kernel.start()` run these steps in order:

1. **Resolve the profile.** The profile lists module ids. Each module's dependencies are derived from
   its `package.json`. The kernel puts the modules in dependency order and refuses to go on for a
   missing dependency or a cycle, naming the path: `kpi.ingestion → kpi.framework (not in profile
"kpi-tracker")`.
2. **Migrate.** Each module's Drizzle migrations run in dependency order, under one Postgres advisory
   lock, and the table-prefix rule is checked.
3. **Register** permissions, settings schemas, event schemas and registries.
4. **Validate contributions.** A module may contribute to a registry only if it owns the registry or
   depends on its owner, and every entry is checked against the registry's Zod schema.
5. **Build the services**, in dependency order, each with a `ctx` that reaches only its dependencies.
6. **Mount routes, subscribe event handlers**, and call the `system.ready` handlers. Jobs and the
   event dispatcher start with `kernel.startWorkers()` (in the web process when `WORKER_MODE=inline`,
   in `scorpion worker` otherwise).

Steps 3 and 4 only read manifests, so `createKernel()` runs them first, before anything touches the
database. A broken manifest therefore never leaves a half-migrated database behind. For the same
reason the Drizzle schema of every module is checked against the table-prefix rule before step 2.

## A module, start to finish

A module is a workspace package under `modules/`. This one is complete: it has a table, a service,
two routes, an event with a handler, a scheduled job, a registry with contributions and a settings
schema. It is a real fixture (`test/fixtures/modules/example-notes`) that `src/guide-example.test.ts`
starts and exercises, and the same test checks that the code below is what is in the repository.

The package exports its manifest (`./module`), its public entry (`./public`) and its `package.json`.
Other modules may import `./public` only, and only if they declare the dependency.

`package.json`:

```json
{
  "name": "@scorpion/example-notes",
  "version": "0.0.0",
  "license": "ISC",
  "private": true,
  "type": "module",
  "exports": {
    "./module": "./module.ts",
    "./public": "./public.ts",
    "./package.json": "./package.json"
  },
  "dependencies": {
    "@scorpion/contracts": "workspace:*",
    "@scorpion/kernel": "workspace:*",
    "drizzle-orm": "^0.45.3",
    "zod": "^4.6.5"
  }
}
```

`db/schema.ts` holds the Drizzle tables. Every table name starts with the module's prefix:

```ts
import { pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

// Every table starts with the module's prefix: `example.notes` → `example_notes_`.
export const note = pgTable('example_notes_note', {
  id: uuid().primaryKey(),
  text: text().notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
```

`public.ts` is the only file other modules import:

```ts
// The only file other modules may import. It holds the service interface and nothing else.
export interface Note {
  id: string;
  text: string;
}

export interface NotesService {
  add(text: string): Promise<string>;
  list(page: number, pageSize: number): Promise<{ notes: Note[]; total: number }>;
  /** The names of the export formats contributed to this module's registry. */
  formats(): string[];
  /** Queues the purge job now instead of waiting for its schedule. */
  purgeNow(): Promise<string>;
}

// Lets `ctx.deps['example.notes']` be typed in modules that depend on this one.
declare module '@scorpion/kernel' {
  interface ModuleServices {
    'example.notes': NotesService;
  }
}
```

`module.ts` is the manifest. `defineModule<NotesService>` fixes the type of `services()`:

```ts
import {
  createRoute,
  listEnvelope,
  paginate,
  paginationQuery,
  z,
  type AppEnv,
  type RouteHandler,
} from '@scorpion/contracts';
import { defineModule, ids } from '@scorpion/kernel';
import { count, desc, lt, sql } from 'drizzle-orm';
import { note } from './db/schema.ts';
import type { NotesService } from './public.ts';

const noteSchema = z.object({ id: z.string(), text: z.string() });

const listNotes = createRoute({
  method: 'get',
  path: '/notes',
  permission: 'example.notes.read',
  request: { query: paginationQuery() },
  responses: {
    200: {
      description: 'A page of notes, newest first.',
      content: { 'application/json': { schema: listEnvelope(noteSchema) } },
    },
  },
});

const addNote = createRoute({
  method: 'post',
  path: '/notes',
  permission: 'example.notes.write',
  request: {
    body: {
      required: true,
      content: {
        'application/json': { schema: z.strictObject({ text: z.string().min(1).max(500) }) },
      },
    },
  },
  responses: {
    201: {
      description: 'The note was created.',
      content: { 'application/json': { schema: z.object({ id: z.string() }) } },
    },
  },
});

export default defineModule<NotesService>({
  id: 'example.notes',
  version: '1.0.0',

  permissions: {
    'example.notes.read': { description: 'Read notes' },
    'example.notes.write': { description: 'Add notes' },
  },

  // Validates this module's settings JSON. The settings store arrives with core.settings (M3).
  settings: z.object({ retentionDays: z.number().int().min(1).default(90) }),

  schema: () => import('./db/schema.ts'),
  migrations: new URL('./migrations', import.meta.url),

  // A registry other modules can contribute to (this one also contributes to its own).
  registries: { 'example.notes.format': z.strictObject({ name: z.string().min(1) }) },
  contributes: { 'example.notes.format': [{ name: 'markdown' }, { name: 'plain' }] },

  events: {
    emits: { 'note.created@1': z.strictObject({ noteId: z.string() }) },
    on: {
      // Handlers run at least once, so they must be safe to run twice.
      'note.created@1': (event, ctx) => {
        ctx.log.info({ eventId: event.id }, 'a note was created');
        return Promise.resolve();
      },
    },
  },

  jobs: [
    {
      name: 'example.notes.purge',
      schedule: '0 3 * * *', // every day at 03:00 UTC
      retry: { limit: 2, delaySeconds: 60, backoff: true },
      timeoutSeconds: 300,
      handler: async (_job, ctx) => {
        await ctx.db.delete(note).where(lt(note.createdAt, sql`now() - interval '90 days'`));
      },
    },
  ],

  services: (ctx) => ({
    // A write that emits an event runs in one transaction: both happen, or neither does.
    add: (text) =>
      ctx.db.tx(async (tx) => {
        const id = ids.uuidv7();
        await tx.insert(note).values({ id, text });
        await ctx.events.emit('note.created@1', { noteId: id });
        return id;
      }),
    list: async (page, pageSize) => {
      const notes = await ctx.db
        .select({ id: note.id, text: note.text })
        .from(note)
        .orderBy(desc(note.id))
        .limit(pageSize)
        .offset(page * pageSize);
      const [total] = await ctx.db.select({ value: count() }).from(note);
      return { notes, total: total?.value ?? 0 };
    },
    formats: () =>
      ctx.registry('example.notes.format').map((entry) => (entry as { name: string }).name),
    purgeNow: () => ctx.jobs.enqueue('example.notes.purge'),
  }),

  // Routes are thin: parse, call one service method, map the result.
  routes: (r) => {
    const notes = r.service<NotesService>();
    r.internal(listNotes, (async (c) => {
      const query = c.req.valid('query');
      const { notes: page, total } = await notes.list(query.page, query.pageSize);
      return c.json(paginate(query, total, page), 200);
    }) satisfies RouteHandler<typeof listNotes, AppEnv>);
    r.internal(addNote, (async (c) => {
      const id = await notes.add(c.req.valid('json').text);
      return c.json({ id }, 201);
    }) satisfies RouteHandler<typeof addNote, AppEnv>);
  },
});
```

The migration comes from `pnpm db:generate --filter @scorpion/example-notes --name notes`, which runs
drizzle-kit on `db/schema.ts` and writes `migrations/`:

```sql
CREATE TABLE "example_notes_note" (
	"id" uuid PRIMARY KEY NOT NULL,
	"text" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
```

To put the module in a deployment, list its id in a profile (`profiles/full.ts`) and run
`pnpm modules:sync` once, so that `defineProfile()` knows the id.

## The manifest

Every field is optional except `id` and `version`. The manifest is validated with Zod when the server
starts; a wrong field is reported with its name.

| Field            | What it is                                                                                                                                                                                                                    |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`             | Dotted id in lower-case kebab case: `kpi.ingestion`, `core.ui-shell`, `maturity`. The package is `@scorpion/<id with dots as dashes>`; the loader checks the two match.                                                       |
| `version`        | Semantic version of the module.                                                                                                                                                                                               |
| `tablePrefix`    | Prefix of the module's tables, ending in `_`. Default: the id with dots and dashes as underscores plus `_` (`kpi.ingestion` → `kpi_ingestion_`). No prefix may start with another module's prefix, and `kernel_` is reserved. |
| `permissions`    | `{ [id]: { scope?, description } }`. Each id starts with the module's id and a dot: `example.notes.read`. Ids are unique across the profile, and an id that carries another module's id as its prefix is rejected.            |
| `settings`       | A Zod schema for the module's settings JSON. The kernel stores it and checks it at load; the settings store itself arrives with `core.settings` (M3).                                                                         |
| `schema`         | `() => import('./db/schema.ts')`: the Drizzle tables.                                                                                                                                                                         |
| `migrations`     | The folder with the Drizzle migrations: `new URL('./migrations', import.meta.url)` (or an absolute path).                                                                                                                     |
| `services(ctx)`  | Builds the module's service object (sync or async). Other modules get it as `ctx.deps['<id>']`.                                                                                                                               |
| `routes(r, ctx)` | Registers routes: `r.internal(route, handler)`, `r.public('v1', route, handler)`, and `r.service<T>()` for the module's own service.                                                                                          |
| `jobs`           | `{ name, schedule?, data?, handler, retry, timeoutSeconds }[]`. Names start with the module id.                                                                                                                               |
| `events`         | `{ emits: { 'name@1': ZodSchema }, on: { 'name@1': handler, 'system.ready': handler } }`.                                                                                                                                     |
| `registries`     | `{ [name]: ZodSchema }`: registries this module declares (the schema of one entry).                                                                                                                                           |
| `contributes`    | `{ [registry name]: entries[] }`: entries for registries of this module or of a dependency.                                                                                                                                   |
| `ui`             | `() => import('./ui')`. Stored only; the web shell uses it from M5.                                                                                                                                                           |

There is no `dependsOn` field; see the next section.

## Dependencies come from package.json

A module has **one** list of dependencies, the one in its `package.json` ([ADR-0002](../../docs/adr/0002-dependencies-from-package-json.md)):

- **Required:** the `@scorpion/*` _module_ packages (those under `modules/`) in `dependencies`.
- **Optional:** module packages in `peerDependencies` that `peerDependenciesMeta` marks
  `"optional": true`.

```json
"dependencies": { "@scorpion/kpi-framework": "workspace:*" },
"peerDependencies": { "@scorpion/kpi-impact": "workspace:*" },
"peerDependenciesMeta": { "@scorpion/kpi-impact": { "optional": true } }
```

The loader computes `dependsOn` and `optionalDependsOn` from these lists. The ESLint boundaries
rule uses the same function (`computeModuleDependencies()`), so what the linter lets you import is
what the loader wires. Consequences:

- You may import another module only as `@scorpion/<name>/public`, and only if it is declared.
- The profile must list every module its modules need. The loader does not add dependencies.
- An optional dependency that is not in the profile is simply absent: `ctx.deps['kpi.impact']` is
  `undefined`, and contributions or subscriptions that may belong to it are skipped, not errors.
- `devDependencies` do not count. A module that needs another one at run time declares it.

To type `ctx.deps`, name the dependencies as type arguments; their `public.ts` files augment
`ModuleServices`:

```ts
export default defineModule<MyService, 'kpi.framework', 'kpi.impact'>({
  id: 'kpi.ingestion',
  version: '1.0.0',
  services: (ctx) => {
    ctx.deps['kpi.framework']; // KpiFrameworkService
    ctx.deps['kpi.impact']; // ImpactService | undefined
    return {};
  },
});
```

## `ctx`: what a module receives

| Member               | What it gives you                                                                                                |
| -------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `ctx.moduleId`       | The id of the module.                                                                                            |
| `ctx.db`             | Drizzle over one shared `pg` pool. `ctx.db.tx(fn)` runs `fn(tx)` in one transaction.                             |
| `ctx.log`            | A pino logger with `module` bound (and `jobId` inside a job). Secrets are redacted.                              |
| `ctx.config`         | The validated environment: `DATABASE_URL`, `PROFILE`, `PORT`, `BASE_PATH`, `LOG_LEVEL`, `WORKER_MODE`, `ORIGIN`. |
| `ctx.events`         | `emit(name, payload)` into the outbox.                                                                           |
| `ctx.jobs`           | `enqueue(name, data?)`.                                                                                          |
| `ctx.registry(name)` | The validated entries of a registry of this module or of a dependency (frozen).                                  |
| `ctx.deps`           | The public service objects of the declared dependencies.                                                         |

`ctx.deps` reaches nothing else: asking for the id of a module that is not a declared dependency
throws (`Module "x" cannot reach "y"`), also for a dependency of a dependency. An absent optional
dependency reads as `undefined`. `ids.uuidv7()` makes primary keys that sort by creation time.

**Transactions.** Every write that touches more than one row runs in `ctx.db.tx()`. Query through the
`tx` argument, not through `ctx.db`, or the query runs outside the transaction. A `tx()` inside a
`tx()` becomes a savepoint: if the inner one throws and the outer catches it, only the inner part is
rolled back.

```ts
await ctx.db.tx(async (tx) => {
  await tx.insert(note).values({ id, text });
  await ctx.events.emit('note.created@1', { noteId: id }); // commits or rolls back with the insert
});
```

## Database and migrations

- Each module has its own migration folder and its own journal table, `kernel_migrations_<id>`
  ([ADR-0004](../../docs/adr/0004-migration-journal-and-locking.md)). Write `db/schema.ts`, then run
  `pnpm db:generate --filter @scorpion/<package>`; commit the generated folder.
- Migrations run in dependency order at every start, under one advisory lock, so two processes
  starting together migrate once. `scorpion migrate` runs them and exits.
- **Table-prefix rule.** Every table a module creates starts with its prefix. The check happens twice:
  on the Drizzle schema before the database is touched, and on `information_schema` inside the module's
  migration transaction. A table without the prefix rolls back the module's whole migration and stops
  the start-up, naming the table.
- Foreign keys may point only to core tables or to tables of a declared dependency. Never read or
  write another module's tables; call its public service.
- The kernel's own tables (`kernel_outbox`, `kernel_outbox_delivery`, `kernel_job_run`) live in
  `packages/kernel/migrations`. pg-boss keeps its queue tables in its own `pgboss` schema.

## Events

- Declare what you emit in `events.emits` with a versioned name and a Zod schema: `service.created@1`.
  Names are unique across the profile. Change the payload incompatibly by emitting `@2`.
- `ctx.events.emit(name, payload)` must run inside `ctx.db.tx()`. It validates the payload, then writes
  the event and one delivery row per subscribing module in that transaction. A rolled-back transaction
  produces no event.
- Subscribe with `events.on`. A module may subscribe to its own events and to events of its
  dependencies, nothing else. `system.ready` is a special name: the kernel calls it once, in process,
  after the services are built.
- Delivery is **at least once, per subscriber** ([ADR-0003](../../docs/adr/0003-transactional-outbox-and-dispatcher.md)).
  A handler that throws is retried with backoff (5 s doubling, up to 15 min, 8 attempts), and then the
  delivery is `dead`. The other subscribers are not called again. So a handler must be **idempotent**
  and must not depend on the order of events.
- The dispatcher wakes on `LISTEN/NOTIFY` and also polls. It runs where the workers run.
- Dead deliveries: `listDeadDeliveries(db)`; lag and counts: `outboxStats(db)` (the admin UI comes in M5).

## Jobs

A job is `{ name, schedule?, data?, handler, retry, timeoutSeconds }`:

- `name` starts with the module id (`example.notes.purge`).
- `schedule` is a cron expression in UTC. A new schedule also runs once right after it is created.
  A schedule you remove from the manifest is removed from the database at the next start.
- `data` is a Zod schema for `ctx.jobs.enqueue(name, data)`. Without it the job takes no data.
- `retry` is `{ limit, delaySeconds, backoff? }`; `timeoutSeconds` is how long the handler may run. The
  handler gets a `signal` that is aborted on timeout and at the end of a shutdown that outlasts its
  grace period. Honour it.
- Every attempt writes a row to `kernel_job_run` (status, start, end, duration, error, attempt):
  `listJobRuns(db, { jobName, status, limit, offset })`.
- `ctx.jobs.enqueue()` works from any process. **Jobs only run where the workers run**: in the web
  process with `WORKER_MODE=inline` (the default), or in `scorpion worker`.

On SIGTERM the server stops taking new requests, jobs and events, lets what is running finish for up
to 30 seconds, and only then closes the database connections.

## Registries

A registry is an extension point. A module declares one with a Zod schema for its entries
(`registries`); modules that depend on it contribute entries (`contributes`), and the owner reads
them with `ctx.registry(name)`. New field types, value types, adapters, exporters and widgets are
registry entries, not `if` branches in the owner.

- A contribution needs the owner to be the module itself or one of its dependencies, and each entry
  must parse against the schema (the error names the entry and the field). What you read is the parsed
  value, with defaults applied.
- If a module has an optional dependency that is not in the profile, contributions and subscriptions
  to names that no module in the profile provides are skipped (and logged), because they may belong
  to that absent module. Without such a dependency they are errors.
- The kernel declares one registry itself, `kernel.authorizer`, which any module may contribute to
  (see Routes). Exactly one entry may exist.

## Routes

Define a route with `createRoute()` from `@scorpion/contracts`; it wraps `@hono/zod-openapi`, so the
same Zod schemas validate the request and produce the OpenAPI document.

- It **must** declare `permission: '<a permission id of this module>'`, or `public: true` together with
  a `publicReason`. The type checker enforces it, and registration checks it again and names the
  module and route: `example.notes: GET /notes needs a permission (or public: true with a
publicReason)`. A permission of another module, a duplicate method and path, and a path without a
  leading `/` are rejected too.
- Register in `routes(r, ctx)`: `r.internal(route, handler)` serves `/api/internal/...` for the web
  UI; `r.public('v1', route, handler)` serves `/api/v1/...`. Everything is mounted under `BASE_PATH`.
- Handlers are thin: parse (Zod does it), call one service method, map the result. Throw the domain
  errors `NotFound`, `Conflict`, `Forbidden`, `Unauthorized`, `Invalid` from `@scorpion/contracts`; the
  error mapper turns them into RFC 9457 `application/problem+json`. Anything else that is thrown is a
  500 that shows only the request id.
- Lists use `listEnvelope(itemSchema)`, `paginationQuery()` and `paginate()`: the v1 envelope
  `{ metadata: { currentPage, pageSize, totalCount, totalPages }, result }` with 0-based pages and a
  stable order (sort by a key, then by id).

Every request passes the pipeline in this order: request id → security headers → logging → body
size limit (413) → Zod validation (422) → **authorisation hook** → handler → error mapper. The hook
is the registry `kernel.authorizer`; until `core.authz` contributes to it (M3) every route that is not
public answers 403 ([ADR-0005](../../docs/adr/0005-deny-by-default-before-authz.md)). In the service
layer, check resource-scoped permissions again (`ctx.authz.require`, M3).

## Profiles

`profiles/<name>.ts` lists the modules of one deployment:

```ts
import { defineProfile } from '@scorpion/kernel';

export default defineProfile({
  name: 'kpi-tracker',
  modules: ['core.identity', 'registry.services', 'kpi.framework', 'kpi.ingestion'],
});
```

`defineProfile()` checks the ids against the modules in the workspace (`WORKSPACE_MODULES`, written by
`pnpm modules:sync`; `pnpm check` fails when it is stale). `pnpm scorpion profile:generate <name>`
writes `apps/server/src/generated/profile.ts` with static imports of the profile's manifests and makes
the server depend on exactly those modules; the Docker build does this for its `PROFILE`, so an image
holds only its profile's modules. Adding or removing a module means rebuilding the image and
restarting.

## Testing a module

Every service method gets an integration test against real Postgres, including a denied-permission
case and a rollback case for multi-row writes. `@scorpion/testing` starts the database; build a kernel
over your module (and its dependencies) and call the service:

```ts
import { startPostgres } from '@scorpion/testing';
import { createKernel, createLogger, loadConfig } from '@scorpion/kernel';
import notes from '../module.ts';

const database = await startPostgres();
const kernel = createKernel({
  profile: { name: 'test', modules: ['example.notes'] },
  sources: [{ manifest: notes, packageJson }], // packageJson: import it from '../package.json'
  config: loadConfig({ DATABASE_URL: await database.createDatabase(), PROFILE: 'test' }),
  log: createLogger({ level: 'silent' }),
});
await kernel.start();
const service = kernel.services.get('example.notes') as NotesService;
// ... call the service, then:
await kernel.stop();
await database.stop();
```

The kernel's own tests (`src/*.test.ts`) and the fixture modules in `test/fixtures/` show more: two
kernels on one database to test parallel start-up, `kernel.dispatcher.dispatchOnce()` to drive event
delivery step by step, and `listJobRuns()` to see job history. Table-driven unit tests belong to the
pure parts (calculations, parsing, validation).

## Start-up errors

Start-up stops with the complete list of what is wrong, not the first problem.

| Message                                                          | Cause                                                                                                                                                                                                                                   |
| ---------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Invalid configuration:`                                         | An environment variable is missing or invalid. Values are never echoed.                                                                                                                                                                 |
| `Cannot resolve profile "p":` then `a → b (not in profile "p")`  | `a` depends on `b` in its `package.json`; add `b` to the profile.                                                                                                                                                                       |
| `Cannot resolve profile "p":` then `dependency cycle: a → b → a` | Two or more modules depend on each other.                                                                                                                                                                                               |
| `Cannot load profile "p":`                                       | A module of the profile is missing from the build, is supplied twice, or its package name does not match its id.                                                                                                                        |
| `Invalid module "x":` / `Invalid manifest of …`                  | A manifest field is wrong; the field is named.                                                                                                                                                                                          |
| `Cannot compose profile "p":`                                    | A duplicate permission, event or registry; a permission with another module's prefix; overlapping table prefixes; a subscription or contribution to a module that is not a dependency; a registry entry that does not match its schema. |
| `Module "x" broke the table-prefix rule:`                        | A migration created a table without the module's prefix.                                                                                                                                                                                |
| `Cannot register routes:`                                        | A route without a permission of its module (or `public: true` with a reason), a duplicate route.                                                                                                                                        |
| `Cannot schedule job "x":`                                       | The `schedule` is not a valid cron expression.                                                                                                                                                                                          |
| `Wrong profile:`                                                 | `PROFILE` is not the profile this build contains.                                                                                                                                                                                       |
