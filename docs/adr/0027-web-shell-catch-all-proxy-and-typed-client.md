# ADR-0027: The web shell, the catch-all route, the proxy and the typed client

- Status: Accepted
- Date: 2026-10-07

## Context

M5 gives Scorpion its first browser. The plan ([m5-sprint-plan.md](../m5-sprint-plan.md), Decisions 2 to 5) fixed the direction
on 2026-10-05; sprint 1 has to turn it into something that builds. Five things need a precise answer: how the web process learns
which pages the modules offer, how a browser reaches the API (and how one image runs both processes), where the OpenAPI document
and the typed client come from (the plan assumed the server already produced the document; it does not serve it), what `core.ui-shell`
is, and what happens if the catch-all route does not work.

Constraints that do not move: modules are composed at build time (ADR-0001), a module never adds a SvelteKit filesystem route,
the session cookie is `__Host-session` with `Path=/` (ADR-0007), the API lives under `<BASE_PATH>/api/internal` and `BASE_PATH` may
have any number of segments (defect 11), and a profile without a browser must still run.

## Decision

### `core.ui-shell` is a small module with no table

- It owns the registries `ui.routes`, `ui.nav`, `ui.widget` and `ui.theme`, the public route `GET /ui/navigation`, and the first
  pages (`/`, the legal pages, `/docs`), which it contributes to its own registries like any other module would. It depends on
  `core.authz` (to decide what a caller may see) and `core.settings` (the branding every page shows, so a page never needs a built-in name);
  not on `core.identity`, because the browser asks `/auth/me` itself and a profile without sign-in still has public pages. Other modules
  contribute through an optional peer on `core.ui-shell`; a profile without it still starts the API (and builds no web app, see below).
