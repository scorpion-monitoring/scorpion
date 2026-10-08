# M5 Sprint Plan: `core.ui-shell` + web app skeleton

Status: approved, updated 2026-10-07 after M4a and M4b were released as `0.6.0`. Decisions 1 to 9 (§10) were answered on 2026-10-05. Eight took the recommendation; Decision 9 chose server-sent events instead of polling.
What the update changed: §0 (the state of the project), the hand-off table (§1), the sessions, re-authentication and linking screens that M4b made possible (sprint 2), the three ASVS entries M5 closes (sprints 1 and 2), the rules a new route now has to follow (§2), the release without a manual image build (sprint 4) and the OpenAPI document source (Decision 4).
Scope source: [implementation.md](implementation.md) §3, M5. Closes defects 11 and 12 (FEATURES §5); it also adds the
first Playwright journeys, and closes the three ASVS entries that need a browser (6.2.6, 6.2.7, 7.4.4). Releases as `0.7.0` (`0.6.0` is M4a and M4b, released 2026-10-07, see [m4b-sprint-plan.md](m4b-sprint-plan.md)). Gate 1 follows.

M5 is size M (about 3 weeks for one developer), but it is the first milestone with a browser in it. Until now every
rule was proved against the API. From here on cookies, CSRF, `BASE_PATH`, sanitised Markdown and the permission-filtered
navigation are proved in a real browser. This plan splits M5 into four sprints of about one week, each one `feature/m5-*`
branch and one pull request into `dev`. M5 is released once, after sprint 4.

## 0. Before sprint 1

State on 2026-10-07 (checked against `dev`):

