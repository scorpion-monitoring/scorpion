# @scorpion/contracts

What routes, requests and errors look like, shared by the server, the modules and the web app.

- `createRoute()` wraps `createRoute` of `@hono/zod-openapi`. A route **must** declare `permission` (an id of the module that owns the route) or `public: true` with a `publicReason`; the types enforce it, and the kernel checks it again when the module registers the route. It documents the standard problem responses (401, 403, 422, 500). `rateLimit: 'strict'` and `maxBodyBytes` (an upload's larger request body limit; the default is 1 MiB) are optional.
- The list envelope of the v1 API: `listEnvelope(item)`, `paginationQuery({ defaultPageSize, maxPageSize, maxPage })`, `paginate(query, totalCount, rows)` and `pageOffset(query)`. Pages are counted from 0. Invalid page parameters are rejected, never clamped.
- RFC 9457 problem details: `problemSchema`, `problemFor(error, requestId)`, `problemResponse(problem)` and the domain errors `NotFound` (404), `Conflict` (409), `Forbidden` (403), `Unauthorized` (401) and `Invalid` (422, with per-field `errors`). Services throw these; the server's error mapper turns them into `application/problem+json`.
- `generateOpenApiDocument(routes, info)` builds an OpenAPI 3.1 document, with `x-permission` / `x-public` on each operation. The public endpoint that serves it comes with M8.

- `url(basePath, path)`, `stripBase()`, `isLocalPath()`, `basePrefix()` (`@scorpion/contracts`, also `@scorpion/contracts/url`): the one place that joins `BASE_PATH` and a path, for any number of segments (defect 11). `url()` refuses an absolute URL, `//host`, a backslash and a dot segment; `isLocalPath()` is the open-redirect check for a `returnTo`.
- `@scorpion/contracts/client`: the typed client of the internal API. `createApiClient({ basePath, origin?, csrfToken?, cookie?, headers? })` is `openapi-fetch` over `src/generated/schema.ts`, with the base path from `url()`, `X-CSRF-Token` on unsafe methods and the caller's cookie forwarded on the server. `unwrap(call)` returns the data or throws an `ApiError` (status, problem+json, `retryAfterSeconds` of a 429, and `type`, the stable problem type such as `reauthentication-required` or `account-pending`, `undefined` for `about:blank`). `pnpm openapi:generate` writes `schema.ts` from the routes of the `full` profile (no database) and `apps/web/src/generated/openapi-v1.json`; `pnpm check` fails on a diff, so the client cannot drift from the routes ([ADR-0027](../../docs/adr/0027-web-shell-catch-all-proxy-and-typed-client.md)).
- Types of a module's pages (`UiRoute`, `UiLoadContext`, `UiMessages`), see [core.ui-shell](../../modules/core-ui-shell/README.md).

See the [kernel guide](../kernel/README.md) for how routes fit into a module.
