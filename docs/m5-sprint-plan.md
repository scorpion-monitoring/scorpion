# M5 Sprint Plan: `core.ui-shell` + web app skeleton

Status: proposed, 2026-10-05. Decisions 1 to 9 (§10) were answered on 2026-10-05. Eight took the recommendation; Decision 9 chose server-sent events instead of polling.
Scope source: [implementation.md](implementation.md) §3, M5. Closes defects 11 and 12 (FEATURES §5); it also adds the
first Playwright journeys. Releases as `0.7.0` (M4b takes `0.6.0`, see [m4b-sprint-plan.md](m4b-sprint-plan.md)). Gate 1 follows.

M5 is size M (about 3 weeks for one developer), but it is the first milestone with a browser in it. Until now every
rule was proved against the API. From here on cookies, CSRF, `BASE_PATH`, sanitised Markdown and the permission-filtered
navigation are proved in a real browser. This plan splits M5 into four sprints of about one week, each one `feature/m5-*`
branch and one pull request into `dev`. M5 is released once, after sprint 4.

## 0. Before sprint 1

1. **M4a has not been done; its plan is [m4a-sprint-plan.md](m4a-sprint-plan.md).** `tools/asvs-report`, `docs/security/asvs/` and `SECURITY.md` do not exist, and
   implementation.md says M5 is built with them in place. Decision 1: M4a runs first (plan: [m4a-sprint-plan.md](m4a-sprint-plan.md), size S). CLAUDE.md already tells contributors to update the ASVS files in scoped paths; with no tool,
   that rule cannot be followed or enforced.
