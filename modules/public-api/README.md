# public-api

The shell of the public API (`/api/v1`): it describes the v1 routes that the loaded modules register, and holds the settings that decide who may call
them from a browser. It has no table, no service and no data. A v1 route is declared once, with `createRoute()`, in the module that owns the data, and
registered with `r.public('v1', route, handler)`; this module only collects and describes them. Decisions: [ADR-0037](../../docs/adr/0037-public-api.md).

Status: M8 sprint 1. No data route yet (providers and services are sprint 2).

## Manifest

| Part                     | Value                                                                                                                     |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------- |
| id                       | `public-api`                                                                                                              |
| table prefix             | none: the module has no tables                                                                                            |
| dependencies             | `core.settings`; optional peers `core.audit` and `core.ui-shell` (neither is imported). It imports no module for its data |
| permissions              | none: the one route it owns is public, and every route of the other modules names a permission of its own module          |
| settings                 | `corsOrigins`, `specTitle`, `specDescription`, `contactName`, `contactEmail`, `contactUrl`, see below                     |
| routes                   | `GET /api/v1/openapi.json` (public, not audited)                                                                          |
| jobs, events, registries | none                                                                                                                      |
| profiles                 | `registry` and `full`                                                                                                     |
| public                   | `public.ts` exports `isOrigin`, `MAX_CORS_ORIGINS` and the route definition `specRoute` (for its contract test)           |

## Settings

Edited at `/admin/settings/public-api` (permission of `core.settings`); a change is read at once, with no restart.

| Key                                         | Default                      | Meaning                                                                                                                                                                          |
| ------------------------------------------- | ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `corsOrigins`                               | `[]` (same origin only)      | Origins whose pages may call `/api/v1` from a browser, each `scheme://host[:port]` and nothing else: no path, no trailing slash, no wildcard, lower case. At most 50. See "CORS" |
| `specTitle`                                 | `Public API`                 | `info.title` of the document                                                                                                                                                     |
| `specDescription`                           | `The public API, version 1.` | `info.description`                                                                                                                                                               |
| `contactName`, `contactEmail`, `contactUrl` | none                         | `info.contact`; an empty field is left out                                                                                                                                       |

## The document

`GET /api/v1/openapi.json` is an OpenAPI 3.1 document of the v1 routes of the loaded profile, built per request from `ctx.routes()` by the generator that
`pnpm openapi:generate` uses for `apps/web/src/generated/openapi-v1.json`. With default settings it equals the committed file except for `servers`, which
is the origin of the request plus the base path plus `/api/v1` (a reverse proxy must pass `Host`). Each operation names the permission it needs in
`x-permission`. The route is public and not audited (ADR-0037); everything else under `/api/v1` needs a token.

## CORS

Handled by the pipeline (`apps/server/src/pipeline/cors.ts`), configured here. Only `/api/v1/*` answers a preflight. A request from an allowed origin
gets `Access-Control-Allow-Origin` with **that origin** (never `*`), `Vary: Origin` and `Access-Control-Expose-Headers: Retry-After, X-Request-Id`, also on
errors. `Access-Control-Allow-Credentials` is never sent. Any other origin gets no CORS header (the call is still judged by its token). `/api/internal`
never gets a CORS header.

## Tokens, limits and the audit trail

- A call needs a personal access token (`Authorization: Bearer` or `X-API-Key`) whose scopes name the route's permission and whose owner holds it.
- The rate limit: a token has its own bucket (the `default` group of `core.settings`); the address bucket of token calls is ten times larger and separate from
  the browsers' bucket on that address.
- A v1 route sets `audit: true`; every call (allowed, 401, 403, 422, 429) is an entry in the `api` channel of `core.audit` with the route template, the
  status and the token's id. A call refused by the rate limit has no token id. The size is about 0.5 MB per 1000 calls with indexes.

## Contract tests

`packages/testing/src/v1-contract.ts`. A module that registers a v1 route adds a `*.contract.test.ts` that calls `v1ContractTests(route, context)` and
names the route as `'GET /path'`; `apps/server/src/v1-contract-walker.test.ts` fails for a v1 route of the generated profile without one. The
spec route's own is `apps/server/src/public-api.contract.test.ts`.
