# M16 Sprint Plan: `bibliometrics`, publications of a service and their citations

Status: **approved, 2026-11-25; every decision in §11 answered as recommended by the maintainer.** Nothing has been built yet; sprint 1 is next.
Scope source: [implementation.md](implementation.md) §6, M16; [architecture.md](architecture.md) (the `bibliometrics` row: tables `publication`, `citation_snapshot`, emits `citations.updated`, "scheduled refresh stores history, can write a Bibliographic KPI through the ingestion API"; the registry `biblio.citationSource` with OpenAlex first; the weekly citation refresh; the caches "DOI content negotiation, permanent per DOI" and "OpenAlex, snapshot per refresh run"); FEATURES §3.12 (publications and citations) and §6 (the pluggability matrix: Crossref, Europe PMC and Dimensions as later citation sources).

M16 is size M in `implementation.md`: **three sprints (about three to four weeks for one developer)**. It adds **one module** (`modules/bibliometrics`, package `@scorpion/bibliometrics`, `full` profile only), **two adapters** in `packages/integrations` (DOI and OpenAlex), **no runtime dependency**, **no public v1 route**, and one additive trusted write on `kpi.ingestion`. It releases as **`0.19.0`**; its ADR is **ADR-0056**.

## 0. Order of the milestones

M16 is taken **before M14 and M15**. The overview in `implementation.md` §2 already lists M16 as depending on G3 only, and the three parity milestones share no table, registry or route:

- M14 (`maturity`) and M15 (`onboarding`) are a pair: onboarding needs a published maturity model version. Neither reads publications.
- M16 reads services (`registry.services`) and writes measurements (`kpi.ingestion`), both released before G3.
- M18 (`backup`, hardening) depends on M14 to M17 and stays last.

New order: **M16 → M14 → M15 → M17 → M18** (M17 can move in anywhere before M18). `implementation.md` §2 records the order; the version numbers follow it (M16 is `0.19.0`, the next milestone `0.20.0`).

## 1. Before sprint 1

State on 2026-11-25 (checked against `dev` at `d176f4c`, which carries `0.18.0`). The first day of sprint 1 re-checks each line and writes what it found differently under this list, as M12 did.

1. **`dev` carries `0.18.0`.** Pull first. `assessed_commit` in `docs/security/asvs/v*.yaml` is the maintainer's field; do not change it. The last ADR is ADR-0055 (dashboard export file), so **M16's ADR is ADR-0056**.
2. **There is no legacy data.** The application in use (`ipk-bit/scorpion`) stores no publications (M13 plan §0 and §8: "Maturity, onboarding, publications and announcements have no legacy data"). The production cut-over to the rebuild happened on 2026-11-23, so the module starts empty on the production instance and `tools/migrate-legacy` is not touched.
3. **What exists to build on** (read in the source on the day of writing):
   - **The service page has a section slot.** The `ui` entry of a module may export `wizardExtensions` with `sections`; `kpi.framework` contributes `{ kpis: ServiceKpis }`, which `Service.svelte` draws after the record. The publications list is a second section (`publications`). `apps/web/src/kpi-service-parts.test.ts` asserts that **only** `@scorpion/kpi-framework` has `wizardExtensions`; sprint 3 widens that assertion to the two modules (the assertion changes, the test is not weakened).
   - **`service.profileContributor`** (registry of `registry.services`): `contribute(service, { db })` adds keys to the Schema.org profile of a public service. Bibliometrics can contribute `citation` (a list of `ScholarlyArticle` with the DOI as `@id`), decision 7.
   - **No system actor.** `Actor` in `packages/contracts/src/actor.ts` is `AnonymousActor | UserActor`. `MeasurementsService.upsertBatch(actor, serviceId, rows, { source })` checks the scoped `kpi.ingestion` submit permission for the actor, so a weekly job cannot call it as written. Sprint 3 adds a trusted sibling (§4).
   - **`measurement.source`** is a column (`^[a-z][a-z0-9-]{0,63}$`): the KPI write uses `bibliometrics`, so the M11 widgets and `storedValuesAsSystem` can tell these values from form or file submissions.
   - **The vocabulary `thematic`** has the built-in term `Bibliographic` (`core-settings/service/builtin-vocabularies.ts`). The indicator the KPI write targets is chosen by id in a setting, never by name, and the setting is checked to be numeric and in that category (decision 4).
   - **`packages/integrations`** has `createSpdx` (timeout, retry with backoff, a cache port, a bundled fallback, a stub for tests, no dependency, Node `fetch`): the pattern for the two new adapters. The architecture's repository tree names "SPDX, DOI, OpenAlex adapters" in this package.
   - **Scoped permissions per service:** `kpi.ingestion` declares a scoped `submit` and contributes an `authz.resourcePolicy` that asks `registry.services.isProviderMemberAsSystem` at every call. `bibliometrics` writes the same way (§3).
   - **Secrets:** `SettingsService.getSecret(name)` (trusted); `matomo` keeps its key as `matomo.user-id-key`, set with `pnpm scorpion set-secret`. The OpenAlex key is `bibliometrics.openalex-api-key`.
   - **Jobs:** `kpi.ingestion`'s reminder (`schedule`, `retry`, `timeoutSeconds`, a report of counts for the job-run history, "run now" on the job page) is the pattern for the weekly refresh.
   - **Rate limits** are declared per route (`rateLimit: 'default' | 'strict'`).
