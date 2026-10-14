# ADR-0037: the public API: one module, the runtime spec, CORS, the audit channel and the token model

- Status: Accepted (sprint 1 of M8: the shell; sprint 2: the data routes, decisions 9 to 12)
- Date: 2026-10-13

## Context

M8 ([m8-sprint-plan.md](../m8-sprint-plan.md)) makes the public API (`/api/v1`) real. Before the first data route the plan asks for a shell: a
module that collects the v1 routes and describes them, an allow-list of browser origins, the audit of every call, per-token limits, and a harness
that tests every v1 route against its own schema. The registrar (`r.public('v1', …)`), the surface prefix and the audit hook already existed and had
no user.

**The prototype of the first hours** (a throwaway fixture module with `GET /api/v1/ping`, a permission and `audit: true`, called through the real
pipeline and the real authoriser) showed, **with no change in `modules/core-identity`, `modules/core-authz` or `packages/contracts/src/route.ts`**:

- 401 without credentials, 403 for a token whose scopes lack the permission or whose owner does not hold it, 200 for `Authorization: Bearer` and for
  `X-API-Key`. The token was in no log line and no table but the one that made it.
- A call that reaches the audit hook is one `api`-channel entry, denied ones included, with the route template, the status and the token's id. The
  audit store already put `surface: 'v1'` entries under `channels.api` ([backlog](../backlog.md), audit follow-ups): nothing to build there but the proof.
- **The per-token claim of the plan did not hold as written.** The rate limit charges two buckets per request, the address and the credential, both of
  the size of the route group. Two tokens behind one address therefore shared the address bucket: with a bucket of 3, the second token was refused
  after the first had used its three. One token from two addresses did not escape its own bucket. Decision 1 below changes the address bucket for
  token calls; the maintainer chose that change over wording the claim down.
- `OPTIONS` had no route, so a preflight was a 404. There was no CORS step.
- A session cookie is accepted on `/api/v1`, as on any route (the plan assumed it was refused).
- What `/docs` draws today: its own renderer. `ui/docs.ts` reads the committed `openapi-v1.json` through the load context and `Docs.svelte` draws a
  table of method, path, summary and permission. No library; nothing in this ADR changes it (sprint 3).

## Decision

### 1. The rate limit: the address bucket of a token call is its own and larger

`pipeline/rate-limit.ts` keeps two buckets per request in the `default` group. For a request that carries a bearer token or an API key the address
bucket is now **`ip-token:`**, separate from the `ip:` bucket of the browsers on that address, and `TOKEN_ADDRESS_FACTOR` (10) times the size of the
group's limit. The credential bucket is unchanged (the hash of the token, the group's own size). So:

- a token never exceeds its own budget, from any number of addresses;
- two tokens behind one address do not share a bucket until together they pass ten times a token's budget, which still stops one address from running
  many tokens at once;
- a program with a token and the people behind the same address no longer use each other's budget (before this, token calls drew from the address
  bucket the browsers use).

The `strict` group (login, registration, token creation, secrets) is **not** scaled, and neither the numbers nor the settings changed. A made-up token
is still charged to the failed-attempt bucket of the address (`authenticate.ts`), which this does not touch. This is the one change to a limit in M8 and
it is in the pull request with the V7 and V8 entries and the tests ([public-api-routes.test.ts](../../apps/server/src/public-api-routes.test.ts)).

### 2. One module, `public-api`, and how v1 routes are collected

`public-api` depends on `core.settings` (the CORS list, the title and the contact of the document) and has `core.audit` and `core.ui-shell` as
optional peers. It imports no module for data and holds no table. A v1 route is declared once, with `createRoute()`, in the module that owns the
data, and registered with `r.public('v1', route, handler)`; the loader checks it like any route. The registrar was already there; `public-api`
collects nothing itself. The `registry` and `full` profiles have it; `core-only` does not need it.

To build the document at runtime the module needs the registered routes, so the kernel's `ModuleContext` gets **`ctx.routes()`**, the routes of every
loaded module on both surfaces, empty until all `routes()` have returned (a handler calls it, `routes()` must not). It is read-only and open to any
module like `ctx.permissions`.

### 3. The runtime document

`GET /api/v1/openapi.json` is built per request from `ctx.routes()` (surface `v1` only) by `generateV1Document()` of `packages/contracts`, **the
function `pnpm openapi:generate` uses for the committed `apps/web/src/generated/openapi-v1.json`**. With default settings the two differ only in
`servers`; a test compares them for the generated `full` profile. The server URL is the origin of the request plus the base path plus `/api/v1`
(a reverse proxy has to pass `Host`). Title, description and contact come from the settings (`specTitle`, `specDescription`, `contactName`,
`contactEmail`, `contactUrl`; the defaults are `V1_DOCUMENT_DEFAULTS`). A test lists the v1 paths of the full profile and fails on a path nobody
listed, so an internal route cannot leak into the contract.

