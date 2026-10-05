# @scorpion/contracts

What routes, requests and errors look like, shared by the server, the modules and (from M5) the web app.

- `createRoute()` wraps `createRoute` of `@hono/zod-openapi`. A route **must** declare `permission` (an id of the module that owns the route) or `public: true` with a `publicReason`; the types enforce it, and the kernel checks it again when the module registers the route. It documents the standard problem responses (401, 403, 422, 500). `rateLimit: 'strict'` and `maxBodyBytes` (an upload's larger request body limit; the default is 1 MiB) are optional.
- The list envelope of the v1 API: `listEnvelope(item)`, `paginationQuery({ defaultPageSize, maxPageSize, maxPage })`, `paginate(query, totalCount, rows)` and `pageOffset(query)`. Pages are counted from 0. Invalid page parameters are rejected, never clamped.
- RFC 9457 problem details: `problemSchema`, `problemFor(error, requestId)`, `problemResponse(problem)` and the domain errors `NotFound` (404), `Conflict` (409), `Forbidden` (403), `Unauthorized` (401) and `Invalid` (422, with per-field `errors`). Services throw these; the server's error mapper turns them into `application/problem+json`.
- `generateOpenApiDocument(routes, info)` builds an OpenAPI 3.1 document, with `x-permission` / `x-public` on each operation. The public endpoint that serves it comes with M8.

**Coming in M5:** the generated `hono/client` API client. See the [kernel guide](../kernel/README.md) for how routes fit into a module.