4. **The external services, re-checked on the first day** (their terms change, and the plan must not assume them):
   - DOI content negotiation: `GET https://doi.org/<doi>` with `Accept: application/vnd.citationstyles.csl+json` redirects to the registration agency (Crossref, DataCite, mEDRA, ...). Check which agencies answer CSL-JSON, especially **DataCite for Zenodo software DOIs**, which services cite often.
   - OpenAlex `/works?filter=doi:<a>|<b>|...&per_page=100`: whether an API key is now required or optional, the daily limits with and without one, and whether a `mailto` is still asked for. If a key has become required, the setting `enabled` stays off until one is stored, and the README says so.
5. **Lessons of M7 to M13c applied from the first sprint:** unique names and ids in tests (specs share a database); no regex built from a variable in a test (CodeQL); run `pnpm test` and `CI=true pnpm test:e2e:parallel` in full **before** `pnpm security:asvs --write`, one after the other, with no single spec or `pnpm test:contract` in between (they overwrite the JUnit reports); the label `asvs-no-impact` and the line `ASVS impact: none because <reason>` on its own line in the PR description, set when the PR is opened; count the API calls a page makes (the default bucket is shared); the full unit suite before a PR (repo-wide guards such as branding, defect-01 and the authorization doc live in other packages); a docs-only change goes into the next PR.
6. **Rules from the knowledge-base work:** the manifest is the source of every permission, setting, event, registry, job, env var and command (ADR-0047); the module adds a `demoSeed` (ADR-0046) of fictional publications whose metadata is stored by the seed, **with no network call** (DOIs under the Crossref test prefix `10.5555`); sprint 3 decides in its first hour whether "add a publication" earns a journey spec (`apps/web/e2e/journeys/jNN-*.spec.ts` with `docShot()`).

## 2. What earlier milestones hand to M16

| From                   | What M16 uses                                                                                                                                                                                                    |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| M7 `registry.services` | Service ids and existence (`existsAsSystem`), the provider membership question (`isProviderMemberAsSystem`), the section slot of the service page, `service.profileContributor`, the `registry.service.*` events |
| M9 `kpi.framework`     | The indicator the KPI write targets: its value type, its thematic category and whether it is in the effective set of a service (`effectiveIndicatorsAsSystem`)                                                   |
| M10 `kpi.ingestion`    | `upsertBatch()` and its unique `(service, indicator, period)` (defect 6), the `source` column, the job pattern; sprint 3 adds a trusted write (§4)                                                               |
| M11 `kpi.analytics`    | Nothing new: the stored values show in the existing widgets                                                                                                                                                      |
| M5 `core.ui-shell`     | `ui.routes`, the catch-all route, the message catalogues, `url()`, the chart adapter of `ui-kit` (the citation history sparkline)                                                                                |
| M3 `core.settings`     | Module settings, the `secrets` store, the vocabulary `thematic`                                                                                                                                                  |
| M4 `core.audit`        | The audit of adding and removing a publication                                                                                                                                                                   |
| M8 `public-api`        | Nothing: no public v1 route (decision 8)                                                                                                                                                                         |