**The one public v1 route.** The plan and the rule "a v1 route is never `public: true`" meant data. The spec holds no record (routes, schemas and the
permission names, all committed to the repository) and must be readable by a tool or a person who has no token yet (`/docs`, a client generator), so
the maintainer decided that it is public, with a `publicReason`. It is the **only** exception: a walker fails when any other v1 route is public, and
`docs/security/authorization.md` says so. It is not audited: an anonymous call that writes a row would let anyone fill the trail; it is rate limited.

### 4. CORS

A pipeline step (`pipeline/cors.ts`, ASVS-scoped) for `/api/v1/*` and nothing else:

- The allowed origins are the setting `corsOrigins` of `public-api` (empty by default: same origin only), read for every request that carries an
  `Origin` header from the settings cache. A change takes effect without a restart; a list that cannot be read allows nobody.
- Each entry is an origin and nothing else (`https://app.example.org`, scheme, host, optional port): the schema refuses a path, a trailing slash, other
  case, a wildcard and `null`, so an entry cannot silently fail to match.
- The comparison is exact. A match gets `Access-Control-Allow-Origin: <that origin>`, `Access-Control-Expose-Headers: Retry-After, X-Request-Id` and
  `Vary: Origin`, on every answer, errors included, so a script can read a 401 or a 429. Any other origin gets `Vary: Origin` and no CORS header; the
  request itself is judged by its token as usual.
- **Never `*`, never `Access-Control-Allow-Credentials`.** A v1 call carries a token, not a cookie. A page that sends the cookie anyway cannot read the
  answer.
- Only a preflight (`OPTIONS` with `Access-Control-Request-Method`) under `/api/v1` is answered here: 204 with a fixed method list (the methods v1 has),
  a fixed header list (`Authorization, X-API-Key, Content-Type, X-Request-Id`, never echoed from the request) and `Max-Age: 600` for an allowed origin,
  403 problem+json without CORS headers for any other. A preflight is not audited and does not draw from a rate bucket.
- `/api/internal` never gets a CORS header and a preflight there is not answered (tested). A session cookie remains accepted on v1 as on every route; the
  lack of `Allow-Credentials` is what keeps another origin from reading such an answer.

### 5. The `api` audit channel

No new writer was needed: a v1 route with `audit: true` passes through `auditRequest`, which tags `surface: 'v1'`, and the store writes it under
`channels.api` (and not at all when that channel is off; the internal calls of the same session stay under `channels.admin`). Tests prove the entry
for 200, 401, 403, 422 and 429, the template, the status and the token id, that the token is in no table and no log line, and the switch. Two facts:

- **A call the rate limit turns away has no token id.** The audit hook wraps the limit, which runs before authentication, by design: a flood of guesses
  must not cost a hash each. The entry has the address, the request id and `anonymous`; recording the token's prefix there is in the backlog.
- **There is no `surface` column.** Internal and v1 calls both have `source = 'api'`, and `apiRetentionDays` applies to both (backlog: per-surface retention).

The size is measured in the backlog (about 231 bytes of row data and about 500 bytes with indexes per call, 1000 calls: 0.5 MB).

### 6. The permission model of a token (ADR-0015, unchanged)

A v1 route names a permission of the module that owns it; one per route family (`registry.organisations.v1.read`, `registry.services.v1.read`, sprint 2),
granted to the role `user` by default (plan §10). A token passes if its **scopes name the permission and its owner holds it**, at every call, so an
administrator withdraws the API from a role without touching the screens, and a deactivated owner or a revoked or expired token is a 401 at once.

### 7. Compatibility

v1 changes are **additive**: the committed document of a released version is the contract; a field is never removed or renamed, a required request
field is never added, and a breaking change goes to v2 with an ADR. The check in CI is a script of our own that compares the document with the one of
the last release tag (sprint 3, plan Decision 6); the first release with a v1 document passes.

### 8. The contract-test harness

`packages/testing/src/v1-contract.ts`: `v1ContractTests(route, context)` registers, for one v1 route, the cases that hold for all of them (never
public, audited, 401, 403, Bearer and `X-API-Key`, the answer against **the route's own zod schema** for the status that came back, the content type
and `X-Request-Id`) and, for a list, the legacy envelope with 0-based pages, a stable order (key, then id) across pages, the last page, a page past the
end, a `pageSize` over the total and a 422 for bad paging. `v1RoutesWithoutContractTest()` is the walker: every v1 route of the generated profile must
be named, as `'GET /path'`, in a `*.contract.test.ts` that calls the harness. Sprint 2 and M9 plug their routes in with one call each.

### 9. The first data routes (sprint 2): providers and services

