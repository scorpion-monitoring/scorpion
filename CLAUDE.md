# CLAUDE.md

Guidance for Claude (and other coding agents) working in the Scorpion rebuild repository.

## What this project is

Scorpion is a service registry and KPI tracker for research infrastructures (de.NBI, NFDI). This repository is a **greenfield rebuild** as a **modular monolith**: one server, one PostgreSQL database, many modules. Deployment **profiles** choose modules at **build time**. Adding or removing a plugin means rebuilding that profile's image and restarting; there is no runtime plugin loading.

Source documents, which win over anything here if they conflict:

- `docs/FEATURES.md`: requirements baseline and the list of known defects (§5) that must **not** be ported.
- `docs/architecture.md`: the approved architecture.
- `docs/implementation.md`: milestone plan (M0–M18) and the definition of done.
- `docs/adr/`: architecture decision records. Add one for any decision that changes the architecture.

Before starting a task, find the milestone it belongs to in `implementation.md` and stay inside its scope.

## Stack

Node 24 LTS (move to 26 in M18), TypeScript (strict), pnpm workspaces · Hono + `@hono/zod-openapi` · Zod · PostgreSQL 16 + Drizzle · pg-boss · `arctic` (OIDC), `@node-rs/argon2` · SvelteKit 5 (adapter-node), Tailwind + DaisyUI · ECharts (behind the chart adapter) · Cytoscape · Nodemailer · DOMPurify, `sharp` · pino, OpenTelemetry · Vitest, Testcontainers, Playwright.

Do not add a new runtime dependency without saying why in the PR description. Never add Redis or another stateful service: Postgres is the only required one.

## Repository layout

```text
apps/server        Hono app, kernel bootstrap, request pipeline, CLI (`scorpion`), worker
apps/web           SvelteKit shell; module UIs are mounted through the ui.routes registry
packages/kernel    defineModule, loader, DI context, event bus + outbox, jobs facade
packages/contracts createRoute helper, envelope/problem schemas, generated API client
packages/ui-kit    SchemaForm, DataTable, Wizard, Facets, chart adapter
packages/integrations  SPDX, DOI, OpenAlex adapters (cache, timeout, stub)
packages/testing   Testcontainers setup, factories, contract-test helpers
modules/<id>/      one package per module (core-*, registry-*, kpi-*, maturity, ...)
profiles/*.ts      full, denbi-registry, nfdi-onboarding, kpi-tracker
tools/migrate-legacy  one-time import from the old Scorpion database
.changeset/        pending changesets; CHANGELOG.md is generated from them
```

## Commands

```bash
pnpm i                         # install
pnpm dev                       # docker compose (Postgres, Mailpit) + server + web, PROFILE=full
PROFILE=kpi-tracker pnpm dev   # run another profile
pnpm check                     # lint + type check (incl. module boundary rule)
pnpm test                      # unit + integration (needs Docker for Testcontainers)
pnpm test --filter @scorpion/kpi-ingestion   # one module
pnpm test:contract             # public API against OpenAPI
pnpm test:e2e                  # Playwright
pnpm db:generate --filter @scorpion/<package>  # new Drizzle migration for a module (from db/schema.ts)
pnpm scorpion profile:generate <name>   # write apps/server/src/generated/profile.ts (build time)
pnpm scorpion start | worker | migrate   # web server, jobs and events only, migrations only
                               # (seed arrives with the modules that need it)
pnpm scorpion create-admin | set-secret <name> | rotate-secrets   # commands of core.identity and core.settings;
                               # profiles with core.settings need SECRETS_KEY (openssl rand -base64 32)
pnpm modules:sync              # regenerate the module id list that defineProfile() checks against
pnpm build --profile <name>    # build one profile image
pnpm changeset                 # describe your change for CHANGELOG.md (--empty if none is needed)
pnpm changeset version         # at a release only: bump the version, write CHANGELOG.md
```

Run `pnpm check` and the tests of every module you touched before you say a task is finished.

## Module rules (hard rules)