## 3. Cross-sprint rules

- **One pull request per sprint** (CLAUDE.md). ADRs, READMEs, backlog lines, the regenerated OpenAPI document and review fixes go into the sprint's pull request. Push only when the sprint is complete and verified (`pnpm check`, the tests of every package touched, `pnpm test:contract`, the e2e of any journey changed, `pnpm openapi:diff`). The release (end of sprint 3) follows CONTRIBUTING.md "Releases"; every outward step waits for the maintainer.
- **One new module, additive changes elsewhere.** `bibliometrics` depends on `core.authz`, `core.settings`, `core.audit` and `registry.services`; `kpi.framework` and `kpi.ingestion` are added in sprint 3, which first imports them. `core.ui-shell` is an **optional peer**. Other modules are read only through their `public.ts`. Nothing depends on `bibliometrics`.
- **Permissions** (proposed, decision 2):
  - `bibliometrics.publication.read` (plain): held by the role `user`, because services are readable by every signed-in person.
  - `bibliometrics.publication.write` (scoped to `service`): add and remove a publication, and "check citations now". Admin holds it everywhere. The members and managers of the service's provider hold it through an `authz.resourcePolicy` that asks `registry.services.isProviderMemberAsSystem`, as `kpi.ingestion`'s `submit` does. The route declares the plain write; the service checks `ctx.authz.require(actor, write, { type: 'service', id })` again.
  - The settings are edited with `core.settings.write`, the key with `core.settings.secret.write`. The module adds no settings permission.
- **A missing number is never a zero.** A DOI that OpenAlex does not know, a failed batch or a source that is turned off is `unknown`, not `0`. The service's total says over how many publications it is taken ("312 citations, 4 of 5 publications found"). The KPI write takes the total only when every publication of the service is found in this run (decision 5), so a monthly value never drops because a source failed.
- **Outbound requests are bounded.** Each adapter has a timeout (5 s), a capped retry with exponential backoff on 429 and 5xx (honouring `Retry-After`), a maximum body size, and a check of the response shape (an HTML error page is a failure, not data). The DOI adapter follows redirects only to `https:` hosts and at most five times. The DOI is validated (`10.<registrant>/<suffix>`, at most 256 characters, no whitespace) before any request, so a user's input cannot choose the host. No adapter logs a key; the OpenAlex key goes in a header or query parameter that is redacted in logs.
- **Everything is data.** Citation sources come from the registry `biblio.citationSource`, never from an `if (source === 'openalex')`. The KPI's indicator comes from a setting by id.
- **Public v1 is unchanged** (`pnpm openapi:diff`). New routes are internal, list routes use the legacy envelope with 0-based pages and a stable order (publication date descending, then id).
- **ASVS.** No path in `tools/asvs-report/scope.ts` is expected to change (`core-identity`, `core-authz`, the pipeline, `route.ts`, `docs/security/**`). Each PR therefore carries `asvs-no-impact` with a true reason, unless a sprint touches one of those paths; then the chapter file is updated in the same PR.
- Every pull request carries a changeset (package `scorpion`): `minor` where an operator or a user sees something, `patch` otherwise. Every manifest change updates `modules/bibliometrics/README.md` in the same commit.

## 4. The model

**Tables.** Prefix `biblio_` (the manifest sets `tablePrefix`, as `svc_` and `kpii_` do; decision 1). A foreign key may point only to core tables or declared dependencies, so `service_id` is a plain `uuid` checked by the service, as in `kpi.ingestion`.