The legacy API (`/nfdi/api/v1`, its OpenAPI document) is the shape to stay close to: a provider is `{ abbreviation, name }`, a service is `{ abbreviation,
name, category, provider, license, consortia, stage }` with `provider` and `consortia` as abbreviations, `service` and `provider` are single-string
filters, and `pageSize` has no maximum. The routes are declared by the modules that own the data (`registry.organisations`: `GET /providers`;
`registry.services`: `GET /services`, `GET /services/{id}`, `GET /services/{id}/schema-org`), each with its own permission,
`registry.organisations.v1.read` and `registry.services.v1.read`, granted to the role `user`. The row shapes are the tables in the module READMEs; this
is what they add to the legacy rows and what they leave out:

- **Added** (additive, so a legacy client still works): `id`, `public`, `providerId` and `consortiaIds` on a service; `id`, `description`, `website`,
  `rorId`, `sameAs` and `isMember` on a provider; the record adds `description`, `url` and `sameAs`. `category` is not in the row until M9.
- **Never**: the contact point; what the internal read hides (audit columns, `editableFields`, `allowedActions`, member counts, the caller's own
  membership rows); paths below the internal API (`logoUrl`, `iconUrl`).
- **`consortia`** holds the organisations with the role `consortium` only, as the public record and the Schema.org `brand` do, so a role that
  a deployment adds does not enter the contract.

### 10. Filters

- `is_member` is `true` or `false` and nothing else (422). `true` is the providers the token's owner is an approved member of (a manager is a member),
  `false` is **all the others** (defect 15). A token without a user owner is a member of nothing.
- `service` and `provider` take abbreviations separated by commas (at most 50, each at most 64 characters, compared without case). The legacy document
  does not say how a second value was given; a comma is the natural reading of a single string. A service slug cannot contain a comma and an
  organisation abbreviation may, so such an abbreviation cannot be asked for by `provider`; that is the price of staying close to the legacy call.
  Services match their **current** slug only (an old slug is a redirect of the screens, not a name of v1). Several values are OR, the filters
  together are AND.
- **An abbreviation that names nothing is 422**, as the internal catalogue treats an unknown organisation, stage or licence: a typo must not read
  as "no results". (The maintainer's first lean was an empty list, the likely legacy behaviour; the legacy document does not say, and the answer of
  422 is the one the rest of the API gives.) `stage` and `license` are the catalogue's own filters with the same rule; `:none` is internal syntax and is
  refused in v1.
- An unknown query parameter is 422 (the paging schema is strict); the catalogue's `q`, `sort`, `dir`, `locale`, `consortium` are not v1 parameters.

### 11. Sort and paging

Providers: lower-cased abbreviation, then id. Services: lower-cased current slug, then id (the catalogue's `slug` sort). `pageSize` defaults to
**100** and is at most 100; a larger value is 422 and is not clamped, so a legacy client that sent `pageSize=1000` learns of the change at once instead of
receiving fewer rows than it asked for. `page` is 0-based. `totalCount` is the size of the **filtered** set, `totalPages` is `ceil(totalCount / pageSize)`.

### 12. How the service layer serves a v1 read

A v1 handler calls one service method (`listProvidersV1`, `listV1`, `getV1`, `schemaOrgV1`), which requires the v1 permission again
(`ctx.authz.require`) and applies the field rules of the internal read; the trusted `…AsSystem` reads stay for jobs and are not called by a handler. The
catalogue query function serves the services list; the one change to it is an optional `slugs` condition (the `service` filter), so there is no
second query that could drift from the screen. A service that is not public is returned to a token whose owner may read it internally, with its
`public` flag, because the internal read gives every holder of `registry.services.service.read` every service.

## Consequences

- A v1 consumer needs a token, and a browser page needs its origin in the allow-list. Both are settings of one module that an administrator can reach.
- The kernel context grows by one read-only function.
- One limit changed (the address bucket of token calls). Everything else in the pipeline is new code for `/api/v1` only.
- ASVS 5.0 has CORS (V3) and anti-automation (V2) outside the four chapters this project claims. The CORS and rate-limit rules are proved by tests and
  documented here and in `docs/security/authorization.md`, and the V7 and V8 entries cite the requirements they do touch (7.2.1, 7.4.1, 8.1.1, 8.2.1,
  8.3.1).

## Alternatives rejected

- **Swagger UI or a generated client** for `/docs`: a new dependency and a CSP change (plan Decision 4).
- **Serving the spec from the server mount** (like `/healthz`): the document would then not come from the same registrar as the routes it describes.
- **Wildcard origins, or reflecting the request's `Origin`:** it makes the allow-list meaningless.
- **Authenticating before the rate limit** so that a 429 can name the token: it costs a hash per guessed token.
