# Scorpion Rebuild: Overall Architecture

Sep 30, 2026 · @Manuel Feser

## Open questions in FEATURES.md

FEATURES.md has no open questions left: it has no open-questions section, no TBD markers and no items waiting on a decision. Every ⚠ item already says what the intended behaviour is. So this draft goes ahead.

The spec does leave five architecture-level choices unstated. This draft assumes the following. Each one is easy to change before implementation starts:

| # | Decision | Assumption in this draft |
| --- | --- | --- |
| A1 | Language and stack | TypeScript end to end, keeping SvelteKit 5, Drizzle and PostgreSQL from the current app |
| A2 | How plugins are loaded | Build-time composition: plugins are workspace packages chosen per deployment profile, and switched on or off at runtime through config. Confirmed. Adding or removing a plugin means rebuilding that profile's image and restarting the instance. Runtime loading is out of scope |
| A3 | Tenancy | One instance per deployment (single-tenant). "Multi-tenancy readiness" means all branding comes from settings |
| A4 | Frontend and API split | The API is a separate server package. The SvelteKit UI talks to it only through the generated typed client, so an instance can also run headless |
| A5 | Data from the current app | A one-time migration script moves existing data into the new schema; there is no dual-running period |

## Architecture principles

The rebuild is a **modular monolith**: one deployable server and one database, split internally into modules with enforced boundaries. This gives the pluggability of FEATURES.md §2 without the cost of running microservices for a small research-infrastructure team.

1. **Modules own everything about their feature.** Each module brings its tables, domain services, permissions, routes, settings schema, jobs, events and UI contributions. Removing a module from a profile removes all of it.
2. **One contract per module, declared once.** Routes are defined with Zod schemas. The same definition produces server-side validation, the OpenAPI spec and the typed client, so the internal and public APIs cannot drift apart (§4.2, §4.4).
3. **Domain services are the only way to change data.** The UI, the internal API, the public API, jobs and import adapters all call the same service functions. Each service runs in a transaction and checks permissions itself (§4.1–4.3).
4. **Deny by default.** A route without a declared permission does not register. Ownership checks (provider members, own tokens) live in one policy layer.
5. **Modules talk through interfaces and events, never through each other's tables.** A module may call another module's public service API or subscribe to its domain events. Cross-module foreign keys are allowed only toward core and declared dependencies.
6. **Configuration is data.** Vocabularies (stages, thematic categories, necessity levels, sender types, aggregates), branding and wizard steps are stored and edited, not hard-coded (§4.5, §4.6, §4.10).
7. **Postgres is the only required stateful dependency.** Jobs, sessions, rate limits and caches all run on Postgres, so a minimal deployment is two containers.

## System overview

&#91;embedded content: system context · 3 client types, 1 server, 5 backing services\]

All three kinds of client reach the same server through one request pipeline. Inside, plugins sit on the six core modules and the kernel. PostgreSQL is the only backing service a deployment must have.

## Technology stack

The stack keeps what works today (SvelteKit 5, Drizzle, PostgreSQL, DaisyUI) and adds only what the cross-cutting requirements need.