| Table                      | Holds                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `biblio_publication`       | One row per (service, DOI): `id`, `service_id`, `doi` (normalised: lower case, no `https://doi.org/`, `doi.org/` or `doi:` prefix), `added_by`, `added_at`. **Unique `(service_id, doi)`** (FEATURES §3.12: duplicate detection). Removed by id, scoped to the service (defect 7's lesson: never unscoped, never by name)                                                                                                                                                   |
| `biblio_doi_metadata`      | The cache of the DOI resolver, one row per DOI, shared by every service that lists it: `doi` (primary key), `title`, `authors` (a JSON array of display names, at most 100), `issued` (a date with its precision: year, month or day), `container` (journal or repository), `type`, `resolved_at`, `status` (`ok`, `not-found`, `failed`). Kept permanently (the architecture's "permanent per DOI"); a `failed` row is retried by the weekly job, a `not-found` row is not |
| `biblio_citation_run`      | One row per refresh: `id`, `trigger` (`schedule`, `manual`), `source` (the registry id), `started_at`, `finished_at`, counts (`asked`, `found`, `failed`), an error text without a key or a URL with a query                                                                                                                                                                                                                                                                |
| `biblio_citation_snapshot` | One row per (run, DOI) that the source answered: `run_id`, `doi`, `source`, `cited_by_count`, `taken_at`. The history of a publication is its snapshots in time order. Snapshots belong to the DOI, not to the service, so a DOI that two services list is fetched once                                                                                                                                                                                                     |

**The DOI.** `normaliseDoi(input)` strips `https://doi.org/`, `http://dx.doi.org/`, `doi.org/` and `doi:` (any case), trims, lower-cases and checks the pattern; it is a pure function with a table-driven test. A DOI that does not match is a 422 naming `doi`.

**Adding a publication** (`PublicationsService.add(actor, serviceId, rawDoi)`): checks the scoped write, normalises the DOI, refuses a duplicate with a 409 (`Conflict`, naming the existing publication), writes the row, and resolves the metadata **in the request** with a short timeout (decision 6). If the resolver fails, the row is kept with metadata `failed` ("title not yet known"), and the weekly job retries it. One transaction for the row and the audit entry; the metadata row is written outside it (a cache, not domain data).

**Listing:** `list(actor, serviceId, { page, pageSize })`: publications joined with their metadata and their latest snapshot per source, sorted by `issued` descending (unknown dates last), then id; 5 per page by default (FEATURES §3.12), at most 50. Each row carries `citedByCount: number | null` and `citationsAsOf`. The answer also carries the service's total (`total`, `found`, `of`).

**The citation refresh.** `CitationService.refresh(trigger, serviceIds?)`:

1. collects the distinct DOIs of the given services (all services for the schedule);
2. for each enabled source in the registry `biblio.citationSource`, asks it in batches of at most 100 DOIs (`fetchCounts(dois, { signal })` → `Map<doi, number>` plus the DOIs it does not know). OpenAlex is the only entry: `GET /works?filter=doi:<a>|<b>|…&select=doi,cited_by_count&per_page=100`, the API key from the secret if one is stored, backoff on 429;
3. writes one snapshot per DOI found, in one transaction per batch, and the run row;
4. emits `bibliometrics.citations.updated@1` (`runId`, `serviceIds` (at most 2,000; the schedule sends one event per slice), `found`, `failed`), ids and counts only;
5. if the KPI write is on (sprint 3), writes the services' totals (below).

The weekly job `bibliometrics.citations.refresh` runs Monday at 04:00 UTC (`0 4 * * 1`; the architecture's "weekly"), handles at most 2,000 DOIs per run slice, and queues the next slice. It is idempotent: a second run on the same day adds a second snapshot, which the history read collapses to the latest per day. **Check citations now** on the service page refreshes that one service (`manual`), rate-limited with `strict`, and is refused for 10 minutes after the last refresh of that service (a 429 with `Retry-After`), so a person cannot spend the instance's daily OpenAlex budget.

**The Bibliographic KPI** (sprint 3, setting `kpi.indicatorId`, empty by default, so off). For every service of the run whose effective KPI set contains the indicator, and whose publications were **all** found in this run, the total is written as the value of the **current month** with source `bibliometrics`. Earlier months are never written (no backfill: OpenAlex's `counts_by_year` is yearly, so it is in the backlog). A service without the indicator in its set is skipped and counted in the run's report, never an error.

This needs a trusted write, because the job has no actor: **`kpi.ingestion` gains `upsertBatchAsSystem(serviceId, rows, { source })`**, the sibling of `upsertBatch()`. It runs the same validation, the same `ON CONFLICT (service, indicator, period)` upsert (defect 6) and the same `measurement.recorded@1` event with `actorId: null`. It skips only the scoped permission check. It is exported through `public.ts` with a comment saying it is for trusted module code only (like `getSecret`), and it has no route. A test in `kpi.ingestion` proves that it upserts rather than inserts, and that an indicator outside the effective set is refused, as for `upsertBatch()`. ADR-0056 records why a trusted write is preferred to a migration-style service account (the account model of the push-agent brainstorm in the backlog is not built yet, and this write is server-internal).

**Routes** (internal, under `/api/internal/bibliometrics`; each calls one service method, which checks the permission again; `Cache-Control: no-store`):

| Route                                                          | Permission                       | Notes                                                                        |
| -------------------------------------------------------------- | -------------------------------- | ---------------------------------------------------------------------------- |
| `GET /services/:serviceId/publications?page=&pageSize=`        | `bibliometrics.publication.read` | The list and the total; an unknown service is a 404 problem, never a 500     |
| `POST /services/:serviceId/publications` `{ doi }`             | write (scoped)                   | 201 with the row; 409 on a duplicate; 422 on a bad DOI; rate limit `default` |
| `DELETE /services/:serviceId/publications/:publicationId`      | write (scoped)                   | By id, scoped to the service: a publication of another service is a 404      |
| `GET /services/:serviceId/publications/:publicationId/history` | `bibliometrics.publication.read` | Snapshots, at most one per day, at most 520 (ten years of weeks)             |
| `POST /services/:serviceId/citations/refresh`                  | write (scoped)                   | `strict` rate limit plus the 10-minute rule; 202 with the run id             |

**Settings** (`settings-schema.ts`, edited at `/admin/settings/bibliometrics`): `enabled` (default `true`: DOI resolving and OpenAlex are free and need no account; decision 3), `openalex.mailto` (optional, an address the operator chooses; never filled from the instance's contact settings without the operator setting it), `kpi.indicatorId` (optional). **Secret:** `bibliometrics.openalex-api-key` (optional unless the day-one check finds it required). **Env:** none.

## 5. Sprint overview

| Sprint | Branch                          | Theme                                                                                                                                                               | Size            |
| ------ | ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------- |
| 1      | `feature/m16-publications`      | ADR-0056, the module, the DOI adapter, `biblio_publication` and `biblio_doi_metadata`, add / list / remove, the demo seed                                           | about 1.5 weeks |
| 2      | `feature/m16-citations`         | The registry `biblio.citationSource`, the OpenAlex adapter, snapshots and runs, the weekly job, "check now", the history read, the event                            | about 1 week    |
| 3      | `feature/m16-publications-page` | The section of the service page, the settings page, the Bibliographic KPI with `upsertBatchAsSystem`, the Schema.org contribution, e2e, documents, release `0.19.0` | about 1.5 weeks |

## 6. Sprint 1: the module, the DOI adapter and the publications

**Goal:** a provider member can add a publication by DOI to a service through the internal API, see it listed with its title, authors and date, and remove it. Nothing is shown in the web app yet.

Work items:

1. **ADR-0056** "Bibliometrics: publications, citation snapshots and the trusted KPI write": the tables and the prefix, the metadata cache shared across services, the permission model, the "unknown is not zero" rule, the outbound request rules, the trusted write (written now, built in sprint 3), and the deviation from the architecture's "listens to `service.updated`" (nothing in the module depends on a service's fields; a service is never deleted, so no clean-up event is needed).
2. **`packages/integrations/src/doi.ts`**: `normaliseDoi`, `createDoiResolver({ fetch, timeoutMs })` returning `resolve(doi) → { status: 'ok', metadata } | { status: 'not-found' } | { status: 'failed', reason }`, CSL-JSON parsing (`title`, `author[].family/given/literal`, `issued.date-parts`, `container-title`, `type`) with bounds on every field, the redirect rule, and `createStubDoiResolver(table)` for tests. Unit tests with recorded CSL-JSON from Crossref and DataCite (fixtures in the package, no network in CI).
3. **The module** `modules/bibliometrics`: `module.ts` (manifest with id, `tablePrefix: 'biblio_'`, permissions, settings, the resource policy, an empty `events.emits` until sprint 2), `public.ts`, `db/schema.ts` and the first migration (`pnpm db:generate --filter @scorpion/bibliometrics`), `service/publications.ts`, `routes.ts`, `README.md`. Add the module to `profiles/full.ts` and run `pnpm modules:sync` and `pnpm scorpion profile:generate full`.
4. **The routes** `GET`, `POST` and `DELETE` of publications, through `createRoute()`, with Zod bounds and a contract test each.
5. **`demoSeed`**: three fictional publications on two demo services, under `10.5555/`, with stored metadata and no network call; a test proves the seed makes no request. Sprint 2 adds two citation snapshots each, so that the sprint 3 page has a history to draw.
6. **`packages/testing`**: a `publication` factory.

Tests (integration against Postgres unless stated):

- `normaliseDoi`: table-driven unit test (each prefix, case, whitespace, a URL with a fragment, a non-DOI, 257 characters).
- Add: allowed for a provider member, a manager and Admin; **denied** for a signed-in non-member (403) and anonymous (401); a duplicate is 409; a bad DOI is 422; an unknown service is 404, never 500; a resolver failure keeps the row with `failed` metadata.
- Remove: by id; a publication id of another service is 404 and removes nothing; **denied** for a non-member.
- **Rollback:** a failing audit write leaves no publication row (the multi-row write rule).
- List: sorted by `issued` descending then id, unknown dates last, 5 per page, the envelope with 0-based pages.

Done when: `pnpm check`, `pnpm test --filter @scorpion/bibliometrics --filter @scorpion/integrations`, the full unit suite and `pnpm test:contract` pass; the README lists what the manifest cannot say; the changeset is `minor` (the API exists, though no page uses it yet).

## 7. Sprint 2: citations

**Goal:** citation counts are fetched weekly and on request, and stored as history.

Work items:

1. **`packages/integrations/src/openalex.ts`**: `createOpenAlex({ fetch, apiKey?, mailto?, timeoutMs })` with `citedByCount(dois, { signal })` (at most 100 per call, splitting larger input), the OR filter, `select=doi,cited_by_count`, backoff on 429 honouring `Retry-After` (at most three attempts), DOIs in the answer matched back after normalisation (OpenAlex returns `https://doi.org/...`), and a stub. Unit tests with recorded answers, a 429 then 200 sequence, and a batch of 250 split into three calls.
2. **The registry `biblio.citationSource`** (declared by the module; entry `{ id, label, enabled(settings), fetchCounts }`), with OpenAlex as the one built-in entry. A test registers a second, fake source and proves the refresh asks both and stores snapshots per source, with no change to the module's code.
3. **`biblio_citation_run`, `biblio_citation_snapshot`** and their migration.
4. **`service/citations.ts`**: `refresh(trigger, serviceIds?)` as in §4; the weekly job `bibliometrics.citations.refresh` with slices; the retry of `failed` metadata in the same job.
5. **`POST /services/:serviceId/citations/refresh`** with the `strict` rate limit and the 10-minute rule, and **`GET .../history`**.
6. **The event** `bibliometrics.citations.updated@1` with a strict schema and a test that the payload carries no DOI, title or URL.
7. The list of sprint 1 gains `citedByCount`, `citationsAsOf` and the service total.
8. **`demoSeed`** gains two citation snapshots per demo publication, still with no network call.

Tests:

- A run stores one snapshot per found DOI and per source; a DOI that two services share is asked once.
- A DOI that the source does not know has `citedByCount: null`, and the total says `found 2 of 3`; a failed batch stores nothing for its DOIs and the run records `failed`. **No zero is written for an unknown.**
- Rollback: a failure while writing a batch's snapshots leaves none of that batch.
- "Check now": allowed for a member, **denied** for a non-member, a 429 with `Retry-After` within 10 minutes.
- The job: two slices for a fixture larger than the slice, idempotent on a second run (the history read shows one point per day).
- The key never appears in logs (a test reads the captured log lines after a run with a key set).

Done when: as sprint 1, plus the job is visible on the admin job page with its last run and "run now". Changeset `minor`.

## 8. Sprint 3: the page, the KPI and the release

**Goal:** the publications show on the service page; an administrator can let the weekly refresh feed a Bibliographic KPI; `0.19.0` is released.

Work items:

1. **The section** `publications` of the service page (`modules/bibliometrics/ui/ServicePublications.svelte`, exported through `wizardExtensions.sections`): the list (title linked to `https://doi.org/<doi>`, authors shortened to "first author et al." above three, the date at its precision, the container, the citation count with its date or "not found in OpenAlex"), pages of 5, the total with "n of m found", "Add publication" (a DOI field with the 409 and 422 shown at the field), "Remove" with a confirmation, "Check citations now" with the refused state, and a small citation history per publication through the `ui-kit` chart adapter. The controls that write show only to holders of the scoped write. Calls only through the generated typed client. English and German messages. Keyboard- and screen-reader-tested, axe-clean in both themes.
2. **`apps/web/src/kpi-service-parts.test.ts`**: the assertion "only kpi-framework has `wizardExtensions`" becomes "kpi-framework and bibliometrics, each with its own section", and the order of the sections is tested.
3. **The settings page** at `/admin/settings/bibliometrics` through the settings form (SchemaForm), with `kpi.indicatorId` as an indicator picker filtered to numeric indicators in the category `Bibliographic`. A save that names another indicator is a 422.
4. **`kpi.ingestion.upsertBatchAsSystem`** as in §4, with its README line and tests in `kpi.ingestion` (upsert, not insert: two runs in a month leave one row with the second value; the effective-set check; the event).
5. **The KPI write** in the refresh, with a report line per run (`kpiWritten`, `kpiSkippedNotInSet`, `kpiSkippedIncomplete`).
6. ~~**`service.profileContributor`** `bibliometrics.citation`~~: not in M16 (decision 7: backlog, since publications are not public).
7. **E2E** (`apps/web/e2e/bibliometrics.spec.ts`) with the stub adapters (the server runs them under `NODE_ENV=test`): add, duplicate, remove, check now, a non-member sees no controls, the section under a two-segment `BASE_PATH` (defect 11's lesson), and the API call count of the service page with the section (`[biblio-calls]` lines in the report). A journey spec if the first-hour decision says so.
8. **Documents:** the module README (what the manifest cannot say: turning the KPI on, what the OpenAlex key changes, what "not found" means, the 10-minute rule); `implementation.md` M16 marked done; the backlog entries of §10; `pnpm scorpion docs:export` checked for the new permissions, settings, job, event and registry.
9. **Release `0.19.0`** following CONTRIBUTING.md "Releases" and the release ASVS gate (stale chapters block `release/*`; the maintainer bumps `assessed_commit`). Every outward step waits for the maintainer.

Tests also include: the KPI is written for a service with the indicator in its set and all publications found; skipped (and counted) when one publication is unknown, when the indicator is not in the set, and when the setting is empty; a second run in the same month replaces the value (defect 6). Changeset `minor`.

## 9. Risks

| Risk                                                                                 | Effect                                         | Mitigation                                                                                                                                  |
| ------------------------------------------------------------------------------------ | ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| OpenAlex changes its access rules (a key becomes required, lower free limits)        | The weekly refresh fails or stops early        | The day-one check (§1.4); the run records `failed` without writing zeros; the key setting; the registry makes a second source cheap to add  |
| A registration agency does not answer CSL-JSON for some DOIs (DataCite types, mEDRA) | A publication has no title                     | Stored as `failed` or `not-found` and shown as "title not yet known" with the DOI; retried weekly; fixtures per agency in the adapter tests |
| OpenAlex does not index software or dataset DOIs (Zenodo)                            | Counts missing for the DOIs services cite most | "Not found" is shown, never zero; the KPI write is skipped for the service (decision 5), so the time series is not distorted                |
| A redirect from doi.org points somewhere unexpected                                  | The server fetches from an arbitrary host      | `https:` only, at most five redirects, a body size cap, a shape check; the DOI pattern is checked before the first request                  |
| "Check now" spends the daily budget                                                  | The weekly run fails                           | `strict` rate limit plus the 10-minute rule per service                                                                                     |
| The trusted write is misused later                                                   | Writes without a permission check              | Not routed, documented as trusted, used by one caller; a test in `bibliometrics` checks that only the job path calls it                     |

## 10. Out of scope (goes to `docs/backlog.md`)

- Crossref, Europe PMC and Dimensions as citation sources (FEATURES §6; one registry entry each).
- A public v1 route `GET /api/v1/publications?service=` (additive, when a client asks for it).
- Backfilling earlier months of the KPI from OpenAlex `counts_by_year` (yearly only, so it needs a rule for spreading a year over months).
- Importing publications in bulk (a list of DOIs, a BibTeX or ORCID import).
- Publications on the public catalogue page (decision 3), and with them the Schema.org `citation` of the public profile through `service.profileContributor` (decision 7).
- Showing which papers cite a publication (OpenAlex `cites:` queries).
- A per-instance citation summary page (all services ranked by citations).

## 11. Decisions

**Answer (maintainer, 2026-11-25): every recommendation accepted.** Decision 7 therefore goes to the backlog, because decision 3 keeps publications signed-in only.

1. **Table prefix.** `biblio_` (set in the manifest) or the default `bibliometrics_`? _Recommended:_ `biblio_`, matching the registry name `biblio.citationSource` and the precedents `svc_` and `kpii_`.
2. **Who may add and remove a publication.** A new scoped `bibliometrics.publication.write` granted to provider members through a resource policy, or reuse `registry.services.service.edit`? _Recommended:_ the new scoped permission. It keeps the modules independent and lets an instance give publication upkeep to a role without giving full service editing.
3. **Who sees publications.** Signed-in users only, or also the public catalogue page (`/catalog/services/:slug`)? _Recommended:_ signed-in in M16, public catalogue in the backlog. The catalogue has its own public route set, and adding to it brings rate limiting and caching questions that M16 does not need.
4. **Which indicator the KPI write targets.** A setting naming one indicator by id (numeric, category `Bibliographic`), or a new built-in indicator created by the module? _Recommended:_ the setting, empty by default. Indicators are data that an administrator owns (rule 8), and an instance may already have a "citations" KPI.
5. **The KPI when some publications are not found.** Write the partial total, or skip the service for that month? _Recommended:_ skip and count it in the run's report. A partial total would show as a drop in the trend widgets, which is the misleading zero in another form.
6. **When to resolve DOI metadata.** In the request that adds the publication (short timeout, fallback to the job), or only in the background? _Recommended:_ in the request. FEATURES §3.12 expects the title to show at once, and the fallback keeps a slow resolver from failing the add.
7. **Schema.org `citation` in the public profile.** Contribute it through `service.profileContributor`? _Recommended:_ yes, if decision 3 makes publications public; otherwise backlog, since the profile is public and must not show what the page hides.
8. **A public v1 route.** _Recommended:_ none in M16. The legacy v1 had none, and an additive route can follow when a client asks for it.
