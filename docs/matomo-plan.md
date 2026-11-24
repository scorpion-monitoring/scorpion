# M13b Plan: usage statistics with Matomo

Status: **built on 2026-11-24** (sprint 1, `feature/m13b-matomo`), decisions in §3. Open: the spike against a real Matomo (§2, "Unique users").
Why a milestone of its own: the maintainer asked on 2026-11-24 for a way to connect a deployed instance to a Matomo
instance and see how the instance is used. It is not in the milestone plan. The Matomo item in `implementation.md` §10 and
the `ingestion.adapter` row of `architecture.md` is a different feature: it pulls Matomo numbers of _registered services_ into
their KPIs. This plan is about the use of the Scorpion instance itself. The two stay separate modules (they may share a
small client later).

Size S: **one sprint, one pull request** (`feature/m13b-matomo`), with **one new module** (`matomo`), **no table**, **no new
runtime dependency**, no public v1 change. The decision record is [ADR-0054](adr/0054-usage-statistics-with-matomo.md).

## 1. What was found in the source (checked 2026-11-24 on `dev`)

| Topic               | Finding                                                                                                                                                                                                                                                                                                                                |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Page CSP            | Static, in `apps/web/vite.config.ts` (`kit.csp`, nonce mode): `script-src 'self'`, `connect-src 'self'`, `img-src 'self' data:`, `default-src 'none'`. `apps/web/src/hooks.server.ts` already rewrites the header after `resolve` (`withStyleNonce`, `apps/web/src/lib/server/csp.ts`), so a second pure rewrite has an obvious place. |
| API CSP             | `apps/server/src/pipeline/security-headers.ts` covers API responses only. It does not change here, and no ASVS-scoped path is touched.                                                                                                                                                                                                 |
| Navigation          | SvelteKit navigates on the client. The snippet Matomo suggests tracks one page view per full load, so it would miss almost every page.                                                                                                                                                                                                 |
| Tokens in addresses | `/reset-password` and `/link-sign-in` carry their token **in the address fragment** (`modules/core-identity/ui/routes.ts`). By default the Matomo tracker sends the fragment with the page URL.                                                                                                                                        |
| Ids in addresses    | Pages such as `/admin/users/:id` and `/services/:slug` put ids and slugs in the path. The `ui.routes` patterns the shell already holds name each page without them.                                                                                                                                                                    |
| Shell seams         | `ui.widget` entries with a `slot` are rendered by `<Widgets slot="…" />` in `apps/web/src/routes/+layout.svelte` (slots `header` and `dashboard` today). A widget may be `public: true`.                                                                                                                                               |
| Settings            | A module declares a Zod schema in its manifest. The admin settings form (`SchemaForm`) draws it from `.meta()`. Reads are cached for 5 seconds (`core.settings` README). Secrets live only in the secrets store.                                                                                                                       |
| Referrer            | `referrer-policy: no-referrer` on every page, so Matomo sees no internal referrers. It stays this way.                                                                                                                                                                                                                                 |

## 2. Scope

### The module

| Part                                  | Value                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| id / package                          | `matomo` → `modules/matomo`, `@scorpion/matomo`                                                                                                                                                                                                                                                                                                                                                                                                |
| dependencies                          | `core.settings` (settings, the secret for the pseudonymous id), `core.ui-shell` (route, nav and widget types)                                                                                                                                                                                                                                                                                                                                  |
| tables, migrations, jobs, events, CLI | none                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| permissions                           | none of its own. The settings are edited with `core.settings.write` in the existing admin settings form, and the secret with `core.settings.secret.write`.                                                                                                                                                                                                                                                                                     |
| route                                 | `GET /api/internal/matomo/tracker`, `public: true`: anonymous visitors are counted too, so the browser needs the configuration before anyone signs in. It answers `{ enabled: false }`, or the tracker's URL, site id and flags, which is no more than the tracker script itself shows. Rate limited (default group). For a signed-in caller with `pseudonymousUserId` on, it also returns that caller's pseudonymous id (§2, "Unique users"). |
| UI                                    | one invisible widget, `matomo.tracker`, `public: true`, in a new shell slot `page-end`                                                                                                                                                                                                                                                                                                                                                         |
| profiles                              | in `full`, **off** until an administrator turns it on. Not in `core-only`.                                                                                                                                                                                                                                                                                                                                                                     |

### Settings

