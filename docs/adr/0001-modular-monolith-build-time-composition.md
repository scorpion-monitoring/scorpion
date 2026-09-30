# ADR-0001: Modular monolith with build-time composition

- Status: Accepted
- Date: 2026-09-30

## Context

Scorpion must be pluggable (FEATURES.md §2): different research infrastructures need
different feature sets, from a plain service registry to a full KPI tracker with onboarding
and bibliometrics. A small research-infrastructure team runs it, so the operational cost has to
stay low.

The options were:

- microservices, one per feature;
- a monolith with plugins loaded at runtime (installed into a running instance);
- a modular monolith whose modules are chosen when the image is built.

Microservices need service discovery, cross-service transactions and many deployables, which
is too much for the team. Runtime plugin loading needs a stable binary plugin interface,
dynamic migrations, and a sandboxing and trust model for code added to a running instance.
It also makes the set of running code differ from what CI tested.

## Decision

Scorpion is a **modular monolith**: one server process (plus an optional worker mode), one
PostgreSQL database, and many modules with enforced boundaries.

- Every module is a workspace package under `modules/` with a `defineModule()` manifest and a
  single public entry (`public.ts`). Other modules may import only that entry, and only if they
  declare the module as a dependency. ESLint, `package.json` `exports` and pnpm's strict
  `node_modules` layout enforce this.
- A **deployment profile** (`profiles/<name>.ts`) lists the modules of one deployment. Modules
  are **composed at build time**: each profile is built into its own image
  (`scorpion:<version>-<profile>`), which contains only that profile's modules.
- **Adding or removing a plugin means changing the profile, rebuilding that profile's image,
  and restarting the instance.** Modules in an image can be switched on or off at runtime only
  through configuration.
- **Runtime loading of plugins is out of scope.** There is no plugin upload, no dynamic
  `import()` of code that was not in the build, and no plugin marketplace.

## Consequences

- Every image that runs was built and tested by CI as a whole, one image per profile. The CI
  matrix builds all profiles.
- Startup can check the dependency graph and refuse to run on a missing dependency or a cycle
  (M1), because the module set is fixed.
- Migrations run in dependency order at startup, for exactly the modules in the image.
- Adding a plugin to a deployment needs a rebuild and a restart, so a short downtime or a
  rolling restart. This is accepted.
- A third party cannot extend an instance without building their own image from a profile.
  This is accepted; revisit it with a new ADR if a real need appears.
- The module boundaries are checked at build time, so modules can later be split into separate
  services if ever needed, but nothing depends on that.