1. **One module = one package** under `modules/`, with `module.ts` (a `defineModule` manifest) and `public.ts` (the only file other modules may import).
2. **Declare dependencies.** Importing another module is allowed only through its `public.ts` and only if it is declared in the module's `package.json` (`dependencies`, or optional `peerDependencies`); the manifest has no `dependsOn`, the loader derives it. The ESLint boundaries rule enforces this; never disable it.
3. **Own your tables.** Table names start with the module's table prefix: its id with underscores (`kpi.ingestion` → `kpi_ingestion_measurement`) unless the manifest sets `tablePrefix`; the loader checks it after migrating (ADR-0004). Never read or write another module's tables; call its public service instead. Foreign keys may point only to core tables or to declared dependencies.
4. **Layers:** `ui/` → `routes/` → `service/` → `db/`. Each layer calls only the one below it. Route handlers are thin: parse, call one service method, map the result.
5. **The service layer is the only way to change data.** UI, internal API, public API, jobs, adapters and the migration tool all go through it. Never write the same logic twice for two entry points.
6. **Transactions:** every write that touches more than one row runs inside `ctx.db.tx()`. Emit domain events through the outbox inside the same transaction.
7. **Extension through registries.** New field types, value types, ingestion adapters, exporters, widgets and transports are registry contributions, not `if` branches in the owning module.
8. **Vocabularies are data.** Stages, thematic categories, necessity levels, sender types and aggregates come from `core.settings` vocabularies. Never add a pg enum or a hard-coded list of these.
9. **No hard-coded branding.** Instance name, product name, sender address, URLs, contact email and legal texts come from settings.
10. **UI routes go through the registry.** Modules never add SvelteKit filesystem routes; they register `ui.routes` entries that the shell's catch-all route renders. Build every link and fetch with the `url()` helper (base path).

## API rules

- Define every route with `createRoute()` from `packages/contracts`. It **must** have `permission` (or `public: true` with a comment explaining why). Routes without one fail at registration, which is intended.
- Validate params, query and body with Zod, with size limits. Invalid input → 422 problem+json. Never let an unknown reference or bad input become a 500.
- Errors are RFC 9457 problem details. Use the domain error classes (`NotFound`, `Conflict`, `Forbidden`, `Invalid`); the error mapper turns them into HTTP responses.
- Public API v1 keeps the legacy envelope `{ metadata: {currentPage, pageSize, totalCount, totalPages}, result: [...] }` with 0-based pages on **every** list endpoint, and a stable sort (key, then id). Internal routes use the same envelope.
- Public v1 changes must be additive. The CI OpenAPI diff fails on breaking changes; if one is needed, it goes to v2 and gets an ADR.
- The UI calls the API only through the generated typed client, never with hand-written `fetch` URLs.

## Security rules

- Check permissions twice: the route's `permission` in the pipeline, and `ctx.authz.require(actor, permission, resource)` in the service for resource-scoped actions (provider membership, own tokens, own settings).
- Nobody may change their own role or approve their own request. Keep the tests that prove this.
- Sessions are opaque ids checked against the database on every request. Do not introduce JWTs for sessions.
- OIDC always uses PKCE, a nonce and full id_token validation. Login states expire and are single-use.
- PATs: prefix lookup, hash per token, expiry, scopes. Never log a token or a secret.
- Secrets go only in the encrypted `secrets` store, never in `settings` JSON, env dumps, logs or API responses.
- Uploaded images go to the blob store: re-encode rasters, sanitise SVG, enforce size limits. Never store data URLs.
- Render Markdown on the server and sanitise it with DOMPurify. No `{@html}` on unsanitised content.
- Public endpoints (onboarding, login, register, token use) are rate-limited.

## Security assurance (ASVS, OpenSSF)

