# ADR-0032: the `registry` profile

- Status: Accepted
- Date: 2026-10-09

## Context

ADR-0030 left two profiles, `full` and `core-only`, and said that a registry profile is added by the first milestone that needs one.
M6 adds the first module that is not a `core.*` module (`registry.organisations`). Gate 2 asks for a registry profile without KPI
modules on staging, and testing it early needs an image under a name that carries no operator (ADR-0030 removed `denbi-registry`
for that reason).

## Decision

1. A profile `registry` is added: the seven core modules and `registry.organisations`. M7 adds `registry.services` and M8 adds
   `public-api`; each milestone extends the list and says so here in its own ADR or changeset. KPI modules are not part of it.
2. `full` stays "every module" and gains `registry.organisations` too, so every module has a profile that exercises it in the
   end-to-end tests (the stack runs `full`). `full` and `registry` therefore differ only by the modules that `registry` leaves out
   (none yet; the KPI modules from M9).
3. CI: the `image` matrix gets a leg `registry` (build, module-set check, smoke tests of `/healthz`, `/readyz`, `/metrics` and the
   web server), and the `publish` matrix gets `registry`, so `dev-registry`, `dev-<short sha>-registry` and `<x.y.z>-registry` appear
   in `ghcr.io/scorpion-monitoring/scorpion`. It is the same package, so no package setting changes. The workflow keeps
   `permissions: contents: read` at the top and pins nothing new.
4. Documentation that names profiles (`README.md`, `CONTRIBUTING.md`, `docs/architecture.md`) lists `full`, `core-only` and
   `registry`. The architecture table gets a `registry` column; the other example columns remain plans.

## Consequences

- An operator who pulls `dev-registry` after the M6 merge gets an image that holds organisations only; the README of the module and
  the changeset say what each release contains. Nothing is deployed from it before Gate 2.
- One more image to build per push (about the cost of `core-only`).
- A module added to a profile later needs the profile file, the module id list (`pnpm modules:sync`) and nothing in CI.
