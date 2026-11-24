# ADR-0054: Usage statistics with Matomo

- Status: Accepted (M13b)
- Date: 2026-11-24
- Plan: [M13b plan](../matomo-plan.md)

## Context

Operators want to know how their instance is used: which pages, how often, and by how many people. Many of the target
institutions already run a Matomo instance. Scorpion has no usage tracking today, and its web app has a strict page CSP
(`default-src 'none'`, `script-src 'self'` with nonces, `connect-src 'self'`; ADR-0027, ADR-0042), so no third-party
script can load.

Tracking a research infrastructure's own users is personal data processing under the GDPR, and a cookie needs consent
under the German TTDSG § 25. The pages of the web app also carry data that must not leave the instance: the tokens of
mailed links sit in the address fragment (`/reset-password`, `/link-sign-in`), and paths hold ids and slugs.

Options considered:

1. **Browser tracker, direct.** The page loads `matomo.js` from the operator's Matomo and sends hits there. This is the
   standard set-up operators know. It needs the page CSP to allow that one origin.
2. **Same-origin proxy.** The server serves the tracker script and forwards hits with `token_auth` and the client address.
   The CSP stays `'self'`, ad blockers can't block it, and the address can be shortened before it leaves. The cost is a proxy
   on a public route, a secret, and rate limiting.
3. **Server-side page views** from the web app's `handle` hook. No script, but no browser data (screen, time on page) and
   the same need for a token as option 2.

## Decision

1. **A module of its own, `matomo`**, with no table and no permission of its own. Its settings (`enabled`, `url`, `siteId`,
   `cookieless`, `respectDoNotTrack`, `pseudonymousUserId`) are edited in the settings form of `core.settings`. It is in the
   `full` profile and off until an administrator turns it on.
2. **Option 1, the browser tracker.** The tracker is a component of the module's UI in the web bundle (covered by
   `'self'`), rendered as a `public` widget in a new generic shell slot `page-end`. It tracks one page view per page,
   through a new generic `Shell.onNavigated` that tells a widget about each navigation (a module's Svelte code cannot
   import `$app/*`). A change of the query alone is not a new page.
3. **The page CSP widens at runtime, only to the configured origin, and only when tracking is on.** The web app asks the
   tracker route without the visitor's cookie and keeps the origin for 5 seconds. A pure function next to
   `withStyleNonce` adds it to `script-src`, `connect-src` and `img-src`, and only a plain `https:` origin without a
   wildcard. Nothing else changes: no `'unsafe-inline'`, no new directive. With tracking off, or without the module, the
   header is byte for byte what it is today. After tracking is turned off, the origin stays in the header for at most
   5 seconds.
4. **Matomo receives the route pattern, never the address.** The URL sent is the base path plus the matched `ui.routes`
   pattern (`/admin/users/:id`), `/(error)` on an error page. Query and fragment are always dropped, the title is the
   pattern too, and link and download tracking stay off. No name, e-mail, role or raw user id is sent.
5. **Cookieless by default, honouring Do Not Track and Global Privacy Control.** No consent banner. Without a cookie,
   unique visitors are a good estimate per day but too high over longer periods. For signed-in people the opt-in
   `pseudonymousUserId` sends `HMAC-SHA256(secret, userId)` as Matomo's user id, with the key in the secrets store
   (`matomo.user-id-key`). The operator then has to name this in the privacy text.
6. **The configuration route is public** (`GET /api/internal/matomo/tracker`, `public: true`), because anonymous visitors are
   counted too. It returns nothing the tracker script would not show anyway, except the caller's own pseudonymous id.

## Consequences

- The page CSP is no longer fully static: one directive set depends on a setting. The e2e security header test runs with
  tracking on and off.
- A browser on an instance with tracking on talks to a third party, so the operator's privacy text must say so. The module
  README gives a checklist; the software cannot write the operator's legal text (rule 9).
- Ad and tracker blockers will suppress some hits; numbers are a lower bound. Option 2 stays in the backlog for operators
  who need more.
- `page-end` is a generic slot: other invisible, page-wide components can use it without a shell change.
- Without `pseudonymousUserId`, Matomo's weekly and monthly unique visitors are overcounted, and people sharing one address
  and browser set-up are merged. The README says so, so nobody reports them as exact.