The README shows self-assessed ASVS 5.0 L2 badges for chapters V6, V7, V8 and V10, the OpenSSF Best Practices badge and the OpenSSF Scorecard badge. See `docs/implementation.md` §8 and `docs/security/README.md`. CI enforces the claims: `pnpm security:asvs` runs in the `Lint, type check, test` job after the tests and fails a hand-edited badge or report, a `pass` whose `test:` tag matches no test that passed in that run, an unknown or missing id, a `fail` without an issue link, and a changed pinned source; on `release/*` and `hotfix/*` it also fails a `stale` chapter. The `ASVS impact` workflow fails a pull request that changes a scoped path without the chapter file. These claims must stay true, so:

- **Assessment data** lives in `docs/security/asvs/v*.yaml`, one file per chapter. The `.md` reports and the README badge block are generated by `pnpm security:asvs --write`. Never edit them by hand.
- **Scoped paths:** when you change `modules/core-identity/**`, `modules/core-authz/**`, `apps/server/src/pipeline/**`, `packages/contracts/src/route.ts` or `docs/security/**`, update the matching chapter's `docs/security/asvs/v*.yaml` in the same PR (`tools/asvs-report/scope.ts` maps path to chapter), or add the label `asvs-no-impact` and a line `ASVS impact: none because <reason>` to the PR description. The `ASVS impact` workflow checks both.
- **Tag tests** that prove a requirement with `[ASVS-<chapter>.<section>.<req>]` in the test title, and list the tag as `test:` evidence. Add tags to existing `defect-NN.*` tests when they cover a requirement. A tag edit changes the title only; never the assertions. Run `pnpm test` and `CI=true pnpm test:e2e` before `pnpm security:asvs`, which reads the JUnit reports in `reports/` (without them it lists the tags it could not check).
- **Never mark a requirement `pass` without evidence** that exists and runs. Never mark one `n/a` to make a badge green: `n/a` needs a real reason why the requirement cannot apply. If something doesn't meet a requirement, set `fail` and link the issue, or the section of a sprint plan that schedules the fix (`docs/<plan>.md#<heading>`; the tool checks it exists).
- **Leave the human fields to humans:** `assessor`, `second_pass`, `reviewer`, `assessment_type` and `assessed_commit`. An AI-assisted review may feed the second pass, but never record it as a `peer` or `external` review.
- **Don't lower the Scorecard score.** In workflows: pin actions by full SHA, keep `permissions: contents: read` at the top and widen per job only, never check out PR code under `pull_request_target`, never put `${{ github.event.* }}` input straight into `run:`. Pin new Docker base images by digest. Don't commit binaries.
- Run `pnpm security:asvs` (`--write` to regenerate the reports and the badge block) before saying a security-related task is finished.

## Testing rules

- Every service method has an integration test against real Postgres (Testcontainers), including a denied-permission case and a rollback case for multi-row writes.
- Pure calculations (change %, MAPE, aggregates, month-end normalisation, duration parsing, value-type validation) get table-driven unit tests.
- Every public route has a contract test against its OpenAPI schema.
- Each defect in FEATURES §5 has a regression test named `defect-NN.<topic>.test.ts`. Never delete or weaken one.
- Main user journeys per profile are covered by Playwright E2E tests.
- Use the factories in `packages/testing`; don't hand-write fixture SQL.

## Things not to port from the old app

These are FEATURES §5; each has a regression test. Do not bring these patterns back:

- Unprotected internal endpoints; the navigation showing Administration to everyone.
- The hand-written `service_view` (read models are tested query functions or refreshed materialised views).
- JWT sessions that ignore the session table; OIDC without PKCE/nonce; secrets copied into auth codes.
- Insert-only measurement submission (always `upsertBatch()` with the unique `(service, indicator, period)`).
- Unscoped deletes by name (always delete by id, scoped to the parent).
- Loaders that *return* error responses instead of throwing.
- Path parsing that assumes a one-segment `BASE_PATH`.

## Working style