| Concern | Choice | Why |
| --- | --- | --- |
| Runtime | Node 24 LTS (to 26 LTS in M18), TypeScript (strict), pnpm workspaces | One language across server, UI and plugins; workspaces give each module its own package |
| HTTP API | Hono + `@hono/zod-openapi` | Typed routes that produce the OpenAPI spec and validation from one Zod definition |
| Validation | Zod, with `zod-to-json-schema` | Shared by server, client, wizard steps and settings forms (§4.4) |
| Database | PostgreSQL 16 + Drizzle ORM and Drizzle migrations | Kept from today; each module owns its schema file and migration folder |
| Jobs | pg-boss | Queue and cron on Postgres, no Redis needed (§4.7) |
| Auth | `oslo` / `arctic` for OIDC (PKCE, nonce), `@node-rs/argon2`, opaque DB-backed sessions | Fixes defects 4 and 5 by design |
| UI | SvelteKit 5 (adapter-node), Tailwind + DaisyUI | Kept from today; the UI shell hosts module-contributed routes and widgets |
| Charts | Apache ECharts behind a chart adapter | Replaces Plotly for smaller bundles and theme-aware colours; the adapter keeps it swappable |
| Graph | Cytoscape behind a renderer adapter | Kept; Sigma stays a possible alternative plugin |
| Email | Nodemailer transport behind the notifications interface; MJML or Svelte templates | Authenticated SMTP, templates per event |
| Sanitising | DOMPurify (Markdown and SVG), `sharp` for raster images | Security baseline (§4.9) |
| Observability | pino (structured logs), OpenTelemetry, Prometheus `/metrics` | §3.20 gaps |
| Tests | Vitest, Testcontainers (Postgres), Playwright | §4.11 |

The API and the UI run as two processes in one container image by default. Small deployments can use a single process in which SvelteKit mounts the Hono app, which the code supports without changes.

## Module system

Every module, core or plugin, exports one `defineModule()` manifest. The kernel reads the manifests of the modules in the active profile, checks their dependencies and wires them together at startup.

```ts
export default defineModule({
  id: 'kpi.ingestion',
  version: '1.0.0',
  dependsOn: ['kpi.framework', 'registry.services'],
  permissions: {
    'measurement.submit': { scope: 'service', description: 'Submit KPI values for a service' },
  },
  settings: ingestionSettingsSchema,       // Zod → JSON Schema → admin form
  schema: () => import('./db/schema'),      // Drizzle tables, prefixed kpi_ingestion_*
  migrations: './migrations',
  services: (ctx) => createIngestionService(ctx),
  routes: (r) => { r.internal(submitRoute); r.public('v1', measurementsRoutes); },
  jobs: [],
  events: { emits: ['measurement.recorded'], on: {} },
  contributes: {
    'ingestion.adapter': [formAdapter, csvAdapter, xlsxAdapter],
    'ui.nav': [{ section: 'services', label: 'Data Submission', href: '/submit', permission: 'measurement.submit' }],
  },
  ui: () => import('./ui'),                 // Svelte routes and widgets
});
```

**Lifecycle.** The kernel runs these steps in order at startup:

1. Load the profile and resolve the dependency graph. It refuses to start on a missing dependency or a cycle.
2. Run each module's migrations in dependency order.
3. Register permissions, settings schemas, events and registry contributions.
4. Build each module's services with a context that holds only the services of its declared dependencies.
5. Mount routes, schedule jobs, emit `system.ready`.

**Registries (extension points).** A module can declare a registry, and any module that depends on it can contribute entries. These are the registries from FEATURES.md §2 and §6:

| Registry | Owner | Examples of contributions |
| --- | --- | --- |
| `auth.provider` | core.identity | local, oidc; later SAML, LDAP, LS-AAI |
| `auth.approvalPolicy` | core.identity | manual, auto-by-email-domain, invite-only |
| `notify.transport` | core.notifications | smtp, webhook, none |
| `notify.template` | core.notifications | one per event and locale |
| `ui.nav`, `ui.widget`, `ui.theme` | core.ui-shell | sidebar entries, dashboard cards, brand themes |
| `vocabulary` | core.settings | stages, thematic categories, necessity levels, sender types, aggregates |
| `org.type` | registry.organisations | provider, consortium, funder |
| `service.fieldType`, `service.wizardStep` | registry.services | license, provider, ORCID, ROR, EDAM, kpi-set |
| `kpi.valueType` | kpi.framework | integer, float, text, duration, percentage, enum |
| `ingestion.adapter` | kpi.ingestion | form, CSV/TSV, XLSX, REST, Matomo pull |
| `analytics.aggregate`, `analytics.score`, `analytics.exporter` | kpi.analytics | sum/avg/min/max, MAPE, CSV/PDF/XLSX |
| `maturity.visualisation` | maturity | radar, heatmap |
| `onboarding.postProcessor` | onboarding | webhook, email, Jira, GitHub issue |
| `biblio.citationSource` | bibliometrics | OpenAlex, Crossref, Europe PMC |
| `graph.nodeProvider`, `graph.renderer` | network-graph | nodes per module, Cytoscape |
| `backup.target` | backup | S3, filesystem |

