# ADR-0002: Module dependencies come from package.json

- Status: Accepted
- Date: 2026-09-30

## Context

A module's dependencies were to be written twice: as `dependsOn` in the manifest, and as
workspace dependencies in `package.json`. Two lists drift. The ESLint boundaries rule (M0) already
reads `package.json`, so the manifest list could say one thing while the linter allowed another.

M1 also has to compose each image from its profile's modules only (ADR-0001), which needs a
static, build-time view of which modules the server contains.

## Decision

- **`package.json` is the only declaration.** A module's required dependencies are the module
  packages (packages under `modules/`) in its `dependencies`. Its optional dependencies are
  module packages in `peerDependencies` that `peerDependenciesMeta` marks `optional: true`. A
  package in both lists is required. `devDependencies` and other peers are not module
  dependencies. The manifest has no `dependsOn`.
- **One function computes them.** `computeModuleDependencies()` in `@scorpion/kernel` is called by
  the loader and by the ESLint boundaries rule, so an import the rule accepts is exactly a
  dependency the loader wires. A test feeds both the same fixture modules and compares.
- **The id maps to the package name by one rule**: `@scorpion/<id with dots as dashes>`. The
  loader checks that the package name matches the manifest id. The reverse mapping cannot be
  derived (`core.ui-shell` and `core.ui.shell` would both give `core-ui-shell`), so
  `packages/kernel/src/workspace-modules.ts` lists every module id with its package. `pnpm
modules:sync` generates it and `pnpm check` fails if it is stale. It also gives `defineProfile()`
  its type: a module id that is not in the workspace is a type error.
- **Profiles list every module they need**, dependencies included. The loader does not add
  dependencies on its own; a missing one stops startup with the path
  (`kpi.ingestion → kpi.framework (not in profile "kpi-tracker")`).
- **Build-time composition by code generation.** `pnpm scorpion profile:generate <name>` writes
  `apps/server/src/generated/profile.ts` with static imports of each module's manifest
  (`@scorpion/<pkg>/module`) and `package.json`. It also rewrites the module entries in
  `apps/server/package.json` to exactly the profile's modules. The server imports modules only
  through the generated file; a lint option (`manifestImporters`) allows the `/module` import
  there and nowhere else. The committed file is the one for `full`; the Docker build regenerates
  it for its `PROFILE` (the image build is described in the M1 image pull request).
- **Module packages export three entries**: `./module` (the manifest, default export), `./public`
  (what other modules may import) and `./package.json`.
- **Permission ids and job names start with the owning module's id** (`kpi.ingestion.measurement.submit`,
  `kpi.ingestion.reminder`); a permission carrying the prefix of a longer module id is rejected.

## Consequences

- One declaration to keep up to date; lint and loader cannot disagree.
- The server's `package.json` changes when a profile is generated. That is deliberate: pnpm then
  links and installs only the profile's modules. CI checks the committed state matches `full`.
- Generated files are committed and checked in `pnpm check`, so a stale one fails the build.
- A module that needs another only in its tests still declares it in `dependencies`; there is no
  dev-only module dependency.
- Nested module ids (`kpi` and `kpi.ingestion`) clash on the default table prefix; ADR-0004 covers
  that.
