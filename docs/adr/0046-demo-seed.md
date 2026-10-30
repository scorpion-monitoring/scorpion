# ADR-0046: `scorpion seed --demo`

- Status: Accepted
- Date: 2026-10-30

## Context

The knowledge base (issue #135, request R4) needs a reproducible instance with fictional, non-personal data, for screenshots and for running
documented `curl` examples in CI. `docs/architecture.md` lists `scorpion seed` among the operations commands; nothing implements it. Data must come in
through the services layer (CLAUDE.md rule 5), each module must own its data, and a profile must seed only the modules it has.

## Decision

1. **A manifest hook, not a registry.** `ModuleManifest.demoSeed(ctx, demo)` is called once per module that has it, in dependency order (the loader's
   order), by `kernel.runDemoSeed()` after migrations and after every module's services are built. A module without data has no hook; a module that is not
   released has no seed. The kernel holds no module data.
2. **The command is the server's, the data is the modules'.** `seed` is a reserved command name (`RESERVED_COMMANDS`); `apps/server/src/seed.ts` parses
   `scorpion seed --demo [--profile <name>] [--allow-production]` and prints what each module reported. `--profile` must name the profile this build is
   (a build holds one profile, ADR-0001); anything else is an error. Without `--demo` the command refuses: there is no seed that is not demo data.
3. **Who acts.** `core.identity`'s hook runs first and creates `demo-admin` (an administrator) and `demo-user` (role `user`), both on `example.org`, and
   registers them in `demo.actors`. Every other hook calls its own services as one of them, so a seed passes the validation and permission checks of a request.
   The server never imports a module.
4. **Passwords.** A demo account's password is the operator's (`SCORPION_DEMO_PASSWORD`), or else random (24 characters or more) and printed once when the account is
   created. No account is ever created with a fixed or guessable password, and there is no seed outside `--demo`.
5. **Looks like production → refused.** Two checks, both skipped by `--allow-production`: (a) the database holds an account whose username does not start with
   `demo-` (checked by `core.identity` before anything is written); (b) `NODE_ENV=production` and `ORIGIN` is not `localhost` or a reserved domain
   (`example.org`, `*.test`, `*.invalid`, ...).
6. **Idempotent.** Each hook finds what it made by a natural key (username, abbreviation, slug) and does not write again; measurements go through `upsertBatch`,
   which keys a row by service, indicator and month. A second run reports `created: 0`.
7. **Fictional data.** Organisations, services, indicators and values are made up; every address is on a reserved domain (RFC 2606); there is no ROR id, ORCID or
   real name. Measurements cover fixed months (2026-01 to 2026-06) with a fixed formula, so documentation shows the same chart on every instance.
8. **What is seeded.** `core.identity` (2 accounts), `registry.organisations` (3 providers, 1 consortium, the membership of `demo-user` in the first provider),
   `registry.services` (4 services, 2 public), `kpi.framework` (5 indicators, 1 KPI set, set on each demo service), `kpi.ingestion` (6 months of values).
   `kpi.analytics` reads these and has nothing to seed. `registry.services` exports `DEMO_SERVICE_SLUGS` from `public.ts` for the hooks above it.

## Consequences

- A profile seeds exactly its modules: `core-only` has the two accounts, `registry` adds the registry data, `full` adds the KPI data.
- A new module that has released data adds a `demoSeed` and a README paragraph; the integration test `apps/server/src/seed-profiles.test.ts` seeds twice per
  profile and compares row counts.
- The public API serves the demo data like any other (`apps/server/src/seed-public-api.test.ts` checks each v1 list against its route schema).
- The docs export (R1) can describe the seed through the manifest (`demoSeed` present or not).