| Key                  | Default | Meaning                                                                                                                                                 |
| -------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `enabled`            | `false` | Turns tracking on                                                                                                                                       |
| `url`                | none    | Base URL of the Matomo instance. `https:` only, at most 200 characters, no query or fragment. Required when `enabled` (refine, 422 with the field path) |
| `siteId`             | none    | Positive integer. Required when `enabled`                                                                                                               |
| `cookieless`         | `true`  | `disableCookies`: Matomo sets no cookie                                                                                                                 |
| `respectDoNotTrack`  | `true`  | No tracking when the browser sends Do Not Track or Global Privacy Control (`navigator.globalPrivacyControl`)                                            |
| `pseudonymousUserId` | `false` | For signed-in people, send a keyed hash of the user id as Matomo's user id (see "Unique users")                                                         |

No other personal data is sent: no name, address, e-mail or role, and no custom dimensions. The privacy text of the
instance stays in the legal texts of `core.settings` (CLAUDE.md rule 9). The module README tells the operator what to add
to it.

### How it works

As built (sprint 1); the first draft of this section had the configuration in the layout's data, which the widget does
not need.

1. **CSP.** `hooks.server.ts` asks `GET /matomo/tracker` without the visitor's cookie (`createTrackingOrigin`,
   `apps/web/src/lib/server/tracking.ts`) and keeps the origin for 5 seconds, the bound of a settings change. A 404 (the
   profile has no `matomo`), `enabled: false` or an API that does not answer means no origin. A new pure function
   `withExtraOrigin(policy, origin)` in `apps/web/src/lib/server/csp.ts` adds the origin to `script-src`, `connect-src` and
   `img-src` of a page's policy (one with a script nonce). It refuses anything but a plain `https:` origin without a
   wildcard, never adds `'unsafe-inline'` and never touches the other directives. The hook applies it after
   `withStyleNonce`.
2. **Tracker.** `modules/matomo/ui/Tracker.svelte` is part of the web bundle, so `'self'` already covers it: no inline
   script and no nonce. It fetches its configuration with the typed client, sets up `_paq` and adds
   `<script src="{url}matomo.js" async>`. It sends a page view when the path changes (a new query, such as a search, is
   not a new page). When somebody signs in or out it asks for the configuration again, for the pseudonymous id.
3. **Shell.** Two small generic seams; the shell never names Matomo (CLAUDE.md rules 7 and 10):
   - the slot `<Widgets slot="page-end" />` at the end of the root layout;
   - `Shell.onNavigated(listener)` (`packages/ui-kit/src/context.ts`). A module's Svelte code cannot import `$app/*`, so
     the shell tells a widget about each navigation. It calls the listener at once with the page on screen, then after
     every navigation, with `{ pattern, pathname, status }`. `pattern` is the registered pattern from the catch-all route,
     or `null` on an error page (`apps/web/src/lib/shown-page.ts`).

### What reaches Matomo (the rules that need tests)

- **The path only.** `setCustomUrl(origin + basePath + pattern)`: the query and the fragment are always dropped, so a reset
  or sign-in link token never leaves the browser.
- **The pattern, not the id.** The page's registered `ui.routes` pattern is sent (`/admin/users/:id`, `/services/:slug`).
  The catch-all route already resolves it. An error page is sent as `/(error)` and a page without a pattern as
  `/(unknown)`. The page title is the pattern too, because a title can hold a name.
- **No link or download tracking.** It would send addresses.
- **Every page is counted** (decision 2), the public catalogue and the signed-in and admin pages alike.
- **No opt-out iframe.** `frame-src`/`frame-ancestors` would block it, and cookieless mode with DNT/GPC is the stance of this
  milestone. A consent mode is backlog (§4).

### Unique users (decision 3)

Without cookies, Matomo recognises a visitor by a hash of the IP address, the browser configuration and its language
(the "config id"). What that gives:

| Number                                                                 | Cookieless only                                                                  | With `pseudonymousUserId`                                   |
| ---------------------------------------------------------------------- | -------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| Visits, page views, pages, entry and exit pages, time on page          | good                                                                             | good                                                        |
| Unique visitors **per day**                                            | a good estimate                                                                  | exact for signed-in people, the estimate for anonymous ones |
| Unique visitors per week, month or year                                | **too high**: a person seen on several days, or from a new address, counts again | exact for signed-in people                                  |
| People behind one address (an institute network) with the same browser | **merged** into one                                                              | apart when signed in                                        |
| Returning visitors                                                     | not reliable                                                                     | reliable for signed-in people                               |