- Keep changes inside the current milestone's scope. Put anything else in `docs/backlog.md` rather than implementing it.
- **Pull requests are expensive: batch them.** Every PR costs two CI runs of more than 5 minutes each (one on the PR, one after the merge into `dev`) plus a review. Open one PR per meaningful, reviewable unit: a sprint of a plan, or a milestone slice that a reviewer can judge on its own, not one per small change. Put follow-up fixes, docs, backlog entries, ADRs and README updates into the PR they belong to; add them to a PR that is already open instead of opening another. Do not open a PR for a typo, a single backlog line or a one-file doc change; collect such changes and ship them with the next PR. Split a PR only when it passes about 1500 changed lines of non-test code or mixes unrelated concerns, and then into as few stacked PRs as possible. Do not push a branch or open the PR before the work is complete and verified locally (lint, format, type check, tests of touched modules); a PR that fails CI and needs a fix commit costs another full run. A release (`release/*`, the merge-back into `dev`) is the exception: those PRs are required by CONTRIBUTING.md.
- Small, reviewable commits (commits, not PRs: many commits per PR is fine). Commit messages: `<module>: <imperative summary>` (for example `kpi-ingestion: add XLSX adapter`).
- **Branches:** never commit to `main` or `dev` directly. Work on `feature/<topic>` from `dev` (lower-case kebab case, milestone first: `feature/m1-module-loader`) and open the pull request into `dev`. Only `release/<x.y.z>` and `hotfix/<x.y.z>` branches merge into `main`. See CONTRIBUTING.md, "Branches" and "Releases".
- **Every pull request adds a changeset** (`pnpm changeset`, package `scorpion`; `pnpm changeset --empty` for tests, CI or refactoring). Docs-only pull requests (every file in `docs/**`, `**/*.md` other than `CHANGELOG.md`, or `.github/ISSUE_TEMPLATE/**`) are exempt. Write it for operators and API users. Never edit `CHANGELOG.md` by hand; `changeset version` writes it at a release. CI fails a pull request without a changeset.
- When a manifest changes (permissions, settings, events, registries, jobs), update the module's `README.md` in the same commit.
- If a requirement in FEATURES.md looks wrong or conflicts with the architecture, stop and ask rather than guessing; record the answer in an ADR.

<!-- code-review-graph MCP tools -->
## MCP Tools: code-review-graph

**This project has a knowledge graph. Start with the code-review-graph
MCP tools to narrow scope, then read the source.** The graph is cheaper than scanning files and
gives you structural context (callers, dependents, test coverage) that file search cannot.

### When to use graph tools FIRST

- **Exploring code**: `semantic_search_nodes_tool` or `query_graph_tool` instead of Grep
- **Understanding impact**: `get_impact_radius_tool` instead of manually tracing imports
- **Code review**: `detect_changes_tool` + `get_review_context_tool` instead of reading entire files
- **Finding relationships**: `query_graph_tool` with callers_of/callees_of/imports_of/tests_for
- **Architecture questions**: `get_architecture_overview_tool` + `list_communities_tool`

### Verify in the source

- Narrow scope with the graph, then read the source. Do not change code from graph output alone.
- For any non-trivial change, read the implementation and the relevant tests before concluding.
- Verify the exact source when touching behavior, database logic, migrations, retries, fallbacks,
  recovery, or compatibility code.
- When the graph and the source disagree, the source wins. The graph may be stale or may not
  model that relationship.
- An empty graph result can mean "not indexed" or "not statically visible", not "does not exist".

### Key Tools

| Tool | Use when |
| ------ | ---------- |
| `detect_changes_tool` | Reviewing code changes — gives risk-scored analysis |
| `get_review_context_tool` | Need source snippets for review — token-efficient |
| `get_impact_radius_tool` | Understanding blast radius of a change |
| `get_affected_flows_tool` | Finding which execution paths are impacted |
| `query_graph_tool` | Tracing callers, callees, imports, tests, dependencies |
| `semantic_search_nodes_tool` | Finding functions/classes by name or keyword |
| `get_architecture_overview_tool` | Understanding high-level codebase structure |
| `refactor_tool` | Planning renames, finding dead code |

### Workflow

1. The graph auto-updates on file changes (via hooks).
2. Use `detect_changes_tool` for code review.
3. Use `get_affected_flows_tool` to understand impact.
4. Use `query_graph_tool` pattern="tests_for" to check coverage.
<!-- /code-review-graph MCP tools -->
