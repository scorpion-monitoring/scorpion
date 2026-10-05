# Scorpion Rebuild: Implementation Plan

Status: approved architecture, 2026-09-30
Inputs: `FEATURES.md` (requirements baseline) and *Scorpion Rebuild: Overall Architecture* (approved design)

This plan turns the approved architecture into 19 milestones (M0–M18). They are grouped into the four roadmap phases, and each phase ends at a gate. Every milestone ends with a release: work is integrated on `dev`, and a `release/*` branch merges it into `main` with a version tag (M0 is `v0.1.0`). The plan gives no calendar dates because team size and start date are not fixed yet. Each milestone has a relative size instead: S ≈ 1 week, M ≈ 2–3 weeks, L ≈ 4+ weeks for one developer.

---

## 1. Ground rules for every milestone

A milestone is **done** only when all of the following hold:

1. Code is merged to `dev` through pull requests with CI green (lint, type check, unit, integration, contract, and E2E tests for any affected journey), and the milestone is released: a `release/*` branch merged into `main` and tagged `v<version>`.
2. Every new route declares a `permission` and has a test for a denied request.
3. Every multi-row write runs in one transaction and has a rollback test.
4. Every input is validated by Zod. Invalid input returns 422 (problem+json) and never 500.
5. New tables live in the owning module's schema file and migration folder, prefixed with the module name.
6. Every defect from FEATURES.md §5 that the milestone touches has a named regression test (`defect-NN.*.test.ts`).
7. The public OpenAPI diff shows no breaking change, or the milestone explicitly bumps the API version.
8. Module docs (`modules/<id>/README.md`) are updated: permissions, settings keys, events, registries, jobs.
9. Every merged pull request carries a changeset (`pnpm changeset`, or `pnpm changeset --empty` for changes that operators and API users do not notice), except docs-only pull requests (`docs/**`, `**/*.md` other than `CHANGELOG.md`, `.github/ISSUE_TEMPLATE/**`). `CHANGELOG.md` is written by `changeset version` at a release and never edited by hand.
10. From M4a on, a pull request that touches a security-scoped path (see §8.4) either updates the matching ASVS assessment file in `docs/security/asvs/`, or carries the label `asvs-no-impact` with a one-line reason in the description. CI enforces this.

Terms used below come from the architecture: **kernel**, **manifest** (`defineModule`), **registry**, **profile**, **service layer**, **outbox**.

---

## 2. Milestone overview

| # | Milestone | Phase | Size | Depends on | Closes defects (FEATURES §5) |
|---|---|---|---|---|---|
| M0 | Repository and toolchain bootstrap | 1 Foundation | S | none | none |
| M1 | Kernel: module loader, context, events, jobs | 1 Foundation | M | M0 | none |
| M2 | `core.identity`: accounts, sessions, OIDC, PATs | 1 Foundation | L | M1 | 3, 4, 5, 13 |
| M3 | `core.authz` + `core.settings` (incl. secrets, vocabularies) | 1 Foundation | M | M2 | 1 |
| M4 | `core.notifications` + `core.audit` | 1 Foundation | M | M3 | none |
| M4a | Security assurance tooling | 1 Foundation | S | M4 | none |
| M5 | `core.ui-shell` + web app skeleton | 1 Foundation | M | M3 | 11, 12 |
| **G1** | **Gate 1: security foundation** | | | M0–M5 incl. M4a | |
| M6 | `registry.organisations` | 2 Registry | M | G1 | none |
| M7 | `registry.services`: model, wizard, catalogue, detail/edit | 2 Registry | L | M6 | 2, 14 (partly) |
| M8 | `public-api` v1 (read) + OpenAPI + Swagger | 2 Registry | M | M7 | 15 |
| **G2** | **Gate 2: `denbi-registry` profile deployable (without KPIs)** | | | M6–M8 | |
| M9 | `kpi.framework` | 3 KPIs | M | G2 | 14 |
| M10 | `kpi.ingestion`: form, CSV/TSV/XLSX, API write | 3 KPIs | L | M9 | 6 |
| M11 | `kpi.analytics`: dashboard, scores, exports | 3 KPIs | L | M10 | 10 |
| M12 | `kpi.impact` | 3 KPIs | M | M11 | 9 |
| M13 | Legacy data migration tool | 3 KPIs | M | M12 | none |
| **G3** | **Gate 3: migration dry run clean, `kpi-tracker` live** | | | M9–M13 | |
| M14 | `maturity` | 4 Parity | M | G3 | 7 |
| M15 | `onboarding` | 4 Parity | M | M14 | 8 |
| M16 | `bibliometrics` | 4 Parity | M | G3 | none |
| M17 | `network-graph` + `announcements` | 4 Parity | M | G3 | none |
| M18 | `backup` + hardening + release | 4 Parity | M | M14–M17 | none |
| **G4** | **Gate 4: `full` profile live, old app retired** | | | all | |

M14/M15, M16 and M17 do not depend on each other, so they can run in parallel if more than one developer is available.

---

## 3. Phase 1: Foundation

### M0: Repository and toolchain bootstrap (S)

**Goal:** an empty but fully wired monorepo in which every later milestone only adds code.