So cookieless mode alone gives meaningful **daily** numbers and usage patterns, but no reliable unique users over longer
periods. `pseudonymousUserId` closes that gap for signed-in people without a cookie. The id is
`HMAC-SHA256(secret, userId)` (hex, truncated to 32 characters). The server computes it from the secret
`matomo.user-id-key` (secrets store, set with `pnpm scorpion set-secret matomo.user-id-key`), so Matomo never sees a
Scorpion user id and nobody can reverse the hash without the secret. Deleting the secret and setting a new one breaks the
link to earlier ids, which is the way to start over. It is pseudonymous data under the GDPR, so the option stays off until the
operator turns it on and mentions it in the privacy text. If the option is on and the secret is missing, the route answers
without an id and the log says so once (never the value).

**Still open: a spike against a real Matomo** (the operator's or a local container), to confirm the table above for the
Matomo version in use, in particular whether its config-id salt changes daily. It was not run in sprint 1: the end-to-end
tests use a stub Matomo. Until it is run, the README presents the table as the expected behaviour (`docs/backlog.md`).

### Work items

1. `modules/matomo`: `module.ts`, `public.ts`, `settings-schema.ts`, `service/tracker.ts` (`tracker(actor)`, the HMAC),
   `routes.ts`, `ui/` (widget data, `Tracker.svelte`, the pure rules in `tracking.ts`), `README.md` (manifest, settings,
   what is sent, unique-user table, privacy-text checklist).
2. Shell slot `page-end`, `Shell.onNavigated`, `createTrackingOrigin`, `withExtraOrigin`, and the hook and layout wiring in
   `apps/web`. The test harnesses of the web app get a no-op `onNavigated`. `scripts/sync-workspace-modules.ts` quotes a
   module id only when it must: `matomo` is the first id without a dot or dash, and Prettier would otherwise make the
   generated file stale.
3. `pnpm modules:sync`, add the module to `profiles/full.ts`, `pnpm openapi:generate`, `pnpm profile:generate full`.
4. ADR-0054 is Accepted. A changeset (`minor`: a new module operators can turn on). Backlog entries (§4).

### Tests

- **Unit, table-driven:** the settings schema (http, a query or fragment in `url`, `enabled` without `url` or `siteId` → 422);
  `withExtraOrigin` (adds to the three directives only, keeps the nonce, idempotent, no change when off); `scrubUrl` (query,
  fragment, `:id` and `:slug` patterns, a base path of two segments, unknown paths); the HMAC (stable, differs per secret).
- **Integration (Testcontainers):** `getTrackerConfig` is disabled by default and returns the saved configuration; a change
  is seen within the 5-second cache bound; the route answers anonymously with exactly the declared fields; the
  pseudonymous id comes back only for the signed-in caller, only with the option on, and never as the raw user id; a missing
  secret gives no id and no 500.
- **Playwright** (Matomo stubbed with a route intercept): with tracking on, the CSP header holds the origin and a
  client-side navigation sends one hit with a path-only, pattern URL; `/reset-password#token=…` sends no token; with
  tracking off, no third-party request goes out and the CSP header is unchanged; `e2e/security-headers.spec.ts` passes in
  both modes.
- **ASVS:** no scoped path changes (`tools/asvs-report/scope.ts`). The pull request carries `asvs-no-impact` and
  `ASVS impact: none because the module and apps/web are outside the scoped paths; the page CSP widens only to the
configured Matomo origin`.

## 3. Decisions

| #   | Question                                | Answer (2026-11-24)                                                                                                                                                                                                                     |
| --- | --------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Where in the plan?                      | A small milestone **M13b**, now                                                                                                                                                                                                         |
| 2   | Which pages are counted?                | **All of them**, public, signed-in and admin pages                                                                                                                                                                                      |
| 3   | Is a consent banner needed?             | **No**, as long as cookieless mode gives meaningful numbers, unique users included. §2 "Unique users" shows that it does per day and not over longer periods. The opt-in `pseudonymousUserId` covers signed-in people without a cookie. |
| 4   | Browser tracker or a same-origin proxy? | **The browser tracker** (ADR-0054). The proxy is backlog.                                                                                                                                                                               |

## 4. Not in this milestone (backlog)

- **Consent mode:** `requireConsent` and a banner, if an instance's data protection officer asks for it.
- **Same-origin proxy:** the module serves `matomo.js` and forwards hits with `token_auth` and `cip` from the secrets
  store. The CSP stays `'self'`, ad blockers can't block it, and the address can be shortened before it leaves.
- **Events** (exports, searches, wizard steps) as Matomo events, through a small client-side port that other modules can call.
- **The Matomo pull adapter** of `kpi.ingestion` (`implementation.md` §10), unchanged.