**Enforced boundaries.** An ESLint boundaries rule and TypeScript project references stop a module from importing another module's internals. It may only import the other module's `public` entry, and only if it declares that module as a dependency.

**UI contributions.** Modules do not add SvelteKit filesystem routes. Each module registers its pages in the manifest (`ui.routes: [{ path, permission, load, component: () => import('./ui/Page.svelte') }]`). One catch-all route in the shell (`/[...path]`) resolves the path, checks the permission, runs `load` and renders the component. Widgets and nav entries use the same registry.

The registry is there for central permission checks and navigation filtering, not for runtime loading. Adding a plugin means adding its package to the profile, rebuilding the image in CI, and restarting.

## Inside a module

Every module has the same four layers. Each layer may call only the layer below it.

1. **UI** (`ui/`): Svelte routes, components and widgets. Calls the API only through the generated client.
2. **Transport** (`routes/`): Hono route definitions with Zod input and output schemas and a required `permission`. Handlers are thin: they parse, call one service method and map errors to HTTP (404, 409, 422, never a raw 500).
3. **Domain services** (`service/`): business rules. Every write opens a transaction with `ctx.db.tx()`, calls `ctx.authz.require(actor, permission, resource)`, validates against the vocabulary and emits domain events after commit. Jobs and ingestion adapters call this layer too.
4. **Persistence** (`db/`): Drizzle tables and repository functions. Nothing outside the module touches these.

```text
modules/kpi-ingestion/
  module.ts            # defineModule manifest
  public.ts            # types and service interface other modules may import
  db/schema.ts         # kpi_ingestion_* tables
  db/repo.ts
  migrations/
  service/ingestion.ts # submit(), upsertBatch(), validateAgainstKpiSet()
  adapters/csv.ts      # ingestion.adapter contributions
  routes/internal.ts
  routes/v1.ts
  ui/                  # +page.svelte files, widgets
  test/
```

This layering fixes defect 6 directly: the form, the file upload and `POST /api/v1/measurements` all end in the same `upsertBatch()`, which enforces the `(service, indicator, month)` uniqueness and the service's allowed KPIs.

## Core modules

The kernel plus six core modules are present in every profile. Together they fix the security and configuration defects (1, 3, 4, 5, 11, 12, 13) before any feature module exists.