- pnpm workspace with `apps/server`, `apps/web`, `packages/{kernel,contracts,ui-kit,integrations,testing}`, `modules/`, `profiles/`, `tools/`.
- TypeScript strict, project references, shared `tsconfig.base.json`.
- ESLint (flat config) including the boundaries rule: a module may import only another module's `public.ts`, and only if it declares that module as a dependency. Prettier.
- Vitest workspace config and a Testcontainers Postgres helper in `packages/testing`.
- Playwright config for `apps/web`.
- Docker: multi-stage build that takes a `PROFILE` build argument; `docker-compose.dev.yml` with Postgres 16 and Mailpit.
- GitHub Actions: install, lint, type check, test, build one image per profile (matrix).
- Branch policy: `main` (releases only), `dev` (integration), `feature/*` from `dev`, `release/<x.y.z>` from `dev` into `main`, `hotfix/<x.y.z>` from `main`. CI rejects pull requests that break it.
- Changesets for the changelog: a root `CHANGELOG.md`, the `scorpion` root package carries the product version, and CI fails a pull request that adds no changeset.
- `CLAUDE.md`, `README.md`, `CONTRIBUTING.md`, ADR folder (`docs/adr/`) with ADR-001 "Modular monolith, build-time composition".

**Acceptance:** `pnpm i && pnpm check && pnpm test` passes on a clean clone. CI builds a `full` image that starts and answers `/healthz`.

### M1: Kernel (M)

**Goal:** modules can be declared, resolved, migrated and wired.

- `defineModule()` and manifest types: id, version, permissions, settings, schema, migrations, services, routes, jobs, events, registries, contributes, ui. Dependencies are not in the manifest: the loader derives them from each module's `package.json` (ADR-0002).
- `defineProfile()` and the profile loader (`profiles/*.ts`) with dependency graph resolution. Startup fails with a clear message on a missing dependency or a cycle. `scorpion profile:generate` composes the server for one profile at build time.
- Migration runner: per-module Drizzle migrations in dependency order, under a Postgres advisory lock.
- DI context: `ctx.db` (with `tx()`), `ctx.log`, `ctx.config`, `ctx.events`, `ctx.jobs`, plus the public services of declared dependencies only.
- Registry mechanism: a module declares a registry, dependents contribute entries, and entries are validated against the registry's Zod schema.
- Event bus with a transactional outbox table and dispatcher; events versioned `name@n`.
- Job facade over pg-boss: declared jobs, cron schedules, retries, timeouts, and a run-history table.
- `packages/contracts`: `createRoute()` wrapper around `@hono/zod-openapi` that **requires** `permission` (or `public: true`); the envelope and problem-details schemas.
- Request pipeline skeleton in `apps/server`: security headers, request id, pino logging, error mapper.
- CLI entry `scorpion` with `start`, `worker`, `migrate` and `profile:generate` (`seed` and `create-admin` come with the modules that need them).
- `/healthz` (alive, no database), `/readyz` (database reachable and all migrations applied; 503 until then and while shutting down) and `/metrics` (Prometheus). Graceful shutdown on SIGTERM.
- Each profile image holds only its profile's modules; CI checks it (ADR-0002).

**Acceptance:** two dummy test modules (A depends on B) load, migrate, exchange an event through the outbox and run a scheduled job. A route without a permission fails at registration. A profile with a missing dependency refuses to start.

### M2: `core.identity` (L)

**Goal:** secure accounts and authentication, fixing defects 3, 4, 5 and 13 by design.

- Tables: `identity_user`, `identity_auth_method`, `identity_session`, `identity_login_state`, `identity_token`.
- Local accounts: register, login, logout. Validation: username 3–31 `[a-z0-9_-]`, password 8–255, email format. The duplicate check covers all auth methods.
- The `Local Accounts` setting is enforced **server-side** on register and login (defect 13).
- Password reset, email verification and password change (their emails are queued once M4 lands; until then they are logged).
- Sessions: opaque 256-bit ids, stored hashed, checked on every request with a short in-memory cache, sliding 7-day expiry, "log out everywhere". Cookie `__Host-session`, Secure, HttpOnly, SameSite=Lax. CSRF token for cookie-authenticated writes.
- OIDC via `arctic`: discovery, PKCE S256, nonce, id_token validation (JWKS signature, iss, aud, exp). Login state lives 10 minutes, is deleted on use, and stores only the provider id; an unknown state returns 400 (defect 5).
- Auto-provisioning on first OIDC login (pending approval). Linking an OIDC identity to an existing account by verified email or from the profile page.
- Approval flow as the `auth.approvalPolicy` registry, with `manual` as the default. Reject soft-deletes the user; the data is purged by a retention job.
- Bootstrap: `scorpion create-admin` CLI and a one-time first-run token printed to the log. The "first registrant becomes admin" rule is dropped.
- PATs: format `scp_<8-char prefix>_<secret>`, lookup by prefix, argon2id hash per token, name unique per user, optional expiry, scopes, `lastUsed`, revoke, rotate. An invalid token returns 401 (defect 3).
- Profile service: name, email, bio, avatar (stored in the blob store, see M3).

**Acceptance:** regression tests for defects 3, 4, 5 and 13 pass. A copied session cookie stops working after logout. An OIDC flow against a Keycloak Testcontainer passes, including a tampered-nonce test.

### M3: `core.authz` + `core.settings` (M)

**Goal:** deny-by-default authorisation and data-driven configuration.

