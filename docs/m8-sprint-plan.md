# M8 Sprint Plan: `public-api` v1 read and the documentation

Status: **draft for the maintainer**, 2026-10-13. Nothing here is decided; the open questions are in §13 and each carries a recommendation. Decisions the plan takes itself are marked "proposed".
Scope source: [implementation.md](implementation.md) §4, M8, [architecture.md](architecture.md) (the `public-api` row of the module table, the API surfaces table, "One route definition"), FEATURES §3.16 and defect 15 ([FEATURES.md](FEATURES.md) §5).

M8 is size M in `implementation.md`. This plan has **three sprints (about three weeks for one developer)**, because M8 is the first milestone since M4b that changes an ASVS-scoped path (`apps/server/src/pipeline/**`, for the CORS allow-list) and the first that makes a public contract that CI guards for breaking changes. Gate 2 follows it.

## 0. Before sprint 1

State on 2026-10-13 (checked against `dev` at the end of M7, `0.9.0` being released):

1. **`dev` carries `0.9.0`** once the release of M7 is merged back. Pull first.
2. **What exists to build on** (checked in the source, not assumed):
   - `RouteRegistrar.public('v1', route, handler)` in the kernel, `SURFACE_PREFIX.v1 = '/api/v1'` in `packages/contracts/src/route.ts`, and the audit hook that already tags a `v1` route with `surface: 'v1'` (`apps/server/src/app.ts`). No module registers a v1 route yet.
   - `apps/server/src/openapi-generate.ts` collects the v1 routes of the generated profile into `apps/web/src/generated/openapi-v1.json`, and `/docs` (a public page of `core.ui-shell`, `ui/docs.ts`, `Docs.svelte`) already renders that document through the load context's `publicApi`. **Sprint 1 starts by reading what `/docs` really draws today** (its own renderer, or a library) and writes it down; the plan below assumes an own renderer and no Swagger UI dependency (Decision 4).
   - Authentication of programs: personal access tokens with scopes (`core.identity`), accepted as `Authorization: Bearer` and `X-API-Key` by `pipeline/authenticate.ts`; the rate limit keys on the address **and**, for a token or key, on its hash (`pipeline/rate-limit.ts`). So the per-token limit exists; M8 proves it for v1 and does not change a limit.
   - `core.audit` has `channels.api` and `apiRetentionDays`, and no writer yet ([backlog.md](backlog.md), audit follow-ups): the first v1 route with `audit: true` is the first writer.
   - Trusted reads for M8 were planned in M7 and exist: the catalogue query function and `findByIdsAsSystem`-style reads in `registry.services`; `registry.organisations` has `public.ts` reads and `isApprovedMemberAsSystem`, `listApprovedOrganisationIdsAsSystem`. Their v1 shape is not built.
   - The public records of M7 (`/public/services`, `/public/organisations`) are **not** v1: they answer without a token and only for what a Reviewer made public. v1 answers a token holder with the permission, for everything that holder may read. The two stay separate (Decision 2).
3. **Lessons of M7 that this plan applies from the first sprint:**
   - `docs/security/**` maps to all four ASVS chapters; a pull request that changes it updates the matching chapter YAML and carries `asvs-no-impact` with a true reason line for the chapters it does not touch. **M8 changes `apps/server/src/pipeline/**` (sprint 1), so V7 and V8 get entries, and a test tagged for each.**
   - The release runs `pnpm security:asvs --release`, which fails a stale chapter; the maintainer bumps `assessed_commit` before the release branch is cut. The second pass is the maintainer's.
   - A load the shell repeats on every navigation costs API calls ([backlog.md](backlog.md), "Too many 429s"): the docs page must not add calls to a page that already makes four.
   - Unique names and ids in tests (specs share a database); no regex built from a variable in a test (CodeQL).
4. **Prototype in the first days of sprint 1** (stop and say so if it fails): one throwaway v1 route (`GET /api/v1/ping`, a permission, `audit: true`) registered by a fixture module and called through the real pipeline with a token and with `X-API-Key`, from an allowed origin and a disallowed one, with a preflight. It must show: 401 without credentials, 403 for a token whose scopes lack the permission, 429 with `Retry-After` per token, the CORS headers only for an allow-listed origin and never `*` together with credentials, an `api`-channel audit entry for every call (the denied ones included), and a spec at `/api/v1/openapi.json` that lists the route.