2. `dev` carries `0.5.0` (done: tag `v0.5.0`, merge-back #50). Sprint 1 starts from `dev`.
3. §10 is answered. Write ADR-0025 (how the shell finds module pages and talks to the API) as the first commit of sprint 1.
4. Add the lines in §11 to M5's scope in `implementation.md`. FEATURES §3.19 describes the legacy app; where it conflicts
   with the architecture or this plan, the plan and the ADRs win.
5. **Prototype the catch-all route in the first days of sprint 1** (risk in §12). If SSR hooks per route or `load` data
   cannot be made to work through `/[...path]`, stop and take the fallback of Decision 2 before building any screen.

## 1. What M2 to M4 hand to M5

| Hand-off                                                                                                                                               | Where it was recorded                           | Sprint |
| ------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------- | ------ |
| `ui` in the manifest is "stored only; the shell uses it from M5"; the shell reads `ui.routes`, `ui.nav`, `ui.widget`, `ui.theme`                       | `manifest.ts`, architecture                     | 1      |
| Public `GET /auth/oidc/providers` (id, name) and a provider icon hash for the login page                                                               | backlog (identity, sprint 4 follow-ups 1, 4)    | 2      |
| The "check your mail" page after register; tell a rejected person whom to contact                                                                      | backlog (identity), M4 backlog                  | 2      |
| `GET /users/{id}/roles`, a list of another user's tokens, user management (deactivate, change email, force reset, revoke sessions)                     | backlog (identity, authz)                       | 3      |
| A route for `setRolePermissions` (the event exists since M4, no HTTP route calls it)                                                                   | backlog (authz)                                 | 3      |
| Settings form: labels, grouping, secrets that are not set. Convention for `.describe()` and `.meta()` decided with the first form                      | backlog (settings)                              | 3      |
| Audit viewer, CSV export, system page (outbox, requeue), `GET /system/job-runs`, the audit volume of polling reads                                     | M4 backlog, ADR-0021, ADR-0024                  | 4      |
| Inbox bell, preference form, delivery list, which identity mails earn an inbox item                                                                    | M4 backlog, ADR-0023                            | 4      |
| Audit viewer shows "deleted account" for a purged user (events carry ids, not usernames); privacy text says ids stay in the trail                      | M4 backlog                                      | 4      |
| ASVS 6.2.6 and 6.2.7: password fields are `type=password`, and paste, browser password helpers and password managers work; a Playwright test proves it | `docs/security/asvs/v6-authentication.yaml`     | 2      |
| ASVS 7.4.4: a logout control is reachable on every page that needs a sign-in; a Playwright test walks the navigation and finds it                      | `docs/security/asvs/v7-session-management.yaml` | 1      |
| The M4b routes: session list and end, admin session end, recent-authentication prompt (`401 reauthentication-required`), mail-confirmed OIDC linking   | [m4b-sprint-plan.md](m4b-sprint-plan.md)        | 2, 3   |
| Defect 11 (one-segment `BASE_PATH`) and defect 12 (loaders return `Response(400)`) regression tests                                                    | FEATURES §5, implementation.md Gate 1           | 1      |
| Legal pages rendered from sanitised Markdown (the renderer and `GET /legal/{page}` exist since M3)                                                     | ADR-0018                                        | 1      |
| New work in scoped paths updates the ASVS chapter files as it lands (login screens, CSRF in forms, cookies under `BASE_PATH`)                          | implementation.md §8.4                          | 2 to 4 |

## 2. Cross-sprint rules

- Stay inside M5. Anything else goes to `docs/backlog.md`. Screens for modules that do not exist yet (services, KPIs,
  maturity, groups) are M6+; M5 builds the shell and the screens of `core.*`.
- **One pull request per sprint** (CLAUDE.md). ADRs, READMEs, backlog lines and review fixes go into the sprint's pull
  request. Push and open the pull request when the sprint is complete and verified locally (`pnpm check`, `pnpm test` for
  touched packages, `pnpm test:e2e` for the journeys that exist).
- **The UI calls the API only through the typed client** and builds every link and fetch with `url()`. An ESLint rule in
  `apps/web` and `packages/ui-kit` forbids a string literal passed to `fetch` and `href="/…"`, so a violation fails
  `pnpm check` instead of review. A module never adds a filesystem route.
- **No `{@html}` on anything the server did not sanitise.** Markdown arrives as server-rendered, DOMPurify-cleaned HTML
  (`packages/sanitize`); a lint rule allows `{@html}` only in one `SafeHtml.svelte` component. A test feeds it `<script>`,
  `onerror=` and `javascript:` payloads.
- **Loaders throw** (`error(status, …)`), never return a `Response`. A lint rule bans `new Response` and `json()` in
  `+page.ts` / `load` code (defect 12).
- **Every user-visible string goes through the message catalogue** (English first, German second, as in ADR-0022). A test
  fails for a key missing in `de`, and another for a string literal in a `.svelte` text node (a small check script).
- **Accessibility:** every `ui-kit` component has a keyboard test and an axe check in Playwright component or page tests
  (no serious or critical violations). Focus order, labels, and `aria-live` for toasts are part of the component, not a
  later pass.
- **Security of the browser layer:** CSP without `unsafe-inline` (nonces from SvelteKit), `Referrer-Policy`,
  `X-Content-Type-Options`, frame denial, set in the web hook. The CSRF token is held in memory, never in `localStorage`.
  Cookies are never read by script.
- Tests: pure logic (nav filtering, `url()`, schema-to-form mapping, table sorting, message-catalogue lookup) gets
  table-driven unit tests. New routes get the usual integration test with a denied case and an entry in the route-table
  walker. Playwright covers journeys, not every screen.
- Use the factories in `packages/testing`. Add a Playwright fixture that starts the real server, a Postgres Testcontainer
  and the web app (Decision 3), with `BASE_PATH` as a parameter.
- Update the README of every module whose manifest changes in the same commit.
- Every pull request carries a changeset. Write it for operators and API users: the web app now serves the UI, `BASE_PATH`
  behaviour, new routes and permissions.
- **New runtime dependencies are named in the pull request description.** Expected: `echarts` (named in CLAUDE.md, behind the
  adapter) and `openapi-fetch` or `hono/client` (Decision 4). Everything else is in-house or already present (`sanitize`
  package, DaisyUI, Tailwind). No component library, no state library, no i18n library (Decision 7).

## 3. Sprint overview

| Sprint | Branch                          | Theme                                                                                 | Closes |
| ------ | ------------------------------- | ------------------------------------------------------------------------------------- | ------ |
| 1      | `feature/m5-shell-foundation`   | `core.ui-shell`, catch-all route, `url()`, typed client, layout, themes, public pages | 11, 12 |
| 2      | `feature/m5-auth-profile`       | i18n, login, register, pending, reset, profile, tokens, identities                    | none   |
| 3      | `feature/m5-ui-kit-admin`       | `ui-kit` components, users, roles, settings forms                                     | none   |
| 4      | `feature/m5-operations-release` | audit viewer, system, job runs, notifications, inbox bell, journeys, release          | none   |

Order matters. Sprint 1 settles the riskiest question (the catch-all route) and the API access pattern that every screen
uses. Sprint 2 needs only the shell. Sprint 3's `ui-kit` is used by sprint 4, so it cannot move after it. Sprint 4 holds the
screens with the least new design and the acceptance journeys.

Module graph after M5: `core.ui-shell` depends on `core.settings` (branding, locale) and `core.identity` (`/auth/me`, so the
shell can ask who is signed in). It is the owner of the `ui.nav`, `ui.widget` and `ui.theme` registries. Other modules
contribute to them through an optional peer on `core.ui-shell` (a module must still start in a profile without the shell, as
`core.audit` does). The module's table prefix is not needed: it owns no table (Decision 5).

## 4. Sprint 1: shell foundation

**Branch:** `feature/m5-shell-foundation`. **Goal:** a signed-out and a signed-in visitor see the real layout; a page
contributed by a module through `ui.routes` renders under `/[...path]` with its permission checked; `BASE_PATH` works for any
depth; the legal pages work.

Work items

1. ADR-0025 and the prototype (§0 item 5). The ADR records: how the web process learns the registered `ui.routes`
   (Decision 2), how it reaches the API (Decision 3), the typed client (Decision 4), and the fallback if the catch-all fails.
2. Create `modules/core-ui-shell` with `module.ts`, `public.ts`, `README.md`. It declares the registries `ui.nav`
   (`{ id, label key, path, icon?, section, permission?, order }`), `ui.widget` (`{ id, slot, component, permission? }`) and
   `ui.theme` (`{ id, label key, colorScheme }`), and exports the route entry schema `{ path, permission?, public?, load,
component }`. Permission names are checked by the loader against the declared permissions. A `ui.routes` entry without
   `permission` or `public: true` fails at registration, as `createRoute()` does.
3. **Navigation filtered by permission.** The server computes it: `GET /ui/navigation` (permission `core.ui-shell.nav.read`,
   held by every signed-in role; anonymous callers get only the public entries) returns the entries the caller may see, built
   from the registry and `ctx.authz`. The same list drives the catch-all's permission check. The client never hides a link
   it computed itself (defect-style test: a plain User's response contains no Administration entry; a request for an admin
   path as a User gives 403, not an empty page).
4. **Catch-all route** `apps/web/src/routes/[...path]`: resolve the path against the `ui.routes` table, check the permission
   with the session, run `load` (server side, throws on failure), render the lazy component. Unknown path → the error page
   with 404. Matching supports params (`/users/:id`) and is table-driven tested (no regex from module input; a path segment
   cannot contain `..` or an encoded slash).
5. **`url()` helper** in `packages/contracts` (shared by the server's redirects and the web app): joins `BASE_PATH` and a path,
   strips and adds the prefix correctly for any number of segments, refuses an absolute URL with another origin. Table-driven
   tests for `/`, `/a`, `/a/b`, `/a/b/`, trailing slashes, encoded characters. Regression test
   `defect-11.base-path.test.ts` with `BASE_PATH=/a/b/c` against the server hook, the web hook and a redirect after login.
6. **Typed API client** (Decision 4) in `packages/contracts`, generated from the same route definitions the server mounts, with
   `url()` built in, the CSRF header added to unsafe methods, and one error type for problem+json. No hand-written fetch URL
   in the web app (lint rule from §2).
7. **Session in the web layer.** `hooks.server.ts` forwards the cookie to the API, calls `GET /auth/me` once per request, keeps
   the CSRF token in server state for the page, and hands `{ user, roles, csrfToken }` to the layout. Cookie `Path` and
   `BASE_PATH` interplay is covered in the journey test of sprint 2.
8. **Layout** from FEATURES §3.19: header with drawer, brand (instance name from branding settings, logo swaps with theme),
   avatar menu, collapsible section sidebars with tooltips in the icon-rail state, footer (legal links, copyright, no
   hard-coded GitHub badge: the SPDX line becomes a branding setting or goes). Keyboard operable, landmarks, skip link.
9. **Themes:** `scorpionlight` and `scorpiondark` DaisyUI themes, `prefers-color-scheme` as the default, a manual toggle
   (light, dark, system) stored in a cookie-free `localStorage` entry with a safe fallback, no flash on first paint (an inline
   script allowed by a CSP nonce).
10. **Error page and error handling:** status, message, "Go home" with `url()`. `handleError` maps problem+json from the client
    to a user message; a 401 on a signed-in page redirects to login with a `returnTo` that is checked to be a path on this
    instance (an open-redirect test). Defect 12: a loader that cannot get its data throws; `defect-12.loader-errors.test.ts`
    fetches a page with a missing token and expects the error page and status, not a returned response.
11. **Public pages:** `/legal/terms`, `/legal/privacy`, `/legal/imprint` from `GET /legal/{page}` (sanitised on the server),
    `/docs` (the API documentation page; where it is served is a part of Decision 3), and the declared public route list.
    Public routes are listed in one place and a test fails for a `ui.routes` entry that is public without being declared.
12. **Security headers and CSP** in the web hook; a test asserts the headers and that a page has no inline script without a
    nonce.
13. Update the Dockerfile so the image includes the web app (the comment in `docker/Dockerfile` says it arrives with M5), and
    the CI image smoke test fetches `/` and `/health`. Dev: `pnpm dev` proxies as production does.

Definition of done: `pnpm check` and the tests of `core-ui-shell`, `contracts` and `web` pass. A test module contributes one page
and one nav entry in a fixture profile and both appear for a user with the permission and not for one without. The same
fixture runs under `BASE_PATH=/` and `/a/b/c`. Both defect tests pass. A profile without `core.ui-shell` still starts the
API. The first Playwright test replaces `smoke.spec.ts`: the start page loads, the header shows the instance name from
settings, the theme toggle works.

## 5. Sprint 2: i18n, sign-in, register, profile

**Branch:** `feature/m5-auth-profile`. **Goal:** register → pending → admin approves → user signs in → creates a PAT works in a
browser (the second half of the acceptance journey).

Work items

1. **Message catalogue** (Decision 7): typed keys, `en` and `de`, parameter interpolation, plural rule, in-house in
   `packages/ui-kit`; locale from the user's `notifications.locale` preference, then `Accept-Language`, then the instance
   default (the same order as ADR-0022). Vocabulary labels use the locale the API already returns. The two checks of §2.
2. **Login page:** username and password, the OIDC buttons from `GET /auth/oidc/providers` (new public route in `core.identity`
   with `{ id, displayName, iconHash? }` only; the provider's icon is a blob hash, uploaded as in ADR-0018), error display for a
   refused login without saying which part was wrong. Rate-limit responses (429) show the wait time.
3. **Register page** and "check your mail" page: the server answers 202 for every request (ADR-0022), so the page says the
   same thing for a new and a taken address. The pending-approval page, shown to a signed-in user whose status is `pending`
   (the API's answer decides, not the client).
4. **Password reset and e-mail verification pages:** request, confirm with the token from the URL (the token never goes into a
   log, a `Referer` header, or the client's history: it is read once and the URL is replaced), verification result.
5. **Profile page:** details (name, email, bio), role badges, avatar upload and removal through the blob routes with a client-side
   size check and the server's re-encode shown in the preview, linked OIDC identities with unlink and link, change password,
   API tokens (create with scopes and expiry, show the secret once with a copy button and a warning, rotate, revoke), and the
   user's own preferences (locale, theme). Group membership (FEATURES §3.4) belongs to a later module and is not built.
6. **Bootstrap:** when no administrator exists, `/` offers the first-admin form (`POST /bootstrap/first-admin`) and nothing else
   is reachable; after the first admin it is gone. Test that the form is unreachable after bootstrap.
7. **Playwright journeys** (both `BASE_PATH=/` and `/a/b`): register → pending screen → admin approves → user signs in → creates
   a PAT → the PAT works against the API; logout → the old cookie fails (defect 4 seen from the browser); a copied login-return
   URL to another origin is refused.
8. **ASVS:** update the chapter files for V6 (authentication), V7 (session) and V10 (OAuth/OIDC) with the browser evidence and
   tag the journey tests. Depends on Decision 1.

Definition of done: the journeys above pass in CI under both base paths. No password, token or reset secret appears in a
Playwright trace, a server log, or the browser's URL history after use (a test greps the trace and the log stream). The register
page gives the same response for a taken and a free address. Missing German keys fail the build.

## 6. Sprint 3: `ui-kit` and administration

**Branch:** `feature/m5-ui-kit-admin`. **Goal:** the shared components exist, are keyboard and screen-reader tested, and three
admin areas (users, roles, settings) work on top of them.

Work items

1. **`SchemaForm`:** JSON Schema (the output of `z.toJSONSchema`) → form: strings (with `format`, length, pattern), numbers, booleans,
   enums, arrays of scalars, arrays of objects (add, remove, reorder with keyboard), nested objects, `oneOf` as a select,
   `writeOnly` as a password field that never shows a stored value. Labels, help and grouping come from the schema's `title`,
   `description` and a `x-group` / `x-order` convention (Decision 6, settled with the first form). Field errors from a 422
   problem map onto the field by JSON pointer. Optimistic version conflicts (409) show a "reload" prompt.
2. **`DataTable`:** the list envelope (0-based pages), server-side sort and page size, column definitions with a cell
   snippet, empty and error states, row actions, keyboard navigation, `aria-sort`, a stable sort (the API sorts by key then id).
3. **`Wizard`** (steps, validation per step, back and forward, progress, state kept across steps, leave-page guard) and
   **`Facets`** (checkbox and range facets driven by a definition, counts, URL-synced through `url()`). They have no screen in
   M5 beyond a demo page in the test profile, because the first consumers are M7 and M11; keep them small and tested.
4. **Chart adapter** over ECharts with the chart-adapter interface in `architecture.md`: line, bar, radar, a theme that follows light and dark,
   a text alternative (data table toggle) for accessibility, lazy import so pages without charts do not load it. A unit test
   with a stub adapter; a Playwright check that a chart renders and its table alternative exists.
5. **Toasts, confirm dialog, tabs, breadcrumb, pagination** as the small components the screens need, all with tests.
6. **Admin → Users:** list (DataTable, filters by status), pending approvals (approve and reject, never your own), one user's
   detail: roles (add, remove; "last Admin" error shown), tokens of that user (revoke by id), sessions revoked, deactivate,
   change e-mail, force a reset. **New API routes** in `core.identity`: `GET /users`, `GET /users/{id}`,
   `GET /users/{id}/roles`, `GET /users/{id}/tokens`, `POST /users/{id}/deactivate`, `POST /users/{id}/sessions/revoke`, each with its
   own permission, a denied-for-User test and an audit flag.
7. **Admin → Roles:** list with permissions grouped by module, edit the permissions of non-Admin roles through a new
   `PUT /roles/{key}/permissions` in `core.authz` (calls `setRolePermissions`, emits the event M4 added, `audit: true`). Creating
   and deleting custom roles stays in the backlog.
8. **Admin → Settings:** the module list from `GET /settings`, a `SchemaForm` per module from `GET /settings/{module}/schema`,
   save with the version, secrets page (names and "set / not set", set and delete, a value is never shown; Decision 8 on
   declaring secrets), vocabularies (terms, labels per locale, order, deactivate), branding with logo upload.
9. **Navigation entries** for the Admin section contributed by the modules themselves through `ui.nav` (identity, authz,
   settings, audit, notifications), not listed in the shell.
10. Accessibility: an axe run over every screen of this sprint in the Playwright suite; keyboard-only path through the user
    approval and the settings form.

Definition of done: a plain User sees no Administration navigation and gets 403 on every admin path and every new route. An
Admin approves a user, changes that user's role, edits a role's permissions and a setting from the browser. The last Admin cannot
be removed from the UI (the error is shown). The `ui-kit` components each have a unit test, a keyboard test and an axe check.

## 7. Sprint 4: operations screens, journeys, release

**Branch:** `feature/m5-operations-release`. **Goal:** every route M4 built has a screen; the acceptance journeys pass in CI;
`0.7.0` is released.

Work items

1. **Admin → Logs (audit viewer):** `GET /audit` with the filters (method, user, endpoint prefix, action, outcome, source, date
   range), DataTable with keyset "load more", entry detail with the redacted body, the user column joins the user table and shows
   "deleted account" for a purged one, CSV export through the existing route (the download is itself an audit entry; the UI says
   so). The three read routes are audited today: decide in this sprint whether the list view stops being audited (backlog entry
   "Audit volume of reads"). The privacy text gets the sentence that ids stay in the trail.
2. **Admin → System:** outbox status (pending, dead), requeue of one dead delivery, the retention settings, and **job runs**: the
   new route `GET /system/job-runs` (`core.audit.system.read`) with the list envelope, the last result counts a handler returned,
   and the failure code.
3. **Admin → Notification status:** the counts from `status()`, the delivery list without bodies, the last error codes, requeue of
   a dead mail (one at a time; "requeue all" stays in the backlog), the test-mail form, and a clear banner when the transport is
   `none`.
4. **Inbox bell** in the header: unread count, a dropdown list, mark read and mark all read, a full page. Which identity mails
   earn an inbox item is decided here and recorded in the notifications README. **Live updates by server-sent events**
   (Decision 9): `GET /inbox/stream` in `core.notifications` (`text/event-stream`, cookie or token authenticated, permission
   `core.notifications.inbox.read`), driven by the kernel's existing `pg_notify` listener. It sends only `unread` counts and a
   25 s heartbeat, never message content; the page fetches the list through the normal route. Rules: a cap of streams per
   user and a global cap (settings), the stream ends when the session is revoked or expires (the session is re-checked on each
   heartbeat), no `Last-Event-ID` replay (a reconnect starts with the current count), `Cache-Control: no-store`, and the web
   proxy must not buffer or time out the response. The page falls back to polling every 60 s when the stream fails or a proxy
   cuts it. ADR-0026 records the design. Tests: two kernels over one database (a delivery on one reaches a stream on the
   other), the caps, the end on logout (defect 4 seen from a stream), and a plain User cannot open another user's stream.
5. **Preference form** for notifications: switches per mandatory and optional kind, mandatory ones shown as locked with the reason;
   the form reads the registered preference keys, as the backlog asks.
6. **Dashboard** at `/`: the widget slot (`ui.widget`) with the cards core modules can offer (pending approvals for a reviewer, dead
   deliveries for an administrator). No KPI widgets; those are M13.
7. **Acceptance journeys** in Playwright under `BASE_PATH=/` and `/a/b` in CI: register → pending → admin approves → user signs
   in → creates a PAT; a User never sees the Administration navigation (assert the DOM and a direct URL visit); an Admin changes
   a setting and the audit viewer shows the entry with the right actor; a dead mail is requeued from the status screen.
8. **ASVS:** update V6, V7, V8 and V10 for the new evidence; run `pnpm security:asvs`; every `fail` that remains links an issue
   assigned to a fix before Gate 1.
9. **Release 0.7.0** as in CONTRIBUTING.md: release branch from `dev`, `pnpm changeset version`, PR into `main`, annotated tag,
   merge-back on a `feature/…` branch, the profile images `scorpion:0.7.0-<profile>`. The release now has a UI, so the images are
   built and smoke tested (unlike 0.5.0).

Definition of done: the four acceptance journeys pass in CI under both base paths; no serious axe violation on any screen;
`pnpm check`, the full `pnpm test` and `pnpm test:e2e` are green on `dev` after the merge; `0.7.0` is tagged.

## 8. Acceptance (from implementation.md) mapped to tests

| Acceptance criterion                                                      | Where it is proved                                                                          |
| ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| register → pending → admin approves → user signs in → creates a PAT       | `apps/web/e2e/onboarding-journey.spec.ts`, both base paths (sprint 2, extended in sprint 4) |
| Works under `BASE_PATH=/` and `BASE_PATH=/a/b`                            | Playwright projects `root` and `nested`; `defect-11.base-path.test.ts` with `/a/b/c`        |
| A User never sees the Administration navigation                           | `core-ui-shell` nav test, `e2e/navigation.spec.ts` (DOM and direct visit), route walker     |
| Loaders throw instead of returning `Response(400)` (defect 12)            | `defect-12.loader-errors.test.ts` plus the lint rule                                        |
| Catch-all resolves module `ui.routes`, checks permissions, runs `load`    | `core-ui-shell/shell.test.ts` with a fixture module; the unknown path gives 404             |
| Legal pages are sanitised Markdown and public                             | `e2e/legal.spec.ts` with a hostile text; `SafeHtml` unit test                               |
| Branding and logos from settings; light, dark and manual toggle           | `e2e/theme.spec.ts`, `e2e/branding.spec.ts`                                                 |
| `SchemaForm` (arrays of objects), `DataTable`, `Wizard`, `Facets`, charts | `ui-kit` unit, keyboard and axe tests; Playwright component page                            |
| Every `ui-kit` component keyboard- and screen-reader-tested               | axe plus keyboard specs, one per component; a check fails for a component without them      |
| i18n from the start (English, German)                                     | catalogue tests; a missing `de` key fails                                                   |

Additional gates this plan adds: no secret in a Playwright trace, a log line or the URL history; an open-redirect test on
`returnTo`; the CSP and security-header test; the lint rules (no literal `fetch` or `href`, no `{@html}` outside `SafeHtml`, no
`new Response` in loaders); the route-table walker covers every new route.

## 9. Out of scope (goes to `docs/backlog.md` if not there)

- Screens for modules that do not exist yet: services, organisations, groups, KPIs, maturity, network graph. M5 builds only
  the registry slots they will use.
- A visual editor for themes or a user-uploaded theme; more than the two shipped themes.
- A third language, right-to-left layout, locale-specific number and date formats beyond `Intl`.
- WebSockets, and live updates for anything but the inbox count.
- 2FA, passkeys, "remember this device".
- Create and delete custom roles; a bulk "requeue all"; full-text audit search; saved audit filters.
- A PWA, offline mode, mobile app.
- Visual regression testing.
- Per-module help pages and a product tour.

## 10. Decisions taken (2026-10-05)

They are the blocking ones for sprint 1; the smaller ones appear in the sprint they affect. Each entry shows the answer first.

1. **M4a first: yes** (the plan is [m4a-sprint-plan.md](m4a-sprint-plan.md)), as a short separate milestone (a sprint of its own, a docs and CI pull request) before
   sprint 1, because implementation.md promises M5 is built with the ASVS tool in place and CLAUDE.md's scoped-path rule is not
   enforceable without it. The alternative is to fold the tool into sprint 1, which makes sprint 1 too large to review.
2. **How the web process learns `ui.routes`.** Recommended: the profile generator also writes a `generated/ui.ts` in `apps/web`
   with static lazy imports of each module's UI entry (the same build-time composition as `generated/profile.ts`, ADR-0001), and
   the catch-all builds its table from it at start. Alternative: a build step that generates SvelteKit filesystem routes, which
   is the documented fallback if the prototype fails but breaks the "no filesystem routes" rule.
3. **How the browser reaches the API.** Recommended: the SvelteKit server is the single public origin and proxies `/api` to the
   Hono process (one cookie, no CORS, `BASE_PATH` handled in one place), and the API stays usable headless. The architecture also
   allows mounting Hono inside SvelteKit for small deployments; keep that as an option but do not build it in M5. Where `/docs`
   (OpenAPI UI) is served follows from this.
4. **Typed client.** `hono/client` needs the app's TypeScript type, which `createRoute` routes assembled at run time by the
   loader do not give. Recommended: generate the client from the OpenAPI document the server already produces
   (`openapi-fetch` plus `openapi-typescript`, two small dependencies, the client stays typed and tested against the contract
   tests). `implementation.md` names `hono/client`; this changes the wording and needs a line in ADR-0025.
5. **Is `core.ui-shell` a kernel module or only the web app?** Recommended: a small module (registries, `GET /ui/navigation`,
   permission, no table), so profiles list it and a headless profile leaves it out. The loader's table-prefix check does not
   apply to a module without tables.
6. **Settings form convention.** Recommended: Zod `.meta({ title, description, group, order, widget })` flows into the JSON
   Schema; `SchemaForm` reads only those keys and ignores the rest. Secrets are declared by a small registry
   (`settings.secret`: name pattern, description) so the form can list unset ones (backlog: "Declared secrets"); take it into
   sprint 3 only if the first form needs it, otherwise leave it in the backlog.
7. **i18n.** Recommended: an in-house catalogue (typed keys, `en`/`de`, a plural rule, `Intl` for formats), no library. About 150
   lines and no new dependency; a library would be justified only if M6+ needs ICU message syntax.
8. **Where the e2e suite runs.** Recommended: the existing CI job, with a second Playwright project for the nested base path, the
   server started from the built profile image and web app together. If the job passes 15 minutes, split it into a parallel job
   (the unit job is 11 to 13 minutes today).
9. **Inbox updates: server-sent events** (the recommendation was polling every 60 s). This adds a long-lived response to the
   API, which is new for the server: connection caps, session re-checks, proxy buffering and idle timeouts are now ours to get
   right, and the web proxy of Decision 3 must stream. Polling stays as the fallback. Recorded in ADR-0026 and the risks.

## 11. Additions to M5's scope in `implementation.md` (to approve with this plan)

- `core.ui-shell` is a module with the `ui.nav`, `ui.widget` and `ui.theme` registries and `GET /ui/navigation`; navigation is
  filtered on the server.
- The typed client is generated from the OpenAPI document (Decision 4) and shared with `url()`; both live in `packages/contracts`.
- New routes the screens need: `GET /auth/oidc/providers`, user management (`GET /users`, `/users/{id}`, `/users/{id}/roles`,
  `/users/{id}/tokens`, deactivate, revoke sessions), `PUT /roles/{key}/permissions`, `GET /system/job-runs`, `GET /ui/navigation`.
- `GET /inbox/stream` (server-sent events, unread count only) in `core.notifications`, with ADR-0026.
- Screens: inbox bell, notification preferences, audit viewer, system page and job runs join the list in M5.
- Acceptance additions: no secret in a browser trace or log; CSP and security headers; axe checks on every screen; the lint rules
  that make the typed client, `url()`, `SafeHtml` and thrown loader errors mandatory.
- The release builds and smoke tests the profile images (the web app is in them from sprint 1).

## 12. Risks

| Risk                                                                                                   | Impact                                                 | Mitigation                                                                                                                             |
| ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------- |
| The catch-all route limits SvelteKit (per-route SSR options, streaming `load`, preloading)             | Rework of the shell after screens exist                | Prototype in the first days of sprint 1 (§0 item 5); fallback: generated filesystem routes from a build step                           |
| M4a is skipped, then ASVS evidence is retro-fitted at Gate 1                                           | Gate 1 slips, evidence is thin                         | Decision 1; each sprint from 2 on has an ASVS item                                                                                     |
| The OpenAPI-generated client drifts from the server or loses the problem+json types                    | Runtime errors the compiler did not catch              | Generate in `pnpm check`, fail on a diff; one test calls each client function against the contract fixtures                            |
| CSRF token handling breaks under SSR (the server renders a page and the browser then posts)            | Writes fail with 401 after a reload                    | The layout gets the token from `/auth/me` on every request (ADR-0007); a journey reloads before every write                            |
| `BASE_PATH` bugs come back in places not covered (assets, redirects, cookie path, OIDC callback)       | Defect 11 returns                                      | Every journey runs under `/a/b`; the lint rule bans literal paths; `url()` is the only constructor                                     |
| Server-rendered Markdown or an admin-entered text reaches the DOM unsanitised                          | Stored XSS in a security milestone                     | One `SafeHtml` component, a lint rule, a hostile-text e2e test, CSP without `unsafe-inline`                                            |
| Admin screens grow beyond three weeks (settings forms for every module, user management)               | Release slips                                          | Sprint 3 builds three areas only; further forms are generated from schemas and add no new code per module                              |
| E2E tests are slow or flaky in CI (Postgres, server, web, browser in one job)                          | Two CI runs per sprint grow, flakes block merges       | Journeys, not screens; reuse one server per project; the known 57P01 teardown flake is fixed or tolerated before sprint 1              |
| SSE connections tie up server resources or are cut by proxies, and a stream outlives a revoked session | Exhaustion, or a revoked session still receives counts | Per-user and global caps, session re-check on each heartbeat, polling fallback, a test for the end on logout, no content on the stream |
