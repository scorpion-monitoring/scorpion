# Contributing

Read [CLAUDE.md](CLAUDE.md) first: it holds the module, API, security and testing rules.
This file summarises how work gets into `main`.

## Scope

- Every task belongs to a milestone in [docs/implementation.md](docs/implementation.md). Stay
  inside that milestone's scope.
- Anything outside it goes to [docs/backlog.md](docs/backlog.md) instead of being implemented.
- If a requirement in `docs/FEATURES.md` looks wrong or conflicts with the architecture, stop
  and ask. Record the answer in an ADR (`docs/adr/`).
- Add an ADR for every decision that changes the architecture.

## Branches

- `main` is always releasable. Work happens on short-lived branches that are merged into
  `main` only with CI green.
- Public API v1 changes must be additive. A breaking change goes to v2 and needs an ADR.

## Commits

- Small, reviewable commits.
- Message format: `<module>: <imperative summary>`, for example
  `kpi-ingestion: add XLSX adapter`. For work outside a module, use the area instead
  (`repo`, `ci`, `docker`, `docs`, `server`, `web`, `testing`).
- When a module manifest changes (permissions, settings, events, registries, jobs), update that
  module's `README.md` in the same commit.
- Say in the PR description why any new runtime dependency is needed. Never add Redis or
  another stateful service: Postgres is the only required one.

## Before you push

```bash
pnpm check                                  # lint, format, type check
pnpm test                                   # all packages (needs Docker)
pnpm test --filter @scorpion/<package>      # the packages you touched
pnpm test:e2e                               # if a user journey is affected
```

## Definition of done

From [docs/implementation.md](docs/implementation.md) §1. A milestone is **done** only when
all of the following hold:

1. Code is merged to `main` with CI green: lint, type check, unit, integration, contract, and
   E2E tests for any affected journey.
2. Every new route declares a `permission` and has a test for a denied request.
3. Every multi-row write runs in one transaction and has a rollback test.
4. Every input is validated by Zod. Invalid input returns 422 (problem+json) and never 500.
5. New tables live in the owning module's schema file and migration folder, prefixed with the
   module name.
6. Every defect from FEATURES.md §5 that the milestone touches has a named regression test
   (`defect-NN.*.test.ts`).
7. The public OpenAPI diff shows no breaking change, or the milestone explicitly bumps the API
   version.
8. Module docs (`modules/<id>/README.md`) are updated: permissions, settings keys, events,
   registries, jobs.