- **A route entry has two halves.** The server half is data in the registry `ui.routes`: `{ path, permission }` or
  `{ path, public: true, publicReason }`, with `:param` segments. The browser half is code: a `ui` entry in the module
  (`./ui`, exported by the package, referenced by the manifest's `ui` field) that lists `{ path, load, component }` with a lazy
  `import()` of a Svelte component. The server never loads Svelte; the web app never reads manifests. A test per module (and one
  in the shell for its own pages) checks that both halves list the same paths.
- A permission named in `ui.routes` or `ui.nav` must be declared by some loaded module; the shell checks it when its service is
  built and stops the start otherwise. A route entry with neither `permission` nor `public: true` (and a reason) is refused by its
  schema, as `createRoute()` does.
- **`GET /ui/navigation` is a public route with a reason**, not a permission-guarded one (the plan said `core.ui-shell.nav.read`, but a signed-out
  visitor must also get the public entries, and a public route can still read the actor). The handler asks `ctx.authz.can()` per
  entry and returns `{ nav: [...], routes: [paths the caller may open] }`. The navigation the user sees and the permission check of
  the catch-all come from this one list. The client never filters on its own.

### How the web process learns the routes (Decision 2)

`pnpm scorpion profile:generate <name>` also writes `apps/web/src/generated/ui.ts`: one static `import()` per module of the
profile whose package exports `./ui`, and the list of those modules. It also points `apps/web/package.json` at exactly those
modules, as it does for the server. `pnpm generated:check` fails on a diff. The catch-all builds its table from the file at start.
A profile without `core.ui-shell` generates an empty table and the Docker build skips the web app.

### The catch-all route

`apps/web/src/routes/[...path]` resolves the path against the table (segments only, `:param` as a single segment, no regular
expression built from module input; a segment of `..`, `.`, an empty segment, or an encoded `/` or `\` never matches), asks the API
for the caller's `routes` list, answers 401 (redirect to the sign-in page with a checked `returnTo`) or 403 for a known path the caller
may not open, and 404 for an unknown one. It runs the entry's `load` on the server, which **throws** (`error(status, …)`) when it
cannot get its data (defect 12), and renders the lazy component. The 401 and 403 come from the same list that drives the navigation.

**Fallback.** If the prototype shows that per-route options, streamed `load` data or preloading cannot be made to work through one
catch-all, a build step generates one filesystem route per `ui.routes` entry from the same table, and the rule "a module adds no
filesystem route" is read as "a module adds none by hand". That keeps the registry and the permission list as the single source.
Prototype result: see the end of this ADR.

### One public origin, two processes (Decision 3)

- The **SvelteKit server is the public origin**. A thin Node front (`apps/web/src/front/`, no dependency) sits in front of the
  SvelteKit handler: a request whose path is `<BASE_PATH>/api/…`, `<BASE_PATH>/healthz` or `<BASE_PATH>/readyz` is streamed unchanged to the
  Hono process (`API_ORIGIN`, default `http://127.0.0.1:3001`), including `Set-Cookie`, `Retry-After` and, later, `text/event-stream`
  (sprint 4: no buffering, no idle timeout shorter than the heartbeat); every other request has `BASE_PATH` removed from its URL and goes to
  SvelteKit, which therefore always runs with `paths.base = ''` and relative asset paths. `BASE_PATH` is a run-time value of the
  process, so one image serves any prefix, as the server already does. `/metrics` is **not** proxied: it stays on the API's own port,
  which the container does not publish.
- The browser sees one origin: one cookie, no CORS. The API stays usable headless (`scorpion start`, or `PORT` of the API published).
  Mounting Hono inside SvelteKit remains an option for small deployments and is not built.
- **The image runs two processes** when the profile has `core.ui-shell`: a small entry (`docker/entrypoint.ts`) starts
  `scorpion start` with `PORT=$API_PORT` (default 3001, loopback only) and the web server on `PORT` (default 3000), forwards `SIGTERM`
  and `SIGINT` to both, and exits with the first failure after stopping the other. The health check keeps asking `PORT`, and the web
  front passes `/healthz` through, so it still answers for the API. Without `core.ui-shell` the image runs `scorpion start` on `PORT` as
  before. `scorpion worker` is unchanged.
- In development, a Vite plugin installs the same front as middleware (the same code), so `pnpm dev` behaves as production does.

### The OpenAPI document and the typed client (Decision 4)

- No route serves the OpenAPI document today, and none is added for the internal API: it describes endpoints that are not for
  third parties. A script (`pnpm openapi:generate`, `tools/openapi`) collects the route definitions of the **full** profile without a
  database (it calls each manifest's `routes()` with a collecting registrar and stubs for services, which never run), passes them to
  `generateOpenApiDocument`, and writes `packages/contracts/src/generated/openapi.json` and `schema.ts` (`openapi-typescript`).
  Both are committed; `pnpm generated:check` regenerates them and fails on a diff, so the client cannot drift from the routes.
  The client is typed against the full profile; a route a profile does not have answers 404 at run time, and the screens that call it
  are not registered in that profile.
- The client is `openapi-fetch` with `url()` built in, the `X-CSRF-Token` header on unsafe methods, and one error class for
  problem+json. This replaces the words "`hono/client`" in `implementation.md`: that client needs the application's TypeScript type,
  which routes assembled at run time by the loader do not give. Runtime dependencies: `openapi-fetch`. Development dependency:
  `openapi-typescript`.
- **`/docs` is a public page of the shell, not a route of the API.** It renders the public v1 surface from the same generated document
  (method, path, permission, summary). v1 has no routes before M8, and the page says so. `public-api` (M8) replaces it with Swagger UI
  and a live `/api/v1/openapi.json`, as architecture.md says. The page's entry is `public: true` with the reason that API documentation
  is public by design.

### `url()`

`packages/contracts` exports `url(base, path)` and `basePathOf(config)`. `url()` joins `BASE_PATH` and a path, for any number of
segments and with or without a trailing slash, keeps the query and the fragment, and refuses an absolute URL, a scheme-relative URL
and a path that leaves the base (`..`). `isLocalPath()` is the open-redirect check for `returnTo`. The server's redirects and the web
app use the same function. An ESLint rule in `apps/web` and `packages/ui-kit` forbids a string literal as the first argument of
`fetch` and as an `href` that starts with `/`.

### Browser security

The web front sets the headers (`Content-Security-Policy` with nonces from SvelteKit and no `unsafe-inline`, `Referrer-Policy`,
`X-Content-Type-Options`, `X-Frame-Options`/`frame-ancestors`, `Permissions-Policy`). The CSRF token comes from `GET /auth/me` on every
page request and is held in memory on the page, never in storage. The session cookie is HttpOnly and never read by script.

## Consequences

- Operators of a profile with the shell run one more process in the container and publish one port; `/metrics` is on the API port.
  The changeset says so.
- Two generated files can drift from the code (`generated/ui.ts`, the OpenAPI document); both are in `generated:check`.
- Every page of a module is declared twice (server half and browser half). The duplication is one path and one permission, checked by a
  test, and is the price of keeping Svelte out of the server and manifests out of the browser.
- The typed client covers the full profile, so a profile that omits a module has client functions for routes it does not serve.
- `GET /ui/navigation` is public and reads the caller from the session; it is covered by the defect-1 matrix and the response-fields walker.

## Prototype result

Sprint 1, run on 2026-10-07 with SvelteKit 3.0.0, `adapter-node`, Vite 8 and Playwright's Chromium, against the real API and a PostgreSQL
container, under `BASE_PATH=/` and `BASE_PATH=/a/b` (`apps/web/e2e/session-cookie.spec.ts`, `shell.spec.ts`):

- **The catch-all route works.** Pages come from the generated table; the permission check, `load` (server side), the lazy component, the
  404 for an unknown path and a client-side navigation by link all work through `/[...path]`. The fallback was not needed.
- **`BASE_PATH` of any depth works without a build-time base.** The front removes the prefix; SvelteKit runs with `paths.base = ''` and
  relative paths (`paths.relative`, the default in SvelteKit 3), computes the browser's base from the page's own depth, and `url()` puts the
  prefix on every link the application writes. Assets, `__data.json` requests and `goto()` under `/a/b` all resolve.
- **Chromium keeps `__Host-session` on `http://localhost`.** The cookie (`Secure; HttpOnly; SameSite=Lax; Path=/`) set by the API through
  the front is stored, sent on the next page request and used by the server-rendered page, under both prefixes. No local certificate is needed.
- **`Set-Cookie` passes the proxy unchanged**, and a server-rendered page reaches the API with the caller's cookie and `X-Forwarded-For`.
- Found on the way: `kernel.settingsOf()` is called by the server before `kernel.start()`, which made the context of `core.settings` early;
  `ctx.deps` was a snapshot, so every settings route answered 500 in a running server. Fixed in the kernel (read when used), with a regression test.
- SvelteKit 3 differences that shaped the code: `$lib` is `#lib` (package `imports`), hook types come from `@sveltejs/kit/hooks`, the error
  hook receives a `kind`, and `$app/env` replaces `$env/*` (the two values the web process reads come from `process.env`).
