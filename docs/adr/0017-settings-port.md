# ADR-0017: The settings port: `ctx.settings` and `kernel.settingsStore`

- Status: Accepted
- Date: 2026-10-02

## Context

Since M1 the kernel validates and stores a module's `settings` schema, but `ctx` had no way to read a value: `core.identity`
used `settingsSchema.parse({})` behind a private port (backlog, "Settings for core.identity"). M3 sprint 3 stores real
settings in `core.settings` and wants every module to read its own with the same shape, with profiles that lack
`core.settings` still working. `core.settings` depends on `core.authz`, and modules that read settings must not depend
on a particular store module to type their context.

## Decision

- **`ctx.settings.get()`** returns the module's own settings: the stored JSON parsed with the manifest's `settings`
  schema, defaults applied. Typed by the fourth type argument of `defineModule` (`z.output<typeof schema>`). A module reads
  only its own settings; there is no `ctx.settings.of(otherModule)`.
- **The store is a kernel registry, like the authoriser and the authenticator** (ADR-0005, ADR-0006): `kernel.settingsStore`,
  at most one entry `{ read(moduleId): Promise<unknown> }` returning the stored JSON or `undefined`. `core.settings`
  contributes it. The kernel builds each module's port from the entry and the module's schema. **No entry, no store**:
  `get()` yields `schema.parse({})`, which is what makes a profile without `core.settings` keep working and is what
  `IdentitySettings` did before. A module without a schema gets `{}`.
  Considered: a `ModuleServices` dependency on core.settings (every module would need it in `package.json`, and a
  profile without it could not have settings at all); an `ctx.deps` lookup by interface (same problem). The registry
  keeps the dependency direction as it is: modules depend on nothing, the store depends on `core.authz`.
- **Parsing is the kernel's, caching is the store's.** The kernel parses on every `get()` (cheap, and the schema may have
  changed since the value was stored). The store keeps the raw JSON of each module in a map for **5 seconds** and empties
  an entry in the process that writes it (a generation counter keeps a read that raced with a write from caching the old
  value). Another process learns of a change when its entry expires: with several server processes a changed setting
  takes effect within **5 seconds**, the bound of sessions (ADR-0007) and permissions (ADR-0014), documented in the
  READMEs and proved by a test with two kernels over one database (a fake clock moves the TTL). The TTL is an option of
  the module for tests; production uses the constant.
- **Tolerant resolution.** A stored key that the schema rejects is dropped and the key falls back to its default; the other
  keys keep their stored values; the log names the keys once, never the values. Writes are validated by the same schema,
  so this only happens when the schema changed after the value was saved. Throwing instead would turn one stale key
  into a 500 on every request of the module; silently using all defaults would revert unrelated settings (for example
  turn local accounts back on). If even `{}` is invalid (a required setting nobody stored), `get()` throws a plain error
  naming the paths.
- **`ctx.settingsSchemas`** (read-only map of module id → schema, like `ctx.permissions`) lets `core.settings` validate
  what an administrator writes against the owning module's schema and describe it as JSON Schema, without importing any
  module. **`kernel.settingsOf(moduleId)`** gives the server's pipeline the same port for a module it has no context for;
  the pipeline uses it for the rate limits, which are a setting of `core.settings` (the pipeline is not a module).
- Settings are not secrets (CLAUDE.md). Secrets have their own service (ADR-0016).

## Consequences

- `core.settings` appears in the `full` and `kpi-tracker` profiles before `core.identity`; `core.identity` depends on
  it. Fixture profiles and the empty profiles are unaffected.
- A module whose services call `ctx.settings.get()` while the profile is being built, before `core.settings` has built its
  service, fails with "the service is not ready". It only matters for a module that does not depend on `core.settings`
  but reads settings during `services()`; the rule is "read settings when a request or a job needs them".
- The pipeline's rate limit depends on the module id `core.settings` and on the shape `{ rateLimits: { default, strict } }`;
  it validates what it reads and falls back to its constants. A second consumer of settings in the pipeline would
  justify a kernel-level settings declaration; until then this is the smallest thing that works.
- JSON Schema for the admin form comes from Zod 4's own `z.toJSONSchema` (input side, unrepresentable parts left open),
  so the plan's `zod-to-json-schema` dependency is not needed.
