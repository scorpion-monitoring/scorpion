# ADR-0052: The legacy migration reads a snapshot of the REST API and writes through the services as one account

- Status: Accepted; implemented in sprints 1 to 3 of M13 (released in 0.16.0); amended in sprints 2 and 3 and by [ADR-0053](0053-migrated-accounts-are-claimed-at-the-first-sign-in.md)
- Date: 2026-11-18
- Relates to: [ADR-0039](0039-gate-2-conditional-pass.md) (the open line of Gate 2), [ADR-0046](0046-demo-seed.md) (trusted code
  writes through the services as an account), [ADR-0035](0035-service-model.md) (the slug rule),
  [ADR-0018](0018-vocabularies-blob-store-and-branding.md) (vocabulary keys keep the legacy spellings)

## Context

M13 migrates the data of the legacy application into a new instance. The application in use is `ipk-bit/scorpion` (FastAPI with Neo4j 3.5,
InfluxDB 2.7 and Keycloak), not the PostgreSQL application that `FEATURES.md` §1 and the first M13 section of `implementation.md` describe
([M13 plan](../m13-sprint-plan.md) §0). Its data lives in three stores, two of them without a client in this stack. The migration has to be
repeatable (a dry run on a fixed copy, then a run, then the same run again), must never change the legacy side, and must pass every record
through the same rules as a request (CLAUDE.md rule 5). There is no system actor (`packages/contracts/src/actor.ts`).

## Decision

1. **A snapshot of the legacy REST API, not a database connection.** `migrate-legacy fetch` reads the API with an administrator's key into a
   directory of JSON files with a manifest (the base URL, the time, a SHA-256 per file). GET requests only. Every other command reads the
   snapshot and refuses it when a file was changed, removed or added. No Neo4j driver, no InfluxDB client, no new runtime dependency (Node's
   `fetch`, Zod). The key comes from the environment only and is never an argument, a log line or a file. The snapshot holds personal data:
   mode 0600, never inside the repository.
2. **A tool, not a module.** `tools/migrate-legacy` is a workspace package that is in no image. It boots the kernel of the `full` profile
   through the generated profile file (the one file that imports manifests) and reaches every module through its `public.ts`.
3. **`kernel.buildServices()`.** `start()` announces `system.ready`, and a handler of it writes a setting (registry.services' catalogue
   filters), so a tool that called it would write at start-up. The kernel gets one method that builds the services and nothing else: it
   refuses pending migrations (the tool never migrates; `scorpion migrate` does), mounts no routes, announces nothing and starts no workers.
4. **The writers are public.** `OrganisationsPublic` and `ServicesPublic` add `create` and `update`; registry.organisations exports
   `parseAbbreviation`, registry.services `parseSlug` (with `RESERVED_SLUGS`, `MAX_SLUG_LENGTH`), and both their input and view types. No new
   method: the writers check the caller's permission as for a request, and the tool checks records with the modules' own rules instead of a
   copy that could drift.
5. **One account, `legacy-migration`.** The tool writes as this account, which it finds by its username or creates as `create-admin` makes
   the first administrator (active, the Admin role, in one transaction, with a random password shown nowhere). It never gives a role to an
   account it found: an account of that name without Admin is refused by the services at the first write, and the run stops with nothing
   written. Every migrated row shows the migration as its author in the audit trail.
6. **Idempotent by natural keys.** An organisation is found by its type and abbreviation, a service by its slug (sprint 2: an indicator or a
   KPI set by its slug, a user by the OIDC subject (since ADR-0053: by the address), a measurement by service, indicator and period). What exists and matches is kept, what
   differs is updated, the rest is created; a second run over the same snapshot reports "kept" for everything. The tool records no state of
   its own, so a run stopped halfway is finished by running it again.
7. **A mapping file and a report.** What the legacy data does not say (abbreviations of consortia, the stage of a service without one) is a
   JSON mapping checked by Zod; `plan` writes a first one with every gap marked. A dry run reads the target and applies the modules' rules
   without writing. The report names, for every record dropped or changed, the rule that decided it; it may hold names, so it has mode 0600
   and is never written into the repository.

## Consequences

- The migration depends on what the legacy API returns. What it cannot return is listed in the tool's README: values of 0 (the route leaves
  them out), services without a provider or a category, consortium abbreviations, the OIDC subjects of users and the holders of API keys.
- A dry run checks with the modules' parsers and reads; checks that only run inside `create` (a licence against the live SPDX list,
  uniqueness against a concurrent write) can still refuse a record in the run. The run reports it and goes on.
- `create` and `update` of the two registry modules are now reachable by every module that declares the dependency. They are the methods a
  request calls, with the same permission check, so this widens no access.

## Amended in sprint 2 (KPIs, measurements, people)

- **Two trusted methods in `core.identity`:** `UserService.findByIdentityAsSystem(provider, subject)` (the natural key of a
  migrated user) and `IdentityService.deactivateAsSystem(userId)` (the account's end: the same transaction as
  `POST /users/{id}/deactivate`, no permission, no route, the event names no user as the cause, and the last-Admin rule still
  applies). In `registry.organisations`, `OrganisationsPublic` widens by `request`, `decide` and `listOwn` of the memberships;
  they check the caller's permission as a request does. Sprint 2 stopped and asked before adding them; the maintainer's answers
  of 2026-11-18 are in the plan (§13).
- **The account's life.** Deactivated at the end of a run (`--keep-account` keeps it). Nothing reactivates an account, so a run
  after it uses `legacy-migration-2`, `-3`, …; a deactivated account is never reused. On an instance with no other active
  administrator the last-Admin rule keeps it active, and the report says so.
- **Kept, not overwritten.** An existing indicator, KPI set, service set or membership is left as it is and a difference is
  reported, because people edit them after the first run; missing set rows and extras are added.
- **The subjects file** (decision 12) is the one source of a user's OIDC subject. A user without one is not migrated.
  _Replaced by [ADR-0053](0053-migrated-accounts-are-claimed-at-the-first-sign-in.md): no subjects file and no
  `findByIdentityAsSystem`; each account is claimed at its owner's first sign-in, and every migrated user gets the role
  `user`._
- **Mail.** Membership requests and decisions go through the services, which queue mails and inbox items; the tool starts no
  worker. The runbook keeps the mail transport at `none` until the announcement.

## Amended in sprint 3 (compare)

- **One trusted read in `kpi.ingestion`:** `reads.storedValuesAsSystem(serviceId, fromPeriod, toPeriod)` returns every value of a
  service in a window of at most 120 months with the `source` that wrote it last (no person, run or file name; no
  permission, no route). `migrate-legacy compare` needs it to tell a value the migration wrote (`legacy-migration`) from one
  a person entered after the run. Sprint 3 asked before adding it; the maintainer agreed on 2026-11-18.
- **`compare` writes nothing and acts as nobody.** It reads with trusted reads only, since the migration account is
  deactivated at the end of a run, and checks the target against the run's own transform. A difference is expected (a rule
  of the transform explains it), unexplained (what a run writes is not in the target as written; exit code 1) or reported
  (what a person may have changed after the run). What the trusted reads cannot answer is listed in the tool's README.
- **The cutover is Gate 4's final run** (decision 11), in the order of the runbook in the tool's README.