## 1. What earlier milestones hand to M8

| Hand-off                                                                                                                                                                      | Where it was recorded                           | Sprint                                                        |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- | ------------------------------------------------------------- |
| v1 `services` with `consortia` filled (defect 15), through the catalogue query function and the trusted reads; M7 built no v1 route                                           | m7-sprint-plan §1, §12, implementation.md M7    | 2                                                             |
| v1 `providers` with `is_member=true\|false` both correct (defect 15), over `registry.organisations`                                                                           | FEATURES §3.16, defect 15                       | 2                                                             |
| The same Schema.org representation of a service in v1, additive                                                                                                               | backlog (services sprint 7), m7-sprint-plan §12 | 2 (if wanted, Decision 3)                                     |
| The first writer of the `api` audit channel; a v1 route sets `audit: true`                                                                                                    | backlog (audit follow-ups)                      | 1                                                             |
| A public label for the stage (the vocabulary's label as a public read), which touches the pinned public record                                                                | backlog (services sprint 6)                     | not M8; stays in the backlog unless Decision 3 says otherwise |
| The measured API calls per page and the cheapest remedies (layout calls, `account/permissions`); a change of limits is its own pull request with V7 and V8 entries            | backlog ("Too many 429s")                       | 1, if Decision 5 says so                                      |
| Categories and indicators in v1 are **added in M9** by `kpi.framework` through the same registrar; M8 builds the mount and the contract tests they will use, and no KPI route | implementation.md M8, M9                        | 1                                                             |
| Measurements (`GET` and `POST /api/v1/measurements`, defect 6 and the legacy `data` key) are M10; M8 leaves them out                                                          | implementation.md M10                           | none                                                          |

## 2. Cross-sprint rules

- Stay inside M8. Anything else goes to `docs/backlog.md` (§8).
- **One pull request per sprint** (CLAUDE.md). ADRs, READMEs, backlog lines, the regenerated OpenAPI documents and review fixes go into the sprint's pull request; push when the sprint is complete and verified (`pnpm check`, the tests of every package touched, the full `pnpm test`, a full `CI=true pnpm test:e2e`, `pnpm security:asvs`, `profile:generate full --check`, `openapi:generate --check`).
- **A v1 route is declared once** with `createRoute()` in the module that owns the data and registered with `r.public('v1', …)`; it has a `permission` (a v1 route is never `public: true`: an anonymous read of v1 is not planned, Decision 2), a stable sort (key, then id), the legacy envelope `{ metadata: { currentPage, pageSize, totalCount, totalPages }, result: [...] }` with 0-based pages, and `audit: true`.
- **v1 changes are additive.** The spec of a released version is the contract; a field is never removed or renamed, a required request field is never added. The sprint-3 diff job enforces it; a breaking change goes to v2 with an ADR.
- **The service layer is the only way to read and change data.** A v1 handler calls one service method, as an internal handler does; `public-api` holds no query. A module's v1 read never returns what the module's internal read hides (the contact point of a service, the members of an organisation): the field tables of `docs/security/authorization.md` get a v1 column or section, and `response-fields.test.ts` walks the v1 schemas too.
- **Every list says how it sorts and pages** in its description, and the contract test proves an endpoint with `pageSize` larger than the total, a last page, an empty page and a stable order across pages (defect 15).
- **Input is Zod with size limits;** an unknown reference or a bad filter is 422 problem+json, never 500 (defect 14 applies to v1 as well).
- **No hard-coded branding.** The server URL in the spec and in `/docs` is the origin of the request plus the base path; the title and contact of the spec come from settings.
- **Scoped paths.** M8 changes `apps/server/src/pipeline/**` (the CORS step, sprint 1) and adds or changes `docs/security/**` (the v1 field tables, the route table). Each sprint says which chapter files it updates. It plans **no** change in `modules/core-identity/**`, `modules/core-authz/**` or `packages/contracts/src/route.ts`; if a prototype shows that one is needed, the plan stops and asks.
- Update a module's README with every manifest change. No new runtime dependency is expected (Decision 4); a development dependency for the spec diff (Decision 6) is named in the pull request description.
- Every pull request carries a changeset (package `scorpion`); sprints 1 and 2 are `minor` (an API users can call), sprint 3 `minor` or `patch`; the release turns them into the next version.

## 3. Sprint overview

| Sprint | Branch                        | Theme                                                                                                                                                          | Closes    |
| ------ | ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| 1      | `feature/m8-public-api-core`  | The `public-api` module: the runtime spec at `/api/v1/openapi.json`, the CORS allow-list, the audit writer, per-token limits proved, the contract-test harness | none      |
| 2      | `feature/m8-public-api-reads` | `GET /api/v1/providers` and `GET /api/v1/services` in the owning modules, the v1 field tables, contract tests                                                  | defect 15 |
| 3      | `feature/m8-public-api-docs`  | `/docs` (themed, current origin), the spec diff against the last release tag in CI, the token-to-call journey, Gate 2 evidence, the release                    | none      |

Module graph after M8: `public-api` depends on `core.settings` (the CORS list, the spec's title and contact) and has `core.ui-shell` and `core.audit` as optional peers; it imports no module for its data. `registry.organisations` and `registry.services` register their own v1 routes (no new dependency between modules). The `registry` profile and `full` gain `public-api`; `core-only` does not need it.

## 4. Sprint 1: the module, the spec, CORS and audit

**Goal:** the shell of the public API works with no data route: a token holder can call a (fixture) v1 route, a browser from an allowed origin can too, every call is audited, and the spec says what is there.

Work items

1. **Prototype** (§0 item 4) first; the answers go into ADR-0037.
2. **ADR-0037 (the public API):** one module, how the v1 routes are collected (the registrar already does it), the runtime spec, the CORS rule, the `api` audit channel, the permission model of a token (a v1 route's permission must be one the token's scopes name and its owner holds, ADR-0015), and the compatibility rule (additive only; the spec diff).
3. **The module** `modules/public-api` (`module.ts`, `public.ts`, README): serves `GET /api/v1/openapi.json` built at runtime from the v1 routes of the loaded modules (the same generator as `openapi-generate.ts`, so the committed document and the runtime one cannot differ; a test compares them for the full profile). The server URL is the request's origin plus the base path.
4. **CORS allow-list** (the pipeline step, ASVS-scoped): origins from a `core.settings` value of `public-api` (empty by default: same origin only). Only `/api/v1/*` answers a preflight; an origin not in the list gets no CORS header (the request itself is judged by the token as usual); `Access-Control-Allow-Origin` is the origin itself, never `*`, and never `Allow-Credentials` (a v1 call carries a token, not a cookie; a cookie session on `/api/v1` stays refused if it is today). A change to the list takes effect without a restart.
5. **The audit writer:** a v1 call (allowed, denied or rate limited) is one `api`-channel entry with the route template, status and the token's id (never the token), with the retention that exists. The first v1 route with `audit: true` proves the backlog item on `surface`.
6. **Per-token and per-address limits proved for v1** with a test, without changing a limit: a token is limited by its own bucket, so two tokens from one address do not share one and one token from two addresses does not escape (`pipeline/rate-limit.ts` already keys both; the test makes the claim on the v1 surface).
7. **The contract-test harness** in `packages/testing`: given a v1 route, call it with a factory token and validate the response (status, body, headers, the envelope, the sort) against the route's own schema from the spec; a route without a contract test fails a walker (as `response-fields.test.ts` does for the internal API). Categories and indicators of M9 plug into it.
8. **Settings and messages:** the `public-api` settings (the allow-list, the spec's title and contact), their schema, README and the settings page text (en and de).

Tests: the module's integration tests against real Postgres (the settings value, the runtime spec equals the generated one), the pipeline tests for CORS (allowed, disallowed, preflight, no `*`, no credentials, a changed list), the audit entries (a denied call included), the per-token limit, the harness's own tests.

ASVS: V7 and V8 chapter files updated (CORS and the per-token limit as evidence, tagged tests); the other two chapters carry the `asvs-no-impact` line with a true reason. **If an existing requirement stops being true because of the CORS step, the entry says `fail` with the sprint-plan link, not `pass`.**

Definition of done: a fixture token calls a fixture v1 route from an allowed origin and is audited; `/api/v1/openapi.json` lists it; every check of §2 is green.

## 5. Sprint 2: providers and services

**Goal:** the two v1 reads of the legacy API, with the three defects of defect 15 fixed.

Work items

1. **`GET /api/v1/providers`** in `registry.organisations`: all providers or, with `is_member=true`, those the token's owner is an approved member of, and, with `is_member=false`, **the others** (both correct, tested against a brute-force count of generated data). Permission `registry.organisations.v1.read` (or the existing read permission, Decision 1). A parameter that is not a boolean is 422. The envelope, 0-based pages, sort by abbreviation then id, `totalCount` over the filtered set.
2. **`GET /api/v1/services`** in `registry.services`: filters `service` (abbreviations) and `provider` (abbreviations) as in the legacy API, plus the catalogue's own filters where they are cheap (stage, licence); **`consortia` filled** (the case that was always empty), one row per service whatever its number of consortia, a service with none shows `[]`; sort by abbreviation (slug), then id. It calls the catalogue query function; no new query.
3. **What a row carries** is pinned in the plan before code (a table in the sprint's pull request): the legacy fields (abbreviation, name, the provider, the consortia, the stage by its term key) and nothing the internal read hides; **the contact point never**; a service that is not public is returned to a holder who may read it internally, with its `public` flag. The field tables of `docs/security/authorization.md` get the v1 rows; the walker covers them.
4. **A `GET /api/v1/services/{id}` and the Schema.org profile in v1** only if Decision 3 says yes (otherwise the backlog line stays).
5. **Contract tests** for every route with the harness of sprint 1: the envelope, the stable order across pages, empty and last page, a bad filter (422), an unknown provider abbreviation (an empty list or 422, decided in the ADR addendum and tested), a token without the scope (403), no token (401), the `X-API-Key` alias.
6. **Regression tests for defect 15:** `defect-15.v1-reads.test.ts` (`is_member=false`, `consortia`, and the `totalCount` that counts the filtered set), never weakened.
7. **Docs of the routes:** each v1 route has a summary, a description of its sort and paging, and an example; the generated spec is regenerated and committed (`pnpm openapi:generate`); the module READMEs list the routes.

Tests: integration tests per service method (a denied case, the `is_member` matrix, a service with zero, one and two consortia), contract tests, the field-table walker, the regression test.

ASVS: V8 gets the v1 permission entries; V7 only if a token rule changes (it should not).

Definition of done: a token with the two scopes lists providers and services in the legacy shape with the three defects gone; the committed spec is the first version of the contract.

## 6. Sprint 3: the documentation, the compatibility gate, the journey and Gate 2

**Goal:** a person finds the API, gets a token and makes a call from the documentation; CI protects what was published; Gate 2 can be judged.

Work items

1. **`/docs`**: themed (both themes), the server URL set to the current origin plus the base path, the token explained in words (how to make one on the profile page and what scope a route needs, taken from the spec's `security` and permission descriptions), and a **try-it-out** that sends the call with a token the person pastes (kept in memory only, never stored, never logged). Decision 4 says whether this is Swagger UI or the existing renderer extended; the page stays a public page and makes no extra API call on load beyond the spec.
2. **The spec diff in CI:** `pnpm openapi:diff` compares `apps/web/src/generated/openapi-v1.json` with the one of the **last release tag** (`git show v<last>:…`) and fails a breaking change (a removed path or method, a removed or renamed field, a narrowed type, a new required request field, a removed enum value); an additive change prints a summary into the job. If no tag has a v1 document yet (the first release with M8), the job passes and says so. Decision 6 chooses a tool or a small script.
3. **The journey (Playwright, both base paths):** a person signs in, makes a token with the right scope on the profile page, opens `/docs`, and a call made with that token (the page's try-it-out and a plain request) returns the legacy envelope; the same call with a token that lacks the scope is 403; the CORS answer for an allowed and a disallowed origin; the page is axe-clean in both themes.
4. **Gate 2 evidence** ([implementation.md](implementation.md) Gate 2): the registry profile image builds and starts (the existing `Image (registry)` job), the v1 contract tests pass, and the journeys of M6 and M7 pass. The statement that the profile **runs on staging with real organisation and service data from a partial migration dry run** needs the tool of M13 and the maintainer's staging: the plan lists it as the maintainer's check (Decision 7), not a task of this sprint.
5. **Backlog close-out** and the measured request counts: v1 calls are token calls, not session calls, so they do not count against the browser's address bucket on a shared address; say so in "Too many 429s" with a measurement of one v1 call.
6. **Release** as in CONTRIBUTING.md "Releases" (the flow of M6 and M7): ask the maintainer about `assessed_commit` first, the release branch from `dev`, `pnpm changeset version` must announce the version the maintainer expects (0.10.0 if the M7 changesets are all released; stop and ask otherwise), the annotated tag on the merge commit, the three images, the merge-back on a `feature/…` branch.

Tests: the diff script's own table-driven tests (a removed field, a narrowed type, a new required field, an additive change, no previous tag), the journey, the axe checks, the docs page's component tests.

ASVS: V7 and V8 if the try-it-out or the page handles a token (it must not store or log one: a test that the token never reaches a request log or `localStorage`).

Definition of done: `pnpm check`, the full `pnpm test`, `CI=true pnpm test:e2e` and `pnpm security:asvs` green on `dev` after the merge; the release is tagged and its images are in ghcr; `main` is merged back; the backlog says what is true.

## 7. Acceptance (from implementation.md) mapped to tests

| Acceptance criterion                                                                                           | Where it is proved                                                                                                 |
| -------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `public-api` mounts the v1 routes of the active modules and aggregates `/api/v1/openapi.json` at runtime       | the runtime-spec test (equals the generated spec), a profile without a module lacks its routes                     |
| Swagger UI / documentation at `/docs`, public, themed, with the server URL set to the current origin           | the docs page tests, the journey, axe in both themes, both base paths                                              |
| `Authorization: Bearer` and `X-API-Key` (alias)                                                                | contract tests of each route, `defect-03` stays green                                                              |
| Per-token and per-IP rate limits                                                                               | the v1 rate-limit test of sprint 1                                                                                 |
| CORS allow-list from settings                                                                                  | the pipeline CORS tests, the journey                                                                               |
| Audit on every call                                                                                            | the `api`-channel tests (allowed, denied, limited)                                                                 |
| v1 providers (`is_member=true\|false` both correct) and services (with `consortia`), envelope, stable order    | `defect-15.v1-reads.test.ts`, the contract tests                                                                   |
| Contract-test harness: every v1 route is tested against its schema                                             | the walker that fails a v1 route without a contract test                                                           |
| CI diffs the spec against the last release tag                                                                 | the `openapi:diff` job and its tests                                                                               |
| Gate 2: the registry profile deployable; catalogue, wizard and edit flows pass E2E; the v1 contract tests pass | the `Image (registry)` job, the journeys of M6 and M7, the contract tests; the staging dry run is the maintainer's |

## 8. Out of scope (goes to `docs/backlog.md` if not there)

- Categories and indicators (M9), measurements `GET` and `POST` (M10, defect 6 and the `data` key), KPI analytics (M11).
- A v2 of any route; a write route in v1 other than M10's measurements; a public (anonymous) v1 read (the M7 public records serve that need); webhooks; per-client quotas beyond the two groups.
- Changing the limits or the rate-limit keys (a separate pull request with V7 and V8 entries and a test that login, register and token use stay limited).
- Generated client libraries for v1 consumers; an SDK.
- Signed images, provenance and an SBOM (M18).

## 9. Additions to M8's scope in `implementation.md` (to approve with this plan)

- The module `public-api` with its settings (the CORS allow-list, the spec's title and contact) and the permission model of a token on v1 (scopes and owner), ADR-0037.
- The `api` audit channel gets its first writer.
- `GET /api/v1/providers` and `GET /api/v1/services` are registered by their owning modules; `public-api` collects and serves, and holds no data.
- The contract-test harness and the walker for v1 routes; the spec diff in CI against the last release tag.
- A v1 section in the field tables of `docs/security/authorization.md`.

## 10. Decisions to take (open questions)

1. **Which permission does a v1 read need?** _Recommendation:_ one permission per route family (`registry.organisations.v1.read`, `registry.services.v1.read`), granted to the role `user` by default, so a token's scope can name exactly what it reads and an administrator can withdraw the API without touching the screens. The alternative reuses `…organisation.read` and `…service.read`, which gives a token everything the screen reads and no way to scope it.
2. **Is any v1 read anonymous?** _Recommendation:_ no. v1 always needs a token; the anonymous reads are the M7 public records. This keeps the audit and the per-token limit meaningful.
3. **Do v1 services carry the Schema.org profile and the public flag?** _Recommendation:_ the flag yes (a client must know what is public), the Schema.org profile as a separate `GET /api/v1/services/{id}/schema-org` in sprint 2 only if the maintainer wants it for M8; otherwise it stays in the backlog. The row never carries the contact point.
4. **Swagger UI or the existing `/docs` renderer?** _Recommendation:_ extend the renderer that exists (a try-it-out is a small form) and add no dependency; Swagger UI is a large dependency that wants CSP relaxations the shell does not have. If the maintainer prefers Swagger UI, the pull request names the dependency, pins it, and the CSP and the Scorecard consequences are checked first.
5. **Is the change of the rate limits part of M8?** _Recommendation:_ no; M8 only proves per-token limits for v1. The layout's repeated calls (the measured cause of the 429s) are cheaper to fix in the web shell and need no pipeline change; schedule that between M8 and M9 as its own pull request.
6. **How is the spec diff done?** _Recommendation:_ a development dependency such as `oasdiff` (a binary, run in CI from a pinned container or release asset) is the most complete; a small script of our own (paths, methods, required request fields, response fields, enums) is enough for a spec of this size and adds nothing to supply chain. Start with the script, record the gaps in the backlog, and revisit when v1 grows in M9 to M11.
7. **The staging dry run of Gate 2.** The maintainer runs it (or says it is deferred to Gate 3, where M13 exists); the plan does not block the release on it.
8. **Version after M7.** If `0.9.0` is tagged, the M8 release is `0.10.0`. Confirm.

## 11. Risks

| Risk                                                                    | Consequence                                           | Mitigation                                                                                                                    |
| ----------------------------------------------------------------------- | ----------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| The CORS step opens a cookie-authenticated route to another origin      | A CSRF-like exposure on `/api/internal`               | The step applies to `/api/v1` only, never sends `Allow-Credentials`, and a test proves `/api/internal` answers no CORS header |
| The spec grows by accident (an internal route leaks into v1)            | A public contract nobody chose                        | v1 comes only from `r.public('v1')`; a test lists the v1 paths of the full profile and fails on an unexpected one             |
| A row of v1 carries a field the internal read hides (the contact point) | A leak through the one surface that is easy to script | The v1 field tables, the walker, and a test that no v1 schema has the contact fields                                          |
| The first spec becomes the contract before it is right                  | A breaking change needs v2                            | The diff job passes on the first release; sprint 2 pins the row shape in a table first, and the maintainer reviews it         |
| Audit on every call grows the audit table fast on a busy token          | Retention and storage                                 | `apiRetentionDays` exists; sprint 1 measures the size per 1000 calls and writes it in the backlog                             |
| M8 touches `pipeline/**`, so V7 and V8 go stale at the release          | `pnpm security:asvs --release` fails                  | The sprint's pull request updates the chapter files; the maintainer re-assesses before the release branch                     |
| E2E time grows again with the journey and the axe checks                | A slower CI                                           | One journey for the token-to-call path; reuse the stack and the helpers of M7; no new project                                 |