1. **M4a and M4b are done and released as `0.6.0`** (tag `v0.6.0`, merge-back #65). `tools/asvs-report`, `docs/security/asvs/`, `SECURITY.md` and the
   `ASVS impact` check exist. Three `fail` entries remain in the four chapter files and all of them are M5's: 6.2.6 and 6.2.7 (sprint 2) and 7.4.4 (sprint 1).
   Gate 1 needs none left, so M5 must close them with Playwright tests.
2. `dev` carries `0.6.0`. Sprint 1 starts from `dev` (pull first). ADR-0025 and ADR-0026 are taken, so **ADR-0027 (the shell) and ADR-0028 (the inbox
   stream) are still free** and are written in this milestone.
3. **What exists in the repository:** `apps/web` is a placeholder page, `app.css` and one Playwright smoke test (no hooks, no layout, no `generated/`);
   `packages/ui-kit` is empty; `packages/sanitize` (Markdown and SVG sanitising) exists; `packages/contracts` has `createRoute`, the envelopes and
   `generateOpenApiDocument`, but **no `url()` helper, no client, and no route serves the OpenAPI document**; the manifest has the field `ui` and nothing reads it;
   `docker/Dockerfile` runs only `scorpion start` (the API). The API paths are `<BASE_PATH>/api/internal/…`. The session cookie is `__Host-session`
   (`Secure; HttpOnly; SameSite=Lax; Path=/`), unsafe methods need `X-CSRF-Token`, and `GET /auth/me` returns `{ user, roles, csrfToken }` (ADR-0007).
4. **Pages the API already links to.** The mails and the OIDC callback of M4 and M4b send people to fixed paths (`modules/core-identity/service/mail-links.ts`), and the
   token of a link is in the URL **fragment** (`#token=…`), never in the query: `/login` (also `/login?notice=check-mail`), `/forgot-password`,
   `/reset-password#token=`, `/verify-email#token=`, `/link-sign-in#token=` and `/admin/users/pending`. Sprints 2 and 3 build exactly these paths; they are public or
   permission-guarded as the table in §1 says.
5. Add the lines of §11 to M5's scope in `implementation.md` in the first commit of sprint 1, together with ADR-0027. FEATURES §3.19 describes the legacy app; where
   it conflicts with the architecture or this plan, the plan and the ADRs win.
6. **Prototype the catch-all route in the first days of sprint 1** (risk in §12). If SSR hooks per route or `load` data cannot be made to work through
   `/[...path]`, stop and take the fallback of Decision 2 before building any screen. In the same days check that Playwright's Chromium keeps the `__Host-session`
   cookie on `http://localhost` (it must be `Secure`), because every journey depends on it.

## 1. What M2 to M4 hand to M5

| Hand-off                                                                                                                                                                                                                                                                                                                      | Where it was recorded                             | Sprint |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- | ------ |
| `ui` in the manifest is "stored only; the shell uses it from M5"; the shell reads `ui.routes`, `ui.nav`, `ui.widget`, `ui.theme`                                                                                                                                                                                              | `manifest.ts`, architecture                       | 1      |
| Public `GET /auth/oidc/providers` (id, name) and a provider icon hash for the login page                                                                                                                                                                                                                                      | backlog (identity, sprint 4 follow-ups 1, 4)      | 2      |
| The "check your mail" page after register; tell a rejected person whom to contact                                                                                                                                                                                                                                             | backlog (identity), M4 backlog                    | 2      |
| `GET /users/{id}/roles`, a list of another user's tokens, user management (deactivate, change email, force reset); revoking one user's sessions already exists (M4b)                                                                                                                                                          | backlog (identity, authz)                         | 3      |
| A route for `setRolePermissions` (the event exists since M4, no HTTP route calls it)                                                                                                                                                                                                                                          | backlog (authz)                                   | 3      |
| Settings form: labels, grouping, secrets that are not set. Convention for `.describe()` and `.meta()` decided with the first form                                                                                                                                                                                             | backlog (settings)                                | 3      |
| Audit viewer, CSV export, system page (outbox, requeue), `GET /system/job-runs`, the audit volume of polling reads                                                                                                                                                                                                            | M4 backlog, ADR-0021, ADR-0024                    | 4      |
| Inbox bell, preference form, delivery list, which identity mails earn an inbox item                                                                                                                                                                                                                                           | M4 backlog, ADR-0023                              | 4      |
| Audit viewer shows "deleted account" for a purged user (events carry ids, not usernames); privacy text says ids stay in the trail                                                                                                                                                                                             | M4 backlog                                        | 4      |
| ASVS 6.2.6 and 6.2.7: password fields are `type=password`, and paste, browser password helpers and password managers work; a Playwright test proves it                                                                                                                                                                        | `docs/security/asvs/v6-authentication.yaml`       | 2      |
| ASVS 7.4.4: a logout control is reachable on every page that needs a sign-in; a Playwright test walks the navigation and finds it                                                                                                                                                                                             | `docs/security/asvs/v7-session-management.yaml`   | 1      |
| The own session list (`GET /account/sessions`), end one, "log out everywhere"; each of the last two needs a recent authentication                                                                                                                                                                                             | [m4b-sprint-plan.md](m4b-sprint-plan.md) sprint 1 | 2      |
| The re-authentication dialog: every `401 reauthentication-required` (email change, link start and confirm, end session, log out everywhere) opens it; password first, the provider when the answer is `409` (no password); the OIDC callback returns to `/` with no return path, so the page keeps the intended action itself | backlog (sessions follow-ups), ADR-0025           | 2      |
| Mail-confirmed OIDC linking: `/login?notice=check-mail`, and `/link-sign-in#token=…` (signed in, recent authentication, then `POST /account/oidc-link/confirm`; the page cannot name the provider before confirming, see the backlog)                                                                                         | ADR-0026, backlog (credentials follow-ups)        | 2      |
| The pages the mails link to: `/forgot-password`, `/reset-password#token=`, `/verify-email#token=`, `/admin/users/pending`; the token is read from the fragment, posted, and the URL replaced                                                                                                                                  | `mail-links.ts`, ADR-0012                         | 2, 3   |
| Admin: end the sessions of one user (`POST /users/{id}/sessions/revoke`) or of everybody (`POST /system/sessions/revoke-all`, with a confirm dialog); both routes exist                                                                                                                                                       | [m4b-sprint-plan.md](m4b-sprint-plan.md) sprint 1 | 3      |
| Password forms show the server's problems: a breached or context-specific password is a 422 with a field error, a throttled login is a 429 with `Retry-After`, an expired reset link says to ask for a new one (10 minutes)                                                                                                   | ADR-0026                                          | 2      |
| Defect 11 (one-segment `BASE_PATH`) and defect 12 (loaders return `Response(400)`) regression tests                                                                                                                                                                                                                           | FEATURES §5, implementation.md Gate 1             | 1      |
| Legal pages rendered from sanitised Markdown (the renderer and `GET /legal/{page}` exist since M3)                                                                                                                                                                                                                            | ADR-0018                                          | 1      |
| The field rules per object: what each reader sees and may change. A screen shows only the fields a route returns; `bio` is text and never `{@html}`; `POST /files` needs `core.blob.manage`, so an avatar goes through `PUT /account/avatar`                                                                                  | `docs/security/authorization.md`                  | 2 to 4 |
| New work in scoped paths updates the ASVS chapter files as it lands (login screens, CSRF in forms, cookies under `BASE_PATH`)                                                                                                                                                                                                 | implementation.md §8.4                            | 2 to 4 |

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
- **A new route (sprints 3 and 4 add several) needs, in the same pull request:** an entry in the matrix of
  `apps/server/src/defect-01.privilege-escalation.test.ts` (the walker fails without it), a regenerated route table in
  `docs/security/authorization.md` (`authorization-doc.test.ts` fails until it is; the test header says how) and, for a new object, its row in the field tables of
  that page. `response-fields.test.ts` checks the response schema by itself: a field named like a secret fails it.
- **Scoped paths.** `modules/core-identity/**` and `modules/core-authz/**` are scoped (implementation.md §8.4): a pull request that touches them updates the matching chapter
  file in `docs/security/asvs/`, or carries the label `asvs-no-impact` and, in the description, a line that starts exactly `ASVS impact: none because <reason>` (no comma
  after "because"; the check reads it with a pattern). `apps/web` and `packages/ui-kit` are not scoped, but their evidence goes into the chapter files (items 8 in sprints 2 to 4).
- A test never calls a third party; anything that runs a real process uses offline settings (`offlineDatabase` in `apps/server/src/cli.test.ts`).
- Every pull request carries a changeset. Write it for operators and API users: the web app now serves the UI, `BASE_PATH`
  behaviour, new routes and permissions.
- **New runtime dependencies are named in the pull request description.** Expected: `echarts` (named in CLAUDE.md, behind the
  adapter) and `openapi-fetch` or `hono/client` (Decision 4). Everything else is in-house or already present (`sanitize`
  package, DaisyUI, Tailwind). No component library, no state library, no i18n library (Decision 7).

## 3. Sprint overview

| Sprint | Branch                          | Theme                                                                                        | Closes                     |
| ------ | ------------------------------- | -------------------------------------------------------------------------------------------- | -------------------------- |
| 1      | `feature/m5-shell-foundation`   | `core.ui-shell`, catch-all route, `url()`, typed client, layout, themes, public pages        | defects 11, 12; ASVS 7.4.4 |
| 2      | `feature/m5-auth-profile`       | i18n, login, register, pending, reset, profile, sessions, re-authentication, linking, tokens | ASVS 6.2.6, 6.2.7          |
| 3      | `feature/m5-ui-kit-admin`       | `ui-kit` components, users, roles, settings forms                                            | none                       |
| 4      | `feature/m5-operations-release` | audit viewer, system, job runs, notifications, inbox bell, journeys, release                 | none                       |

Order matters. Sprint 1 settles the riskiest question (the catch-all route) and the API access pattern that every screen
uses. Sprint 2 needs only the shell. Sprint 3's `ui-kit` is used by sprint 4, so it cannot move after it. Sprint 4 holds the
screens with the least new design and the acceptance journeys.

Module graph after M5: `core.ui-shell` depends on `core.authz` (to decide what a caller may see) and `core.settings` (branding); not on `core.identity`, because the browser asks `/auth/me` itself (ADR-0027). It is the owner of the `ui.routes`, `ui.nav`, `ui.widget` and `ui.theme` registries. Other modules
contribute to them through an optional peer on `core.ui-shell` (a module must still start in a profile without the shell, as
`core.audit` does). The module's table prefix is not needed: it owns no table (Decision 5).

## 4. Sprint 1: shell foundation

**Branch:** `feature/m5-shell-foundation`. **Goal:** a signed-out and a signed-in visitor see the real layout; a page
contributed by a module through `ui.routes` renders under `/[...path]` with its permission checked; `BASE_PATH` works for any
depth; the legal pages work.

Work items

1. ADR-0027 and the prototype (§0 items 5 and 6). The ADR records: how the web process learns the registered `ui.routes`
   (Decision 2; the profile generator `profile:generate` writes `generated/ui.ts` too, and `pnpm generated:check` fails on a diff), how it reaches the API (Decision 3), **how
   the image runs two processes** (the web server is the public origin and proxies `/api` to Hono; today `docker/Dockerfile` starts only `scorpion start`), the typed client and
   **where the OpenAPI document comes from** (Decision 4: no route serves it today; it is generated from the route table at build time, and `/docs` needs a public route or a static
   page, with its `publicReason`), and the fallback if the catch-all fails.
2. Create `modules/core-ui-shell` with `module.ts`, `public.ts`, `README.md`. It declares the registries `ui.nav`
   (`{ id, label key, path, icon?, section, permission?, order }`), `ui.widget` (`{ id, slot, component, permission? }`) and
   `ui.theme` (`{ id, label key, colorScheme }`), and exports the route entry schema `{ path, permission?, public?, load,
component }`. Permission names are checked by the loader against the declared permissions. A `ui.routes` entry without
   `permission` or `public: true` fails at registration, as `createRoute()` does.
   _Sprint 1 outcome:_ the entry has two halves (ADR-0027): the server half is data in the registry (`{ path, permission }` or `{ path, public: true, publicReason }`), the browser half is `{ path, load, component }` in the module's `./ui` export; a test per module checks that they list the same paths.
3. **Navigation filtered by permission.** The server computes it: `GET /ui/navigation` (a **public** route, with a reason, because anonymous callers must get the public entries too; it needs no
   `core.ui-shell.nav.read` permission, the plan had one) returns the entries the caller may see, built
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
6. **Typed API client** (Decision 4) in `packages/contracts` (`@scorpion/contracts/client`, `openapi-fetch` over `pnpm openapi:generate`), generated from the same route definitions the server mounts, with
   `url()` built in, the CSRF header added to unsafe methods, and one error type for problem+json. No hand-written fetch URL
   in the web app (lint rule from §2).
7. **Session in the web layer.** `hooks.server.ts` forwards the cookie to the API, calls `GET /auth/me` once per request, keeps
   the CSRF token in server state for the page, and hands `{ user, roles, csrfToken }` to the layout. Cookie `Path` and
   `BASE_PATH` interplay is covered in the journey test of sprint 2.
8. **Layout** from FEATURES §3.19: header with drawer, brand (instance name from branding settings, logo swaps with theme),
   avatar menu **with a logout control that is reachable on every page that needs a sign-in** (`POST /auth/logout` with the CSRF header; ASVS 7.4.4), collapsible section sidebars with tooltips in the icon-rail state, footer (legal links, copyright, no
   hard-coded GitHub badge: the SPDX line becomes a branding setting or goes). Keyboard operable, landmarks, skip link.
9. **Themes:** `scorpionlight` and `scorpiondark` DaisyUI themes, `prefers-color-scheme` as the default, a manual toggle
   (light, dark, system) stored in a cookie-free `localStorage` entry with a safe fallback, no flash on first paint (an inline
   script allowed by a CSP nonce).
10. **Error page and error handling:** status, message, "Go home" with `url()`. `handleError` maps problem+json from the client
    to a user message; a 401 on a signed-in page redirects to login with a `returnTo` that is checked to be a path on this
    instance (an open-redirect test). Defect 12: a loader that cannot get its data throws; `defect-12.loader-errors.test.ts`
    fetches a page with a missing token and expects the error page and status, not a returned response.
11. **Public pages:** `/legal/terms`, `/legal/privacy`, `/legal/imprint` from `GET /legal/{page}` (sanitised on the server),
    `/docs` (the API documentation page; ADR-0027: a public page of the shell, rendered from the build-time OpenAPI document of the public v1 surface), and the declared public route list.
    Public routes are listed in one place (`PUBLIC_PAGES` in `modules/core-ui-shell/public.ts`) and a test (`apps/server/src/ui-routes.test.ts`) fails for a `ui.routes` entry that is public without being declared.
12. **Security headers and CSP** in the web hook; a test asserts the headers and that a page has no inline script without a
    nonce.
    **ASVS 7.4.4.** A Playwright test, tagged `[ASVS-7.4.4]`, signs in through the API (the login page is sprint 2), walks the navigation of a plain User and of an Admin, and finds the
    logout control on every page that needs a sign-in; a second step logs out and shows that the old cookie is refused. Move 7.4.4 to `pass` in `v7-session-management.yaml` with it.
13. Update the Dockerfile so the image includes the web app (the comment in `docker/Dockerfile` says it arrives with M5), and
    the CI image smoke test fetches `/` and `/health`. Dev: `pnpm dev` proxies as production does.

Definition of done: `pnpm check` and the tests of `core-ui-shell`, `contracts` and `web` pass. A test module contributes one page
and one nav entry in a fixture profile and both appear for a user with the permission and not for one without. The same
fixture runs under `BASE_PATH=/` and `/a/b/c`. Both defect tests pass. A profile without `core.ui-shell` still starts the
API. The first Playwright test replaces `smoke.spec.ts`: the start page loads, the header shows the instance name from
settings, the theme toggle works. ASVS 7.4.4 is `pass` with its tagged test, and `pnpm security:asvs` is green.

### Corrections found in sprint 1

Where the plan was wrong, the code and the ADRs won (ADR-0027 records each):

- **Decision 4:** the server did not "already produce" the OpenAPI document and no route serves it. It is generated at build time (`pnpm openapi:generate`, no database; `pnpm check` fails on a diff); the typed client is `openapi-fetch`, not `hono/client`; `/docs` is a page of the shell, not an API route.
- **`GET /ui/navigation`** is public (with a reason), not guarded by `core.ui-shell.nav.read`; the module declares no permission. It depends on `core.authz` and `core.settings`, not on `core.identity`.
- **A `ui.routes` entry** is two halves (server data, browser code), not one object with `load` and `component`.
- **SvelteKit 3** (not 2): `$lib` is `#lib`, there is no `svelte.config.js` (options go to the Vite plugin), hook types come from `@sveltejs/kit/hooks`, the error hook receives a `kind`, and environment variables are read from `process.env` by the node adapter. `paths.base` stays empty: the front of the web process takes `BASE_PATH` off every request, so one build serves any prefix.
- **The image** runs two processes when the profile has the shell (`scripts/image-run.ts`); `/metrics` is on the API's port (3001) and is not proxied; the API trusts the web process as a proxy (`TRUSTED_PROXIES` gets `127.0.0.1,::1`).
- **A kernel bug** surfaced by the first end-to-end run: `ctx.deps` was a snapshot taken when a context was made, and the server makes the context of `core.settings` before the kernel starts (`kernel.settingsOf()`), so every settings route answered 500 in a running server. Fixed, with a regression test.
- **The legal pages** show the API's title as the page heading; write the Markdown text from level 2 (`##`).

## 5. Sprint 2: i18n, sign-in, register, profile

**Branch:** `feature/m5-auth-profile`. **Goal:** register → pending → admin approves → user signs in → creates a PAT works in a
browser (the second half of the acceptance journey).

Work items

1. **Message catalogue** (Decision 7): typed keys, `en` and `de`, parameter interpolation, plural rule, in-house in
   `packages/ui-kit`; locale from the user's `notifications.locale` preference, then `Accept-Language`, then the instance
   default (the same order as ADR-0022). Vocabulary labels use the locale the API already returns. The two checks of §2.
2. **Login page** (`/login`): username and password, the OIDC buttons from `GET /auth/oidc/providers` (new public route in `core.identity`
   with `{ id, displayName, iconHash? }` only; the provider's icon is a blob hash, uploaded as in ADR-0018), error display for a
   refused login without saying which part was wrong. A throttled login is a 429 with `Retry-After`: show the wait time (the answer is the same for an unknown name). The page also
   shows the notice of `/login?notice=check-mail`: a provider sign-in did not link to an account that holds the same address, a mail went to that account, and nobody was signed in
   (the text does not say whether an account exists beyond what the mail already tells its owner).
   **ASVS 6.2.6 and 6.2.7:** every password field is `type=password`, and paste, browser password helpers and password managers work (no `autocomplete=off`, no paste block). A
   Playwright test tagged `[ASVS-6.2.6]` and another tagged `[ASVS-6.2.7]` cover login, register, reset and change; move both entries to `pass` in `v6-authentication.yaml`.
3. **Register page** and "check your mail" page: the server answers 202 for every request (ADR-0022), so the page says the
   same thing for a new and a taken address. The pending-approval page, shown to a signed-in user whose status is `pending`
   (the API's answer decides, not the client).
4. **Password reset and e-mail verification pages** at the paths the mails use (`/forgot-password`, `/reset-password`, `/verify-email`): request, confirm with the token from the **URL fragment** (it is
   in no server log and no `Referer`; the page reads it once, posts it and replaces the URL), verification result. A reset link lives 10 minutes: an expired or used link says to ask for a new one. The new
   password is judged by the server (breached or context-specific passwords are a 422 with a field error): show it, do not repeat the rules in the client.
5. **Profile page:** details (name, email, bio), role badges, avatar upload and removal (`PUT` and `DELETE /account/avatar`; `POST /files` is Admin's) with a client-side
   size check and the server's re-encode shown in the preview, **a "link a sign-in provider" action** (`POST /auth/oidc/{provider}/link`; there is no list of linked providers and no unlink route, both are in
   the backlog and stay there), change password (current and new), API tokens (create with scopes and expiry, show the secret once with a copy button and a warning, rotate, revoke), and the
   user's own preferences (locale, theme). Group membership (FEATURES §3.4) belongs to a later module and is not built.
   **Sessions section:** the caller's own sessions (`GET /account/sessions`: created, last seen, the current one marked; no device data exists), end one, and "log out everywhere".
   **Re-authentication dialog:** a shared component. Every `401 reauthentication-required` (email change, ending a session, log out everywhere, starting or confirming a link) opens it: the password
   first (`POST /account/reauthenticate`); on `409` (the account has no password) the buttons of the providers (`POST /account/reauthenticate/oidc/{provider}`). On success the action is repeated. The OIDC
   callback returns to the application root with no return path, so the page stores the intended action in `sessionStorage` before it leaves and the shell repeats it after the return (the path is
   checked as in the `returnTo` rule, and the entry is removed when used). No API change is planned for this; if the prototype shows one is needed, take it to the maintainer first.
   **Link confirmation page** (`/link-sign-in#token=…`): signed in (else the login page with a `returnTo`), a recent authentication, then `POST /account/oidc-link/confirm`; the answer names the provider.
6. **Bootstrap:** when no administrator exists, `/` offers the first-admin form (`POST /bootstrap/first-admin`) and nothing else
   is reachable; after the first admin it is gone. Test that the form is unreachable after bootstrap.
7. **Playwright journeys** (both `BASE_PATH=/` and `/a/b`): register → pending screen → admin approves → user signs in → creates
   a PAT → the PAT works against the API; logout → the old cookie fails (defect 4 seen from the browser); a copied login-return
   URL to another origin is refused; an email change asks for the password in the dialog and succeeds after it; a second browser context ends the first one's session from the session list.
8. **ASVS:** 6.2.6 and 6.2.7 move to `pass` (item 2). Add the browser evidence to V6, V7 and V10 where a note can now cite a journey (cookies under `BASE_PATH`, CSRF in forms, the re-authentication
   dialog for 7.5.1 and 7.5.2) and tag the journey tests. The three entries must not stay `fail`: Gate 1 needs none.

Definition of done: the journeys above pass in CI under both base paths. 6.2.6 and 6.2.7 are `pass` with tagged Playwright tests; `pnpm security:asvs` is green and shows no `fail` entry at all. No password, token or reset secret appears in a
Playwright trace, a server log, or the browser's URL history after use (a test greps the trace and the log stream). The register
page gives the same response for a taken and a free address. Missing German keys fail the build.

### Corrections found in sprint 2

Where the plan was silent or wrong, the code and the maintainer's answers won:

- **Bootstrap needed a route.** No route said whether an administrator exists, so the web app could not know when to show the first-admin form. Added the public `GET /bootstrap/status`
  (`{ needsFirstAdmin }`; maintainer's decision). The form is the page `/setup` and not `/first-admin`, because the navigation answer of a plain User must contain nothing that matches "admin"
  (the test of ASVS 7.4.4 greps it). While an Admin is missing, `/` shows the form and every other path redirects to `/`; afterwards `/setup` is a 404.
- **The pending-approval page is shown on the sign-in page, from the answer of the API.** A pending account never has a session (the login answers 403 and sets no cookie), so there is no "signed-in
  user whose status is pending". The 403 now carries the problem type `account-pending` (and `local-accounts-disabled` for the other 403; maintainer's decision), and the sign-in page shows the page for the first.
- **Language order.** The instance default (a setting of `core.notifications`) has no public route; the order is the person's preference, `Accept-Language`, English (maintainer's decision; backlog).
- **`GET /auth/oidc/providers`** is paged like every list (`{ metadata, result }`), and a provider setting got `iconHash`.
- **Access-token scopes** are chosen from the permissions of the role `user`, as no route lists the caller's own (backlog).
- **The theme preference** stays the header toggle (a browser setting), not a profile field (backlog).
- **The re-authentication return** is `takeReturn()` in the layout plus `takeIntent()` in the page that asked, with the path, an intent and a time kept in `sessionStorage` for ten minutes. The plan said "the shell repeats it"; a
  closure cannot survive a page load, so the page that asked repeats its own action from a small description.
- **The Playwright projects** are four: `root` and `nested` for every journey, and two fresh installs (no administrator) that run only `bootstrap.spec.ts`.
- **No secret in a trace.** A trace of the network necessarily holds a password in the body of the request that sends it, and a token in the body that makes or spends it; the test
  (`secrets.spec.ts`) therefore reads the trace and fails for a secret **anywhere else** (an address, a header, the wrong body, storage, the log). The text a test types is in the action log of the
  trace and is not the application's doing.

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
   `GET /users/{id}/roles`, `GET /users/{id}/tokens`, `POST /users/{id}/deactivate`, each with its own permission, a denied-for-User test, an audit flag, an entry in the defect-1 matrix and a row
   in `docs/security/authorization.md`. `POST /users/{id}/sessions/revoke` exists since M4b (the screen calls it). **Deactivating an account ends its sessions in the same transaction** (ASVS 7.4.2, with a test), and
   "last Admin" is decided by assignments today (backlog: it may need to count active accounts). The new identity routes are in a scoped path: update the V7 and V8 files, or label the pull request.
7. **Admin → Roles:** list with permissions grouped by module, edit the permissions of non-Admin roles through a new
   `PUT /roles/{key}/permissions` in `core.authz` (scoped path: V8 file or label; the permission is `core.authz.role.manage`, which no route uses yet) (calls `setRolePermissions`, emits the event M4 added, `audit: true`). Creating
   and deleting custom roles stays in the backlog.
8. **Admin → Settings:** the module list from `GET /settings`, a `SchemaForm` per module from `GET /settings/{module}/schema`,
   save with the version, secrets page (names and "set / not set", set and delete, a value is never shown; Decision 8 on
   declaring secrets), vocabularies (terms, labels per locale, order, deactivate), branding with logo upload.
9. **The page the pending-approval mail links to** (`/admin/users/pending`, the list of item 6 filtered to pending), and a confirm dialog on the two session-ending actions ("end every session of everybody" is destructive).
10. **Navigation entries** for the Admin section contributed by the modules themselves through `ui.nav` (identity, authz,
    settings, audit, notifications), not listed in the shell.
11. Accessibility: an axe run over every screen of this sprint in the Playwright suite; keyboard-only path through the user
    approval and the settings form.

Definition of done: a plain User sees no Administration navigation and gets 403 on every admin path and every new route. An
Admin approves a user, changes that user's role, edits a role's permissions and a setting from the browser. The last Admin cannot
be removed from the UI (the error is shown). The `ui-kit` components each have a unit test, a keyboard test and an axe check.

### Corrections found in sprint 3

Where the plan was silent or wrong, the code and the maintainer's answers won:

- **Roles and Settings pages are the shell's, not `core.authz`'s and `core.settings`'s** (items 7, 8 and 10; maintainer's decision). `core.ui-shell` depends on both, and the kernel counts an optional peer as an edge of the module graph (`graph.ts`), so a contribution to the shell's registries from either module is a dependency cycle that stops the start. The pages and the navigation entries `Roles` and `Settings` live in `modules/core-ui-shell/ui/admin/`; `Users` and `Pending approvals` are `core.identity`'s. The `admin` section label is the shell's (a key cannot be defined by two modules). The plan's list of "modules contribute their own entries (identity, authz, settings, audit, notifications)" holds for identity, audit and notifications only; audit and notifications bring theirs with their screens in sprint 4.
- **Change an e-mail address and force a reset for another person are not built** (item 6; maintainer's decision). No route acts on another user's address or password, the plan's route list has none, and both go to the backlog.
- **The "last Admin" counts accounts that can sign in** (item 6; maintainer's decision). An account status `deactivated` was needed (migration `0009`, an addition to the check constraint); deactivating and removing the Admin role take one advisory lock, so two administrators cannot each remove the other. The rule is identity's (core.authz counts assignments and cannot see accounts, ADR-0014) and is checked after authz's own rule, inside the same transaction.
- **New permissions** `core.identity.user.read` (list, one account, roles of a user) and `core.identity.user.deactivate`; `GET /users/{id}/tokens` uses the existing `core.identity.token.manage-any`, and revoking another person's token is the existing `DELETE /tokens/{id}`, which that permission already allowed (maintainer's decision on scopes).
- **`core.authz` has a route now** (`PUT /roles/{key}/permissions`). `module.test.ts` said "registers no route of its own"; it now says "registers exactly one route and touches no system method", and the file test that no route names the system methods of ADR-0015 is unchanged.
- **Secrets: "set / not set" is "set" only** (item 8). Showing a secret that is not set needs the registry of declared secrets (decision 6: only if the first form needs it). The page lists the stored names and lets an Admin set, replace and delete; the backlog keeps "declared secrets".
- **The form errors are dotted paths, not JSON pointers** (item 1). The API names a field `sessions.absoluteDays` (and `values.` in front for a settings body); `SchemaForm` reads both forms, and drops the prefix it is told (`errorPrefix`).
- **The settings convention is Zod's `.meta({ title, description, group, order, widget })`** as decision 6 says; the plan's item 1 wrote `x-group` and `x-order`, which are accepted too. The schemas of the five shipped modules got titles, descriptions and the `logo` widget for the logos and the provider icon.
- **The component specs run on a harness page**, not on a demo page of a profile (item 3): a small Vite app in `apps/web/e2e/components/harness` mounts one scene of the shared components, is built and served by the Playwright set-up, carries the application's Content-Security-Policy in a meta tag and fails a test for any policy violation. `pnpm test:e2e` runs it as the project `components`. Nothing of it ships.
- **Zod is set to `jitless` in the client.** The page's policy has no `unsafe-eval`, and zod tries `new Function` on first use; the harness showed the violation report.
- **The vocabularies page needs `core.settings.vocabulary.write`**, not the read permission: reading terms is self-service (forms need them), so a page that needed only that would have opened to every User.
- **Axe findings the components needed fixed**: inactive tabs and the head of a chart table used DaisyUI's 50 to 60 % text colour (contrast), and a dimmed table while loading failed too; the loading state is a status line above the table now.

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
   cuts it. ADR-0028 records the design. Tests: two kernels over one database (a delivery on one reaches a stream on the
   other), the caps, the end on logout (defect 4 seen from a stream), and a plain User cannot open another user's stream.
5. **Preference form** for notifications: switches per mandatory and optional kind, mandatory ones shown as locked with the reason;
   the form reads the registered preference keys, as the backlog asks.
6. **Dashboard** at `/`: the widget slot (`ui.widget`) with the cards core modules can offer (pending approvals for a reviewer, dead
   deliveries for an administrator). No KPI widgets; those are M13.
7. **Acceptance journeys** in Playwright under `BASE_PATH=/` and `/a/b` in CI: register → pending → admin approves → user signs
   in → creates a PAT; a User never sees the Administration navigation (assert the DOM and a direct URL visit); an Admin changes
   a setting and the audit viewer shows the entry with the right actor; a dead mail is requeued from the status screen.
8. **ASVS:** update V6, V7, V8 and V10 for the new evidence and run `pnpm security:asvs`. No `fail` entry may remain (6.2.6, 6.2.7 and 7.4.4 were closed in sprints 1 and 2). What is left for Gate 1 are the human fields of the
   four files and the maintainer's first and second pass; M5 does not fill them.
9. **Release 0.7.0** as in CONTRIBUTING.md: release branch from `dev`, `pnpm changeset version`, PR into `main`, annotated tag,
   tag `v0.7.0` and the merge-back on a `feature/…` branch. **No manual image build at the release:** nothing is deployed yet (maintainer, 2026-10-07). The CI image jobs still build and smoke test every profile on
   each pull request, and the web app is in them from sprint 1, so a broken image is caught before the release.

Definition of done: the four acceptance journeys pass in CI under both base paths; no serious axe violation on any screen;
`pnpm check`, the full `pnpm test` and `pnpm test:e2e` are green on `dev` after the merge; `0.7.0` is tagged and merged back into `dev`.

### Corrections found in sprint 4

Where the plan was silent or wrong, the code and the maintainer's answers won. Sprint 4 went into two pull requests (the operations screens, then the inbox, the dashboard and the journeys); this part is the first.

- **The audit list pages by offset, not by keyset.** The plan says "keyset load more"; `GET /audit` has pages (0-based, the legacy envelope) and its CSV export reads by keyset. "Load more" asks for the next page and keeps each id once (backlog: a cursor on the list).
- **The list view is no longer audited** (item 1; maintainer's recommendation taken). The Logs page pages and refreshes it, and an entry per page would fill the table it reads. Opening one entry and the CSV export stay audited. A refused read of the list (403) is not on record either (backlog).
- **The user column is joined in the API, not in the page.** `GET /audit` and `GET /audit/{id}` carry `userName`, read through the public service of `core.identity` (`core.audit` already depended on it), so the page makes no call per row and an account that was purged is `null`. The page says "deleted account" and shows the first characters of the id.
- **`GET /system/job-runs`** has the permission `core.audit.system.read` (item 2), the list envelope, the filters `jobName` and `status`, and the masked `error` and `result` the kernel keeps. `pnpm test:contract` is still the stub of M8, so the "contract test" is the route test that reads the real answer (`audit-routes.test.ts`) and the generated OpenAPI document.
- **"Requeue" and the test mail need no recent authentication** (they are audited, not step-up); the notification and outbox requeues answer 403, 404 and 409 on the page in words.
- **The retention numbers on the System page are read-only with a link.** They are settings of `core.audit`; the generic settings form already edits them (with `omitDefaults`), so the page shows the five numbers and links there instead of repeating a form.
- **The privacy text is the operator's, not ours.** The legal texts are Markdown the operator writes in the branding settings; the repository has no default text. The sentence "the id of a deleted account stays in the audit trail until the retention period ends" is in the description of that setting and in the README of `core.audit`.
- **Item E (OIDC callback)** was decided with the maintainer on 2026-10-08: a browser (`Accept: text/html`) is redirected to `/login?error=<code>`, any other client keeps the problem answer; the codes are a fixed list. ADR-0029 records it.
- **Item F** (`GET /permissions`, `GET /account/permissions`) went into the first pull request, as the maintainer chose. `GET /permissions` needs `core.authz.role.read`; `GET /account/permissions` needs the new permission `core.authz.account.read`, which `core.authz` gives to the role `user` through `authz.defaultRole`. An access token sees only its scopes (scope ∩ owner). Both are in `core.authz`, which had a route of its own already (`PUT /roles/{key}/permissions`).
- **Item A** is done in the form, not in the API: `omitDefaults(values, describeRoot(schema))` drops every value that equals its default before `PUT /settings/{module}` (an object that is not the default keeps only its changed keys). The server stores what it is given, so nothing else changed; values saved earlier keep their defaults until they are saved again.
- **Item B**: removing an item asks first (the dialog of `ConfirmDialog`); an item nothing was typed in is removed at once.
- **Item C**: `API_TIMEOUT_MS` is a limit on **silence** (no answer yet, or a pause in the body), not on the whole time, so a long CSV download is not cut off while it flows. The proxy answers 504; the page server's own calls to the API use the same value. An event stream is exempt once its headers say `text/event-stream`.
- **Item D**: the rejection mail already named the contact address. What was missing is the screens: the "check your mail" page and every refusal of a password say whom to ask, the same way for every reason (so a declined registration is not told from a wrong password), with the contact address from the branding settings and the instance name when there is none.
- **The bell, the dashboard cards and the notification preferences are pages of `core.notifications` and `core.identity`**, not of the shell; the first pull request does not have them (see the second part).

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
| ASVS 7.4.4: a logout control on every page that needs a sign-in           | Playwright test tagged `[ASVS-7.4.4]` (sprint 1)                                            |
| ASVS 6.2.6 and 6.2.7: password fields, paste and password managers        | Playwright tests tagged `[ASVS-6.2.6]` and `[ASVS-6.2.7]` (sprint 2)                        |
| The re-authentication dialog and the session list work in a browser       | `e2e/sessions.spec.ts` (sprint 2), two browser contexts                                     |

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
- A list of the linked sign-in providers and a way to unlink one (backlog, credentials follow-ups); a notice mail when a provider is linked.
- Create and delete custom roles; a bulk "requeue all"; full-text audit search; saved audit filters.
- A PWA, offline mode, mobile app.
- Visual regression testing.
- Per-module help pages and a product tour.

## 10. Decisions taken (2026-10-05)

They are the blocking ones for sprint 1; the smaller ones appear in the sprint they affect. Each entry shows the answer first.

1. **M4a first: yes, done** (the plan is [m4a-sprint-plan.md](m4a-sprint-plan.md); released in `0.6.0` with M4b), as a short separate milestone (a sprint of its own, a docs and CI pull request) before
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
   loader do not give. Recommended: generate the client from the OpenAPI document (`generateOpenApiDocument` in `packages/contracts` builds it from the route table; no route serves it yet, so the build generates it and ADR-0027 decides
   whether `/docs` also gets a public route) with `openapi-fetch` plus `openapi-typescript`, two small dependencies; the client stays typed and tested against the contract
   tests. `implementation.md` names `hono/client`; this changes the wording and needs a line in ADR-0027.
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
   right, and the web proxy of Decision 3 must stream. Polling stays as the fallback. Recorded in ADR-0028 and the risks.

## 11. Additions to M5's scope in `implementation.md` (to approve with this plan)

- `core.ui-shell` is a module with the `ui.nav`, `ui.widget` and `ui.theme` registries and `GET /ui/navigation`; navigation is
  filtered on the server.
- The typed client is generated from the OpenAPI document (Decision 4) and shared with `url()`; both live in `packages/contracts`.
- New routes the screens need: `GET /auth/oidc/providers`, user management (`GET /users`, `/users/{id}`, `/users/{id}/roles`,
  `/users/{id}/tokens`, deactivate; revoking sessions exists since M4b), `PUT /roles/{key}/permissions`, `GET /system/job-runs`, `GET /ui/navigation`.
- `GET /inbox/stream` (server-sent events, unread count only) in `core.notifications`, with ADR-0028.
- Screens: inbox bell, notification preferences, audit viewer, system page and job runs join the list in M5.
- Acceptance additions: no secret in a browser trace or log; CSP and security headers; axe checks on every screen; the lint rules
  that make the typed client, `url()`, `SafeHtml` and thrown loader errors mandatory.
- The web app is in the profile images from sprint 1, and the CI image jobs smoke test it; the release itself builds no image (nothing is deployed yet).
- M5 closes ASVS 6.2.6, 6.2.7 and 7.4.4 with tagged Playwright tests; after it no `fail` entry remains in V6, V7, V8 and V10.

## 12. Risks

| Risk                                                                                                                               | Impact                                                             | Mitigation                                                                                                                              |
| ---------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------- |
| The catch-all route limits SvelteKit (per-route SSR options, streaming `load`, preloading)                                         | Rework of the shell after screens exist                            | Prototype in the first days of sprint 1 (§0 item 5); fallback: generated filesystem routes from a build step                            |
| The `__Host-session` cookie (`Secure`, `Path=/`) is refused on `http://localhost` in a test browser, or a proxy drops `Set-Cookie` | Every journey fails to sign in                                     | Checked in the first days of sprint 1 (§0 item 6); fallback: the test server serves HTTPS with a local certificate                      |
| The fragment token or the re-authentication return is lost (a redirect drops `#token`, the OIDC callback has no return path)       | Reset, verify and link pages and the re-authentication dialog fail | Pages read the fragment before any redirect; the intended action is kept in `sessionStorage` and removed when used; journeys cover both |
| The OpenAPI-generated client drifts from the server or loses the problem+json types                                                | Runtime errors the compiler did not catch                          | Generate in `pnpm check`, fail on a diff; one test calls each client function against the contract fixtures                             |
| CSRF token handling breaks under SSR (the server renders a page and the browser then posts)                                        | Writes fail with 401 after a reload                                | The layout gets the token from `/auth/me` on every request (ADR-0007); a journey reloads before every write                             |
| `BASE_PATH` bugs come back in places not covered (assets, redirects, cookie path, OIDC callback)                                   | Defect 11 returns                                                  | Every journey runs under `/a/b`; the lint rule bans literal paths; `url()` is the only constructor                                      |
| Server-rendered Markdown or an admin-entered text reaches the DOM unsanitised                                                      | Stored XSS in a security milestone                                 | One `SafeHtml` component, a lint rule, a hostile-text e2e test, CSP without `unsafe-inline`                                             |
| Admin screens grow beyond three weeks (settings forms for every module, user management)                                           | Release slips                                                      | Sprint 3 builds three areas only; further forms are generated from schemas and add no new code per module                               |
| E2E tests are slow or flaky in CI (Postgres, server, web, browser in one job)                                                      | Two CI runs per sprint grow, flakes block merges                   | Journeys, not screens; reuse one server per project; the known 57P01 teardown flake is fixed or tolerated before sprint 1               |
| SSE connections tie up server resources or are cut by proxies, and a stream outlives a revoked session                             | Exhaustion, or a revoked session still receives counts             | Per-user and global caps, session re-check on each heartbeat, polling fallback, a test for the end on logout, no content on the stream  |