| Module | Responsibilities | Key design decisions |
| --- | --- | --- |
| `kernel` | Module loader, DI context, event bus, job scheduler facade, config from env | In-process event bus with an outbox table, so events survive a crash between commit and delivery |
| `core.identity` | Users, auth methods, sessions, PATs, approval, profile | Opaque session IDs (256-bit, stored hashed) checked on every request, so logout revokes at once. PATs as `scp_<prefix>_<secret>`: lookup by prefix, argon2id hash per token, expiry and scopes. One user can link several identities. Bootstrap admin via a CLI command or first-run token, not "first registrant" |
| `core.authz` | Permission registry, roles, policies | Roles map to permission sets, stored as data (Admin, Reviewer, User seeded). Resource-scoped permissions resolve through policy functions that modules register, such as "member of the service's provider" |
| `core.settings` | Instance settings, user preferences, secrets, vocabularies | Three stores: `settings` (JSON validated by each module's schema), `user_preferences`, `secrets` (AES-256-GCM with a key from env or KMS; values write-only in the UI). Admin forms generated from JSON Schema, as today |
| `core.notifications` | Event → template → transport, in-app inbox, user preferences | Sends go through a pg-boss queue with retries and a visible status. The transport is rebuilt when settings change |
| `core.audit` | Append-only log of public API calls and all admin or permission-relevant actions | Written by middleware and by `ctx.audit()` in services; filters, CSV export, retention job |
| `core.ui-shell` | Layout, navigation, dashboard grid, theming, branding, legal pages, error pages | Navigation filtered by permission. Public routes (legal, API docs, onboarding) declared explicitly. Base path handled by one `url()` helper |

## Plugin modules

The plugins follow the module map in FEATURES.md §2, with one change: `registry.services` no longer depends on `kpi.framework`. Instead, `kpi.framework` contributes the `kpi-set` wizard step. This removes the dependency cycle in §2 (`services → kpi → services`) and makes a registry-only deployment possible.

| Plugin | Owns (tables) | Emits | Listens to | Notable design |
| --- | --- | --- | --- | --- |
| `registry.organisations` | organisation, organisation\_type, membership (state machine) | `membership.requested`, `.decided` | none | One `organisation` table typed by `org.type`, replacing separate provider and consortium tables |
| `registry.services` | service, service\_organisation, service\_field\_value | `service.created`, `.updated` | none | Metadata schema and wizard steps loaded from config (successor of `steps.json`). The catalogue facets are computed in SQL over the filtered set |
| `kpi.framework` | indicator, kpi\_set, kpi\_set\_indicator, service\_extra\_indicator, evaluation | `kpiSet.changed` | `service.created` | Value types are validators from `kpi.valueType`. Effective KPI set as one query function |
| `kpi.ingestion` | measurement (unique per service, indicator, month), ingestion\_run | `measurement.recorded` | none | Every adapter produces `{indicator, month, value}[]`, then `upsertBatch()`. Preview and dry-run before commit. Import templates generated per service |
| `kpi.analytics` | dashboard\_preference | none | none | Pure calculation library (change %, MAPE, aggregates, HH-MM-SS to seconds) with unit tests. Exporters run as jobs for large PDFs |
| `kpi.impact` | none (read model) | none | `measurement.recorded` | Materialised yearly and monthly aggregates per consortium, refreshed on events |
| `maturity` | model, domain, topic, level (stable IDs, versioned) | `model.published` | none | Assessments reference a model *version*, so editing a model never changes past answers |
| `onboarding` | application (status: submitted, under\_review, approved, declined), application\_answer | `application.submitted`, `.decided` | none | Public form with rate limit, CAPTCHA and applicant email. Approve creates the Service through the registry's service API |
| `bibliometrics` | publication, citation\_snapshot | `citations.updated` | `service.updated` | Scheduled refresh stores history. Can write a Bibliographic KPI through the ingestion API |
| `network-graph` | none | none | none | Nodes and edges contributed by each module; filter, search, legend, click-through |
| `announcements` | announcement, announcement\_read | `announcement.published` | none | Markdown (sanitised), audience by role or organisation, expiry |
| `backup` | backup\_run | `backup.completed` | none | pg\_dump or JSON export, envelope-encrypted, S3 or filesystem target, retention, restore CLI |
| `public-api` | none | none | none | Mounts the `v1` routes of every active module, aggregates OpenAPI, serves Swagger UI publicly, applies per-token rate limits and CORS allow-list |

## Data architecture

All modules share one PostgreSQL database, but each owns a table prefix and its own migration folder. The rules below cover the model changes recommended in FEATURES.md §1.2.

- **Ownership and keys.** Tables are prefixed by module (`identity_user`, `kpi_measurement`). Primary keys are UUIDv7, which sort by time. Public slugs (service abbreviation) are unique columns, not keys, so renaming a service never breaks references.
- **Cross-module references.** Foreign keys may point only to core tables or to a declared dependency. Optional integrations (bibliometrics writing a KPI) go through the other module's service API, never through a foreign key.
- **Vocabularies as data.** One `vocabulary` + `vocabulary_term` pair (key, label per locale, sort order, active flag) replaces the pg enums for stages, thematic categories, necessity, sender types and aggregates. Seeds ship with today's values, and `TERM` is added as a proper stage (defect 9).
- **Typed measurements.** `kpi_measurement` stores `value_numeric`, `value_text` and `value_json`, filled according to the indicator's value type, with a unique index on `(service_id, indicator_id, period)`. `period` is a `date` normalised to the month end.
- **State machines as columns.** Membership, application and backup-run status are text columns checked against allowed transitions in the service layer, with a `status_changed_at` column and an audit entry for each change.
- **No correctness-critical SQL views.** The `service_view` bug (defect 2) came from a hand-written view. Read models are either query functions with tests, or materialised views refreshed by jobs (`kpi.impact`).
- **Files.** Icons, avatars and logos move out of data URLs into a `blob` table (bytea, content hash, MIME, size limit), or into S3 when configured. They are served through `/files/:hash` with a strict `Content-Security-Policy`.
- **Migrations.** They run automatically at startup, in dependency order, under an advisory lock. Seeds (vocabularies, default roles, example KPI sets) are idempotent and belong to the module that owns the table.

## API architecture

There are two API surfaces built from the same route definitions and the same services. They differ only in authentication, stability promise and rate limits.

|  | Internal API | Public API |
| --- | --- | --- |
| Path | `/api/internal/*` | `/api/v1/*` (later `/api/v2/*`) |
| Caller | The SvelteKit UI | Scripts, pipelines, other portals |
| Auth | Session cookie (`__Host-` prefix, Secure, SameSite=Lax) + CSRF token | `Authorization: Bearer <PAT>` (keep `X-API-Key` as an alias for v1 compatibility) |
| Stability | May change with each release | Semver: additive changes only within a major version |
| Rate limit | Per session, generous | Per token and per IP, from settings |
| CORS | Same origin only | Allow-list from settings |
| Audit | Admin and permission-relevant actions | Every call |

**One route definition.** A route is declared once with `createRoute({ method, path, request, responses, permission, audit })`. The `public-api` module collects the routes each active module marks as public and generates `/api/v1/openapi.json` at runtime. That spec only lists routes of modules that are switched on. Swagger UI at `/docs` is public.

**Conventions** (fixing defect 15):

- One envelope for every list. v1 keeps today's shape for existing clients (`{ metadata: {currentPage, pageSize, totalCount, totalPages}, result: [...] }`, 0-based pages) but now uses it on every endpoint, including measurements. Ordering is always stable: sorted by a key, then by id.
- Errors use RFC 9457 problem details (`type`, `title`, `status`, `detail`, `errors[]` for validation).
- Filters are explicit query parameters, validated by Zod. Unknown parameters are rejected.
- Writes are idempotent where it makes sense: measurement uploads upsert, and an `Idempotency-Key` header is honoured on POST.

The UI uses a typed client generated from the same definitions (`hono/client`), so a changed route breaks the UI build instead of failing at runtime.

## Security architecture

Security is enforced by the kernel's request pipeline, so no module can opt out of it. Every request passes the same six steps, in this order:

1. **Transport and headers:** HTTPS behind the proxy (`ORIGIN` and a trusted-proxy list), HSTS, a strict CSP without `unsafe-inline`, `X-Content-Type-Options`, frame denial.
2. **Rate limit:** a Postgres-backed token bucket per IP and per token. Stricter buckets for login, register, onboarding submission and token creation.
3. **Authentication:** a session cookie or a bearer PAT resolves to an `Actor` (user, roles, scopes). Anonymous access is allowed only on routes marked `public: true`.
4. **Validation:** Zod parses params, query and body with size limits. Anything that fails returns 422, never 500.
5. **Authorisation:** `permission` from the route definition is checked against the actor's roles. Resource permissions (`scope: 'service'`) are checked again in the service layer against the loaded resource, so a direct service call from a job is protected too.
6. **Audit:** the outcome is written to `core.audit` if the route or the permission asks for it.

**Fixes for the listed gaps (FEATURES.md §4.9 and §5):**

| Gap | Design |
| --- | --- |
| OIDC without PKCE, nonce or id\_token checks (defect 5) | `arctic` with PKCE (S256), nonce, and id\_token signature, issuer, audience and expiry checks via JWKS. Login state kept for 10 minutes, deleted on use, holding only the provider id |
| Sessions not revocable (defect 4) | Opaque session ids looked up on every request (with a short in-memory cache), sliding expiry, "log out everywhere" |
| PATs (defect 3) | Prefix lookup, per-token hash, expiry, scopes (`read:kpi`, `write:kpi`…), last-used, rotation |
| Privilege escalation (defect 1) | Deny-by-default routes. Role changes need `identity.role.assign`, and a user can never change their own role or approve their own membership |
| Plain-text secrets | `core.settings` secrets store, AES-256-GCM, key from `SECRETS_KEY` or KMS, rotation command |
| SVG and image uploads | Size limits; raster images re-encoded with `sharp`; SVG sanitised with DOMPurify and served with `Content-Disposition` and a sandboxing CSP |
| Markdown (legal pages, announcements) | Rendered on the server and sanitised with DOMPurify |
| Public onboarding form | Rate limit, CAPTCHA plugin slot (ALTCHA or Friendly Captcha, both GDPR-friendly), applicant email confirmation |

## Jobs, events and external adapters

**Events.** A service writes its domain event to an `outbox` table in the same transaction as the change. A dispatcher delivers it to in-process subscribers and, when enabled, to outbound webhooks. Events are small and versioned (`measurement.recorded@1`: serviceId, indicatorId, period). Subscribers must be idempotent.

**Jobs.** Modules declare jobs in their manifest (`{ name, schedule?, handler, retry, timeout }`). pg-boss runs them, and an admin page lists runs with status, duration and errors, with a "run now" button (§4.7).

| Job | Module | Default schedule |
| --- | --- | --- |
| Backup | backup | Daily, 02:00 |
| Citation refresh | bibliometrics | Weekly |
| KPI reporting reminder | kpi.ingestion | Monthly, 5 days after month end |
| Audit log retention | core.audit | Daily |
| Expired sessions, login states and tokens cleanup | core.identity | Hourly |
| Impact aggregates refresh | kpi.impact | On event, plus nightly |
| Notification delivery | core.notifications | On event, with retry |

**External adapters** (§4.8). Each outside service sits behind an interface in `packages/integrations`, with a timeout (5 s default), retry with backoff, a cache stored in Postgres, and a stub for tests:

| Adapter | Used by | Cache |
| --- | --- | --- |
| SPDX licence list | registry.services, kpi.impact | 24 h, with a bundled fallback copy |
| DOI content negotiation (CSL-JSON) | bibliometrics | Permanent per DOI |
| OpenAlex (later Crossref, Europe PMC) | bibliometrics | Snapshot per refresh run |
| GitHub licence badge | core.ui-shell | Replaced by a setting, so the adapter goes away |

## Deployment profiles and operations

A deployment profile is a small file (`profiles/<name>.ts`) that lists the modules to include. The build bundles only those modules, and the startup refuses to run if a dependency is missing. The three example deployments from FEATURES.md map to profiles as follows (● = included, ○ = optional):

| Module | `full` | `denbi-registry` | `nfdi-onboarding` | `kpi-tracker` |
| --- | --- | --- | --- | --- |
| Core (all six) | ● | ● | ● | ● |
| registry.organisations | ● | ● | ● | ● |
| registry.services | ● | ● | ● | ● |
| kpi.framework, kpi.ingestion, kpi.analytics | ● | ● | ○ | ● |
| kpi.impact | ● | ● |  | ○ |
| maturity, onboarding | ● | ○ | ● |  |
| bibliometrics | ● | ● |  | ○ |
| network-graph | ● | ● |  |  |
| announcements | ● | ● | ○ | ○ |
| backup | ● | ● | ● | ● |
| public-api | ● | ● | ○ | ● |

The `kpi-tracker` profile needs `registry.services` because KPIs attach to services. It can hide the catalogue UI through a setting.

**Runtime shape.** One container image per profile (`scorpion:<version>-<profile>`) with the API and UI, plus a worker mode (`scorpion worker`) that runs jobs. Small instances run the worker inside the web process. Only PostgreSQL is required; S3 and SMTP are optional.

**Operations:**

- `/healthz` (process alive) and `/readyz` (database and migrations ready).
- Structured JSON logs with request id and actor id; OpenTelemetry traces; Prometheus `/metrics`.
- A CLI (`scorpion migrate | seed | create-admin | rotate-secrets | backup | restore`).
- Config: env for bootstrap and secrets (`DATABASE_URL`, `SECRETS_KEY`, `ORIGIN`, `BASE_PATH`, `PROFILE`), everything else in settings. The legacy `PUBLIC_*` variables become branding settings.
- CI (GitHub Actions): lint, type check, unit and integration tests, OpenAPI diff against the last release, and one image build per profile.

## Repository layout

One pnpm monorepo. Each module is its own workspace package, so its boundaries are checked by the build.

```text
scorpion/
  apps/
    server/              # Hono app: kernel bootstrap, pipeline, CLI, worker entry
    web/                 # SvelteKit shell: layout, nav, dashboard grid, theme; mounts module UIs
  packages/
    kernel/              # defineModule, loader, DI context, event bus, outbox, jobs facade
    contracts/           # createRoute helper, envelope and problem schemas, generated client
    ui-kit/              # Svelte components: SchemaForm, DataTable, Wizard, Facets, charts adapter
    integrations/        # SPDX, DOI, OpenAlex adapters with cache and stubs
    testing/             # Testcontainers setup, factories, contract-test helpers
  modules/
    core-identity/  core-authz/  core-settings/  core-notifications/  core-audit/  core-ui-shell/
    registry-organisations/  registry-services/
    kpi-framework/  kpi-ingestion/  kpi-analytics/  kpi-impact/
    maturity/  onboarding/  bibliometrics/  network-graph/  announcements/  backup/  public-api/
  profiles/
    full.ts  denbi-registry.ts  nfdi-onboarding.ts  kpi-tracker.ts
  tools/
    migrate-legacy/      # one-time import from the current Scorpion database
  docker/  .github/workflows/
```

The `ui-kit` package is where today's declarative pieces live on in general form: `SchemaForm` renders any JSON Schema (settings, wizard steps, onboarding additional fields), and `Wizard` takes a step config and the `service.fieldType` registry.

## Testing, migration and roadmap

**Testing** (§4.11):

- **Unit:** the analytics calculation library (change %, MAPE, month-end normalisation, yearly aggregates, duration parsing) and every value-type validator. These are pure functions with table-driven tests.
- **Integration:** each module's services against a real Postgres (Testcontainers), including permission denials and transaction rollback.
- **Contract:** every public route is tested against its OpenAPI schema. CI fails if the v1 spec has a breaking diff against the last release.
- **Security regression:** one test per defect in FEATURES.md §5, so none of them can come back.
- **End to end:** Playwright runs the main journeys per profile: register and approval, create a service, submit KPIs, dashboard, onboarding application and review.

**Migration from the current app.** `tools/migrate-legacy` reads the old database and writes through the new domain services, so all validation applies. On the way it deduplicates measurements (the latest insert wins), repairs consortium links, moves data-URL images into blobs, moves plain-text secrets into the secrets store, and gives every maturity row a stable id. PAT hashes cannot be converted, so users are emailed to create new tokens. A dry-run mode reports every row it would drop or change.

**Roadmap.** Four phases, each ending with a working, deployable profile:

&#91;embedded content: roadmap · 4 phases, 4 gates\]

Security comes first, so later phases build on a pipeline that already denies by default. Each phase leaves a profile you can deploy; FEATURES.md gives no dates, so none are set here.