- `core.authz`: permission registry filled from manifests; roles stored as data (Admin, Reviewer, User seeded); role → permission mapping editable by admins; `ctx.authz.require(actor, permission, resource?)`; resource policies registered by modules (for example `service.member`). Modules contribute default role permissions through the registry `authz.defaultRole` and resource policies through `authz.resourcePolicy`. A walker test fails if a non-public route has no entry in the "denied for a plain User" matrix.
- Dependency order: `core.authz` → `core.settings` → `core.blob` → `core.identity` (ADR-0014). `core.authz` is user-agnostic; `core.identity` depends on it. The blob store is its own module, `core.blob`.
- Token scopes are intersected with the owner's permissions (effective permission = scope ∩ owner). Approving an account takes the role to assign (default `User`), in one transaction with the status change.
- Built-in protections: nobody can change their own role or approve their own requests, and role assignment needs `identity.role.assign` (defect 1).
- Pipeline step: the route's `permission` is checked before the handler runs; the service layer checks again for resource-scoped permissions.
- `core.settings`: `settings` (per-module JSON validated by that module's Zod schema, defaults from the schema), `user_preferences`, `secrets` (AES-256-GCM, key from `SECRETS_KEY`; values write-only through the API; `scorpion set-secret` and `scorpion rotate-secrets`).
- M2 hand-offs: identity reads its settings through the settings port (`ctx.settings`); the OIDC client secrets come only from the secrets store (no environment fallback); the retention, rate-limit and mail-budget numbers become settings; user purge calls the authz service inside its transaction; avatar upload goes through the blob service.
- `vocabulary` + `vocabulary_term` tables and a `vocabulary` registry. Seeds: stages (DEV, DEMO, PROD, TERM), thematic categories, necessity levels, sender types, aggregates.
- Blob store: `blob` table (bytea, sha256, MIME, size), `/files/:hash` with a strict CSP, `sharp` re-encoding of rasters, DOMPurify for SVG, size limit from settings.
- Branding settings: instance name, logos, product name, sender address, contact email, imprint URL, legal texts (Markdown). These replace the hard-coded values listed in FEATURES §3.3.
- The seed migration maps the temporary `identity_user.isBootstrapAdmin` column (added in M2) to the Admin role assignment and then drops the column completely; no code reads it afterwards.

**Acceptance:** the defect-1 regression suite passes: a plain User calling each admin endpoint gets 403, including role changes, self-approval, KPI-set edits, announcement deletion, log reads and revoking another user's token. Secrets never appear in API responses or logs. A test proves that `identity_user.isBootstrapAdmin` no longer exists and that former bootstrap admins hold the Admin role. A fresh `full` instance works end to end without a test authorizer: `create-admin`, a second person registers and is approved with a role, and a scoped personal access token is limited to its scopes.

### M4: `core.notifications` + `core.audit` (M)

- Notifications: the `notify.transport` registry (smtp with auth/TLS/port, webhook, none); the `notify.template` registry (per event, per locale); a pg-boss delivery queue with retries and visible status; the transport is rebuilt when its settings change.
- Templates for all events in FEATURES §3.15, plus membership decided, password reset and email verification.
- In-app inbox (table + API) and per-user notification preferences.
- Audit: an append-only `audit_event` table; middleware logs every public API call; `ctx.audit()` for admin and permission-relevant actions; viewer API with filters (method, user, endpoint, date range), CSV export; retention job.
- Dependency order (ADR-0019): `core.authz` → `core.settings` → `core.blob` → `core.notifications` → `core.identity` → `core.audit`. `core.notifications` is user-agnostic (opaque user ids, recipients passed by the caller); `core.identity` depends on it and enqueues inside its own transactions. Delivery rows are the queue (a job and `pg_notify` only wake it); the rendered body of a `sensitive` mail (reset, verification) is deleted once the delivery is `sent` or `dead`.
- The webhook transport is an admin-notification mirror (one signed URL), not a user channel. It refuses loopback, private, link-local and metadata addresses unless `allowPrivateTargets` is set, resolves once, and follows no redirects.
- `SMTP_URL` is removed without a fallback: SMTP host, port and TLS mode are `core.notifications` settings and the password is a secret. The `Mailer` port in `core.identity` is deleted. Templates are typed TypeScript functions in English and German (user preference `locale`, else the instance default), with no new dependency.
- `POST /auth/register` answers 202 for every well-formed request; the owner of a taken address gets a notice mail (register without revealing).
- Audit (ADR-0021): `core.audit` subscribes to the events of authz, settings and identity, and the kernel gets an audit sink port that the pipeline and `ctx.audit()` use (a no-op without `core.audit`). Request bodies are stored only when a route opts in, redacted and capped at 8 KB, and never for auth routes. The table refuses `UPDATE` and ordinary `DELETE`. `core.authz` gains `authz.role.permissions.changed@1`.
- Hosted in `core.audit`: the kernel's outbox and job-run retention jobs and the outbox requeue route, under `core.audit.system.*` permissions. (Job names carry the module id: `core.audit.retention`, `core.audit.system.outbox-retention`, `core.audit.system.job-run-retention`; ADR-0024.)

**Acceptance:** registering produces the welcome and admin emails in Mailpit. If the SMTP relay is down, emails are retried and the failure shows in the admin status list. A role change creates an audit entry. No secret (reset token, SMTP password, webhook secret) appears in logs, the audit table or API responses, and a plain User gets 403 on every notification-admin, audit and system route.

### M4a: Security assurance tooling (S)

**Goal:** the security signals of §8 are wired up before the last Phase 1 milestone, so M5 is built with them in place and G1 is a check, not a one-off audit.

- Repo hardening: `SECURITY.md`, private vulnerability reporting, secret scanning with push protection, Dependabot alerts, branch protection on `main` and `dev`, CODEOWNERS for the security-scoped paths.
- Workflow hygiene: actions pinned by SHA, Docker base images pinned by digest, top-level `permissions: contents: read`, Renovate or Dependabot, CodeQL.
- Scorecard workflow and badge. Fix the findings that are cheap to fix. Register on bestpractices.dev and answer the passing criteria as far as possible.
- `tools/asvs-report` (validator and generator), pinned ASVS 5.0.0 source, `pnpm security:asvs` in CI, the `asvs-impact` job (rule 10) and the generated README badge block.
- Skeletons for V6, V7, V8 and V10 with every L1/L2 id. Fill in what M2–M4 already delivered: tag the existing tests (including the `defect-NN.*` tests) and move the matching requirements to `pass` or `n/a`. Everything else stays `fail`, with an issue for each gap.

**Acceptance:** CI runs `pnpm security:asvs` on every pull request, and a hand-edited badge fails it. The README shows Scorecard, Best Practices (in progress) and four ASVS badges at `in progress`. Every open `fail` links to an issue assigned to M5 or to a fix before G1.

### M5: `core.ui-shell` + web app skeleton (M)

- SvelteKit app with the layout, header, drawer, collapsible section sidebars and footer from FEATURES §3.19.
- The shell's catch-all route `/[...path]` resolves module-registered `ui.routes`, checks their permissions, runs `load` and renders the component. There are no module filesystem routes.
- Navigation filtered by permission. Public routes (legal pages, `/docs`, onboarding) declared explicitly.
- Generated typed API client (`hono/client`) in `packages/contracts`; one `url()` helper for all links and fetches that respects `BASE_PATH` (defect 11).
- Loaders throw errors instead of returning `Response(400)` (defect 12).
- Themes: light/dark from `prefers-color-scheme` plus a manual toggle; branding and logos from settings.
- `ui-kit`: `SchemaForm` (JSON Schema → form, including arrays of objects), `DataTable` (pagination, sorting), `Wizard`, `Facets`, a chart adapter (ECharts).
- Screens: login (local + OIDC buttons), register, pending approval, profile (avatar, details, identities, tokens), admin → users, roles, settings (generated forms), logs, job runs, notification status.
- Legal pages rendered from sanitised Markdown and public.

**Acceptance:** Playwright journeys work under `BASE_PATH=/` and `BASE_PATH=/a/b`: register → pending → admin approves → user signs in → creates a PAT. A User never sees the Administration navigation.

### Gate 1: security foundation

- The regression tests for defects 1, 3, 4, 5, 11, 12 and 13 pass.
- The four ASVS 5.0 Level 2 chapter assessments in `docs/security/asvs/` (V6, V7, V8, V10; see §8.1) have no `fail` entries, every `n/a` has a reason, and the second-pass self-review (§8.2) is recorded. `pnpm security:asvs` is green on the gate commit.
- The README badge row (§8.5) shows all four ASVS badges as `self-assessed`, plus the OpenSSF Best Practices badge at **passing** and the OpenSSF Scorecard badge at **≥ 6.5**.
- `SECURITY.md` is published, and GitHub private vulnerability reporting is switched on.
- A `core-only` profile image deploys to staging.

---

## 4. Phase 2: Registry

### M6: `registry.organisations` (M)

- One `organisation` table typed by the `org.type` registry (seed types: provider, consortium).
- CRUD for admins, including delete (blocked while services reference it) and detail pages.
- Membership as a state machine (`requested → approved | rejected`, `left`), with notifications to admins and the requester, and support for consortium membership too.
- Resource policy `organisation.member` registered with authz.
- UI: admin groups editor; profile → group membership (search, 5 per page, member counts, pending/member badges).

**Acceptance:** a user cannot approve their own membership. Approving sends the requester an email.

### M7: `registry.services` (L)

- Tables: `service`, `service_organisation` (roles: provider, consortium), `service_field_value` for deployment-specific metadata.
- Service metadata schema and wizard steps loaded from config (successor of `steps.json` / `service_schema.json`), validated at startup.
- `service.fieldType` registry with text, select, license (SPDX adapter), organisation (own providers), multi-select, image. `service.wizardStep` registry.
- Create wizard with client-side and server-side validation from the same schema, created in one transaction. Dev-only JSON console kept.
- Detail and edit page. Edits are limited to members of the provider (policy `service.member`). Slug rename redirects. Unknown references return 422 (defect 14, service part).
- Catalogue: paginated, sortable table; facets (category, consortium, stage, license) computed in SQL **over the filtered set**; the page resets when a filter changes; removable filter badges.
- Correct service ↔ consortium read model (a tested query function, no hand-written view) (defect 2).
- `packages/integrations`: SPDX adapter with a 24 h cache and a bundled fallback.

**Acceptance:** the defect-2 test passes: a service with zero or several consortia appears correctly in the catalogue, in the facet counts and in the consortium filter. A non-member gets 403 on edit.

### M8: `public-api` v1 read + docs (M)

- The `public-api` module mounts the `v1` routes contributed by active modules and aggregates `/api/v1/openapi.json` at runtime.
- Swagger UI at `/docs`, public, themed, with the server URL set to the current origin.
- Auth: `Authorization: Bearer` and `X-API-Key` (alias). Per-token and per-IP rate limits, CORS allow-list from settings, audit on every call.
- v1 read endpoints: categories (added in M9), indicators (added in M9), providers (`is_member=true|false` both correct), services (with `consortia` filled), keeping the v1 envelope (`metadata` / `result`, 0-based pages) on every endpoint and a stable order (defect 15).
- Contract-test harness: every v1 route is tested against its schema. CI diffs the spec against the last release tag.

### Gate 2: `denbi-registry` profile deployable

- The `denbi-registry` profile (without KPI modules) runs on staging with real organisation and service data from a partial migration dry run.
- Catalogue, wizard and edit flows pass E2E. The v1 contract tests pass.

---

## 5. Phase 3: KPIs

### M9: `kpi.framework` (M)

- Tables: `indicator`, `kpi_set`, `kpi_set_indicator` (necessity from the vocabulary), `service_extra_indicator`, `evaluation` (headline indicator + aggregate per KPI set).
- `kpi.valueType` registry: integer, float, text, duration (`HH-MM-SS` → seconds), percentage. Units and optional min/max per indicator.
- Full CRUD for indicators and KPI sets (rename, delete when unused), all transactional; URL-safe identifiers.
- Contributes the `kpi-set` wizard step and service-detail section to `registry.services`.
- Effective KPI set = one tested query function. Changing a service's category replaces the set in one transaction; removing extra KPIs works (defect 14, KPI part).
- Adds the v1 `categories` and `indicators` endpoints (`totalCount` respects filters).

### M10: `kpi.ingestion` (L)

- `kpi_measurement` with typed value columns and a unique `(service_id, indicator_id, period)`; `period` normalised to the month end.
- One domain path, `upsertBatch()`, used by all adapters and by `POST /api/v1/measurements`. It checks the KPIs allowed for the service and each value's type, and requires `measurement.submit` on that service (defect 6 and the v1 POST permission gap).
- `ingestion.adapter` registry: manual form, CSV/TSV, XLSX. Each adapter parses to `{indicator, period, value}[]`, then the user sees a preview, a dry run and a commit. Invalid cells block the commit.
- Downloadable import template per service (CSV and XLSX).
- `ingestion_run` table for history, with a per-run summary (inserted, updated, rejected).
- v1 `GET /measurements` with stable ordering across pages (defect 6).
- Monthly reporting-reminder job (notification to provider members when mandatory KPIs are missing).
- Data submission UI: service picker limited to the user's services, month picker, mandatory/recommended/optional groups, column mapping.

**Acceptance:** submitting the same month twice updates the values instead of duplicating them. A form submission and an API call with the same data produce identical rows.

### M11: `kpi.analytics` (L)

- A pure calculation library (`packages` or inside the module) with table-driven tests: change %, MAPE, averages, aggregates (sum/avg/min/max), cumulative series, month-end handling.
- Dashboard: time range (3m, 6m, 1y, 2y, all, always applied), service selector (defaults to the user's preference, else their first own service), thematic filter from the vocabulary (defect 10).
- Widgets through `ui.widget`: KPI cards with sparklines, trends chart (cumulative, hide, secondary axis), averages, volatility (MAPE) bars, announcements slot, quick actions.
- User preferences modal that uses the same vocabularies as the dashboard filters.
- `analytics.exporter` registry: CSV (properly escaped, one date column set per KPI), XLSX, PDF (generated by a job; long tables paginate; real axis titles).
- Theme-aware chart colours.

### M12: `kpi.impact` (M)

- Consortium summary tiles: total, open source (OSI-approved via the cached SPDX adapter), counts per stage from the vocabulary, including TERM (defect 9).
- A per-service monthly table for the selected year using the evaluation configuration, with the states no-data, no-evaluation and error.
- Monthly and yearly aggregates as a read model refreshed on `measurement.recorded` and nightly.
- Stage labels come only from the vocabulary, so they match on every screen (defect 9).

### M13: Legacy data migration (M)

- `tools/migrate-legacy`: reads the old database (read-only connection) and writes **through the new domain services**.
- Transformations: measurement dedup (latest insert wins), repaired consortium links, data-URL images to blobs, plain-text secrets to the secrets store, stable ids for maturity rows, users and OIDC identities preserved, provider memberships mapped to states.
- PATs cannot be converted: affected users are listed and emailed to create new tokens.
- `--dry-run` produces a report of every row that is dropped or changed, with reasons. The run is idempotent and can be repeated.
- Rehearsal on a copy of production data on staging.

### Gate 3

- The migration dry run on a production copy reports no unexplained drops.
- The `kpi-tracker` profile runs on staging with migrated data. The dashboard numbers match the old app for three sample services, checked by hand.

---

## 6. Phase 4: Full parity

### M14: `maturity` (M)

- First-class tables `maturity_model`, `maturity_version`, `maturity_domain`, `maturity_topic`, `maturity_level` (with description), all with stable ids. Every edit is scoped to its model (defect 7).
- Draft → publish versioning. Assessments reference a published version.
- Editor: rename or delete models and domains, reorder levels, save feedback.
- `maturity.visualisation` registry with the radar (ECharts) plus the level-description table.

### M15: `onboarding` (M)

- `application` with status `submitted → under_review → approved | declined`, plus `application_answer`, applicant name and email.
- Public form: model version picker, one step per domain, configurable additional fields (`SchemaForm`), a success page, an email confirmation link, a rate limit and a CAPTCHA (a registry slot: ALTCHA by default).
- Review screen (Reviewer/Admin, linked in the sidebar): radar per domain, fields for slug, provider and category. **Approve** creates the service through the registry's service API in one transaction and notifies the applicant. **Decline** needs a reason and notifies the applicant (defect 8).
- `onboarding.postProcessor` registry with webhook and email built in (Jira and GitHub issue can be added later as plugins).

### M16: `bibliometrics` (M)

- `publication` (unique DOI per service, remove supported) and `citation_snapshot`.
- DOI resolver adapter (CSL-JSON, cached permanently), `doi.org/` prefix stripping.
- `biblio.citationSource` registry with OpenAlex (batches of 100, backoff on 429, optional API key).
- Weekly refresh job that stores the history. Optional setting: write the total citations as a Bibliographic KPI through `upsertBatch()`.

### M17: `network-graph` + `announcements` (M)

- Network graph: `graph.nodeProvider` contributions from the organisations, services and KPI modules; Cytoscape renderer behind `graph.renderer`; filters by node type, search, legend, click-through to detail pages, light/dark palettes.
- Announcements: create, edit, delete; sanitised Markdown; sender type from the vocabulary; audience by role or organisation; expiry; read state; dashboard widget.

### M18: `backup`, hardening and release (M)

- Backup: `backup.target` registry (S3 path-style, filesystem); pg_dump or JSON export, envelope-encrypted (RSA-3072 keyring or KMS); a schedule job, retention, a `backup_run` status page, and a "run now" button.
- `scorpion restore` CLI with decryption, tested in CI against a Testcontainer.
- Runtime upgrade: move from Node 24 to Node 26 LTS (Dockerfile base images, `.nvmrc`, `engines`, CI). Corepack is no longer bundled from Node 25 on, so install pnpm with `npm i -g pnpm` or a pinned standalone binary. Check that the native add-ons (`@node-rs/argon2`, `sharp`) support Node 26 before switching.
- Hardening: a load test on the dashboard and ingestion endpoints, a CSP audit, a dependency audit, an accessibility pass (axe in Playwright), and a review of rate limits.
- Operations docs: deployment per profile, configuration reference (generated from the settings schemas), a backup/restore runbook, and an upgrade guide.
- Release `v1.0.0` images for all four profiles, with `CHANGELOG.md` generated by `changeset version`.

### Gate 4: full profile live

- Production cut-over: final migration run, DNS/proxy switch, old app set to read-only for 30 days, then retired.
- All tests from FEATURES §4.11 and all defect regression tests pass on the release tag.
- One real backup restore rehearsed successfully.
- The ASVS chapter assessments are re-confirmed against the `v1.0.0` release commit (`assessed_commit` updated, second pass recorded).
- OpenSSF Scorecard ≥ 7.0. Release images are signed and published with SLSA provenance.
- OpenSSF Best Practices is still **passing**.

---

## 7. Cross-cutting workstreams

These run alongside the milestones and are not tied to a single one.

| Workstream | Starts | Content |
|---|---|---|
| Test data | M1 | Factories in `packages/testing` for every entity; one seed script per profile for local dev |
| Documentation | M0 | ADRs for every significant decision; per-module README; generated config reference |
| Observability | M1 | Logs, traces and metrics added with each module; a Grafana dashboard JSON by M18 |
| i18n | M5 | All UI strings go through the message catalogue from the start (English first, German second); vocabularies have labels per locale |
| Accessibility | M5 | Every `ui-kit` component keyboard- and screen-reader-tested |
| Security assurance | M4a | ASVS chapter assessments and tool, Scorecard, Best Practices, SECURITY.md (§8) |

---

## 8. Security assurance signals

The repository publishes four kinds of security signal. They are only worth showing if they are specific, backed by evidence anyone can check, and kept current by CI. A badge that a person flips by hand is not allowed.

| Signal | What it means | Target |
|---|---|---|
| ASVS 5.0 L2 chapter badges (V6, V7, V8, V10) | A structured self-assessment of every Level 1 and Level 2 requirement in the chapter, with linked evidence | All four `self-assessed` at G1, re-confirmed at G4 |
| OpenSSF Best Practices badge | Self-certification on bestpractices.dev | Passing at G1 |
| OpenSSF Scorecard badge | Automated checks of the repository and its supply chain | ≥ 6.5 at G1, ≥ 7.0 at G4 (see the single-maintainer note in §8.3) |
| `SECURITY.md` | How to report a vulnerability, and what reporters can expect | Published by G1 |

OWASP does not certify projects. The project has one maintainer, so the badges say **self-assessed**, not "compliant" or "verified". The word changes only when the assessment changes (§8.4).

### 8.1 ASVS scope

There is one badge and one assessment per ASVS chapter. This keeps the claim aligned with the ASVS structure, so readers don't have to learn a project-specific grouping.

| Badge | ASVS 5.0.0 chapter | Scope inside the chapter | Main modules |
|---|---|---|---|
| `V6` | V6 Authentication | Full chapter | `core.identity` |
| `V7` | V7 Session Management | Full chapter | `core.identity`, request pipeline |
| `V8` | V8 Authorization | Full chapter | `core.authz`, request pipeline, resource policies |
| `V10` | V10 OAuth and OIDC | Requirements for an OAuth client and an OIDC relying party. Requirements for authorization servers, OIDC providers and resource servers are `n/a`, because Scorpion is none of these (PATs are not OAuth tokens). | `core.identity` |

Level 2 includes every Level 1 requirement. V9 (self-contained tokens) does not apply, because sessions and PATs are opaque reference tokens. This is recorded once in `docs/security/README.md`. The chapter numbers must match the pinned source file (§8.2). The tool reads requirements from that file.

Other ASVS chapters are not claimed. Extending the scope is in the backlog (§10).

### 8.2 Layout, file format and method

```text
docs/security/
  README.md                         scope, method, assessment history, links to all signals
  asvs/
    source/OWASP_ASVS_5.0.0_en.json # pinned official requirement export (CC BY-SA 4.0, with attribution)
    v6-authentication.yaml          assessment data (source of truth, edited by people)
    v6-authentication.md            generated report (never edited by hand)
    v7-session-management.yaml / .md
    v8-authorization.yaml      / .md
    v10-oauth-oidc.yaml        / .md
tools/asvs-report/                  validator and generator (`pnpm security:asvs [--write]`)
SECURITY.md                         repository root
```

Assessment file (`v6-authentication.yaml`):

```yaml
asvs_version: 5.0.0
level: 2
chapter: V6
assessment_type: self          # self | peer | external
assessed_commit: 3f2c1e9…      # full SHA the assessment was made against
assessed_on: 2026-11-20
assessor: <github-handle>
second_pass:                   # self-review on a later day (see "Method")
  by: <github-handle>
  on: 2026-11-27
reviewer: null                 # required for type "peer"; must differ from the assessor
requirements:
  - id: v5.0.0-6.2.1
    status: pass               # pass | fail | n/a (there is no "accepted risk" status)
    evidence:
      - test: "ASVS-6.2.1"     # tag carried by at least one test title
      - code: modules/core-identity/src/service/password.ts
    note: Password length 8–255 enforced in the Zod schema and the service.
  - id: v5.0.0-6.x.y
    status: n/a
    reason: Scorpion has no … (explain why the requirement cannot apply)
```

**Method (single maintainer).** Without a second person, the main weakness of a self-assessment is that the author checks their own assumptions. Three things reduce this:

1. Evidence is mechanical where possible: a tagged test that runs in CI beats a code pointer, and a code pointer beats prose.
2. A **second pass** on a different day, at least 7 days after the first pass, re-checks every `pass` and `n/a` against the evidence alone, and is recorded in `second_pass`. Tool-assisted review (for example an AI code review against the chapter) can feed the second pass. It is noted in the report, and it does not count as a peer review.
3. Everything is public, so anyone can challenge an entry through `SECURITY.md` or an issue.

Rules the tool enforces (`pnpm security:asvs`, which runs in CI on every pull request after the test jobs):

1. Every L1 and L2 requirement of the chapter in the pinned source file appears exactly once. There are no unknown ids.
2. `pass` needs at least one piece of evidence. A `test:` tag must match at least one test that **passed** in this CI run (the tool reads the Vitest and Playwright JUnit reports). `code:` and `doc:` paths must exist. A requirement that cannot be tested may pass on `code:` or `doc:` evidence only.
3. `n/a` needs a `reason`. `fail` needs a `note` that links to an issue.
4. `second_pass.on` is at least 7 days after `assessed_on`. For `assessment_type: peer` or `external`, a `reviewer` is set and differs from the assessor.
5. The chapter status is **derived**, never stored:

   | Derived status | Condition | Badge |
   |---|---|---|
   | `in progress` | Any `fail` entry, or rules 1–4 not met yet | yellow |
   | `self-assessed` | Zero `fail`, rules 1–4 hold, type `self` | green |
   | `peer-reviewed` | Same, with type `peer` | green |
   | `externally verified` | Same, with type `external` | green |
   | `stale` | A scoped path changed after `assessed_commit` on a release branch (§8.4) | grey |

6. `--write` regenerates each chapter's `.md` report and the README badge block (§8.5). CI fails if either differs from what the tool would generate, so a hand-edited badge or report cannot be merged.

Every generated report starts with this header:

> Self-assessment against OWASP ASVS 5.0.0, Level 2, chapter V6 Authentication, at commit `…` on … , second pass on … . Assessor: … . This is not a certification, and no independent party has reviewed it. OWASP does not certify projects.

Then come the summary counts (pass / n/a / fail), and then one table row per requirement with its status, evidence links and note.

**Test tagging.** Tests that prove a requirement carry the tag in their title, for example `it('rejects a reused OIDC state [ASVS-10.x.y]', …)`. One test may carry several tags. The defect regression tests (`defect-NN.*`) should carry the ASVS tags they cover.

### 8.3 OpenSSF Best Practices and Scorecard

**Best Practices (bestpractices.dev).** Register the project and answer the passing criteria. For each answer, link to a file in the repo (CONTRIBUTING.md, SECURITY.md, CI config, test docs) rather than writing free text. `docs/security/README.md` keeps a short mapping from criterion to evidence, so the answers can be re-checked at G4. Silver and gold need a second maintainer (and two-person review for gold), so they go to the backlog.

**Scorecard.** Add `.github/workflows/scorecard.yml` using `ossf/scorecard-action` (pinned by SHA). It runs on pushes to `main`, weekly, and on branch-protection changes, with `publish_results: true`, and it uploads SARIF to code scanning. Repository settings and files needed for the target score:

| Scorecard check | What to do |
|---|---|
| Security-Policy | `SECURITY.md` |
| Branch-Protection | Protect `main` and `dev`: pull requests only, required status checks, no force-push, admins included. Required approvals stay at 0 until a second maintainer exists |
| Token-Permissions | Top-level `permissions: contents: read` in every workflow. Widen per job only where needed |
| Pinned-Dependencies | Actions pinned by full SHA, Docker base images pinned by digest, `pnpm i --frozen-lockfile` in CI |
| Dependency-Update-Tool | Renovate or Dependabot (npm, GitHub Actions, Docker), grouped weekly |
| SAST | CodeQL workflow (JavaScript/TypeScript) on pull requests and `main` |
| Dangerous-Workflow | No `pull_request_target` that checks out pull-request code. No untrusted input inside `run:` expressions |
| Vulnerabilities | No open OSV advisories against the lockfile. `pnpm audit` in CI. Dependabot alerts on |
| Signed-Releases (G4) | Sign images with cosign, and attach SLSA provenance and signatures to GitHub releases |
| Fuzzing (optional) | `fast-check` property tests for the pure calculation library (M11) and the parsers (M10). Check Scorecard's current detection rules first |
| License, CI-Tests, Maintained, Binary-Artifacts | Covered by the existing repo setup: LICENSE file, CI on every pull request, regular commits, no committed binaries |
| CII-Best-Practices | Picked up automatically from the bestpractices.dev badge |

Also turn on GitHub secret scanning with push protection, Dependabot alerts and private vulnerability reporting.

**Single-maintainer note.** Scorecard's Code-Review and Contributors checks will stay low while one person writes and merges everything. That is why the targets above are lower than usual. They go up to ≥ 7.5 when a second maintainer joins.

### 8.4 Keeping the claim current

- **Security-scoped paths:** `modules/core-identity/**`, `modules/core-authz/**`, `apps/server/src/pipeline/**`, `packages/contracts/src/create-route.ts` and `docs/security/**`. Each path is mapped to its ASVS chapters in `tools/asvs-report/scope.ts`. List them in `.github/CODEOWNERS` too, so a future second maintainer is requested automatically.
- **Pull requests:** if a scoped path changes and the matching chapter YAML does not, the `asvs-impact` CI job fails unless the PR has the `asvs-no-impact` label and a reason (rule 10).
- **Releases:** on `release/*` branches, any chapter whose scoped paths changed after its `assessed_commit` is derived as `stale`, and CI fails. Re-assess (or confirm and bump `assessed_commit` with a new second pass) before the release.
- **History:** each re-assessment adds a line to the history table in `docs/security/README.md`: date, commit, chapters, type, assessor, reviewer.
- **Upgrade path:** when a second maintainer or an external reviewer checks a chapter, set `assessment_type` to `peer` or `external` and fill in `reviewer`. The badge then derives `peer-reviewed` or `externally verified`, with no other change.

### 8.5 README badge row

The README carries a generated block between markers. Only the tool writes the ASVS badges:

```markdown
<!-- security-badges:start -->
[![OpenSSF Best Practices](https://www.bestpractices.dev/projects/<BP_ID>/badge)](https://www.bestpractices.dev/projects/<BP_ID>)
[![OpenSSF Scorecard](https://api.scorecard.dev/projects/github.com/<ORG>/<REPO>/badge)](https://scorecard.dev/viewer/?uri=github.com/<ORG>/<REPO>)
[![ASVS 5.0 L2 V6 Authentication](https://img.shields.io/badge/ASVS_5.0_L2_V6_Authentication-self--assessed-brightgreen)](docs/security/asvs/v6-authentication.md)
[![ASVS 5.0 L2 V7 Session Management](https://img.shields.io/badge/ASVS_5.0_L2_V7_Session_Management-self--assessed-brightgreen)](docs/security/asvs/v7-session-management.md)
[![ASVS 5.0 L2 V8 Authorization](https://img.shields.io/badge/ASVS_5.0_L2_V8_Authorization-self--assessed-brightgreen)](docs/security/asvs/v8-authorization.md)
[![ASVS 5.0 L2 V10 OIDC client](https://img.shields.io/badge/ASVS_5.0_L2_V10_OIDC_client-self--assessed-brightgreen)](docs/security/asvs/v10-oauth-oidc.md)
<!-- security-badges:end -->
```

In shields.io badge paths, `_` is a space and `--` is a literal dash. Before G1 the badges show `in progress` (yellow).

### 8.6 When each piece lands

| When | Deliverable |
|---|---|
| During M4 (docs-only PR into `dev`) | This section, rule 10 and the CLAUDE.md section. CI enforcement of rule 10 starts with M4a |
| M4a | See the M4a milestone: repo hardening, Scorecard, Best Practices registration, ASVS tool and all four chapter skeletons, retro-tagging of the M2/M3 tests |
| M5 | New work in scoped paths (login screens, CSRF in forms, cookie handling under `BASE_PATH`) updates the chapter files as it lands |
| G1 | First pass of all four chapters, second pass ≥ 7 days later. Badges derive `self-assessed`. Best Practices passing |
| M18 | Signed images and SLSA provenance |
| G4 | Re-confirmation against `v1.0.0` |

---

## 9. Risks

| Risk | Impact | Mitigation |
|---|---|---|
| Legacy data quality is worse than expected (duplicates, orphan links) | Gate 3 slips | Run the migration dry run early (a partial run at G2), keep the report rules adjustable |
| OIDC provider quirks (LS-AAI, institutional IdPs) | Login broken for some users | Test against Keycloak in CI and against each real IdP on staging before G1 |
| The catch-all UI route limits SvelteKit features (per-route SSR hooks) | Extra effort in M5 | Prototype the shell route in the first week of M5; the fallback is generated filesystem routes produced by a build step |
| Scope creep from the §3 "missing" lists | Parity milestones grow | Each milestone's scope is limited to this plan; extra items go to the backlog after G4 |
| Single developer | Parallel milestones in Phase 4 run in sequence | The plan's dependencies allow M14–M17 in any order |

---

## 10. After G4 (backlog, not planned)

SAML/LDAP auth providers, Matomo/Plausible/GitHub pull adapters, Crossref and Europe PMC citation sources, Jira and GitHub onboarding post-processors, forecasts and targets in analytics, scheduled report emails, a Sigma graph renderer, v2 of the public API.

Peer or external review of the ASVS chapters; extend the ASVS L2 scope to further chapters (V1 encoding, V2 validation, V5 files, V13 configuration, V16 logging); OpenSSF Best Practices silver/gold once a second maintainer exists.
