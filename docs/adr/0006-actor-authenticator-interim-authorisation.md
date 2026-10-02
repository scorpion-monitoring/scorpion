# ADR-0006: Actor, authenticator registry and interim authorisation

- Status: Accepted
- Date: 2026-10-02

## Context

M2 adds users, sessions and personal access tokens (`core.identity`). The request pipeline
(architecture, "Security architecture") resolves a cookie or token to an `Actor` in step 3, but M1
built no `Actor` and no authentication step. `core.authz` arrives only in M3, so until then ADR-0005
denies every non-public route, and the M2 routes (logout, profile, tokens) cannot be tested through
the pipeline. M2 also needs a way to mark the first administrator before roles exist.

## Decision

### Actor and authenticator

- **`Actor`** (`packages/contracts`) is `{ kind: 'anonymous' }` or `{ kind: 'user', userId, username,
roles, via: 'session' | 'token', scopes? }`. `roles` is empty until `core.authz` exists. `scopes` is
  set for tokens only. Handlers read it with `c.get('actor')`; the authoriser receives it as
  `request.actor`.
- **The registry `kernel.authenticator`** is declared by the kernel, modelled on `kernel.authorizer`: no
  dependency on the kernel is needed to contribute, at most one entry (two stop startup), and an entry
  that is not `{ authenticate(request) }` stops startup. `core.identity` contributes the entry in
  sprint 2 (session cookie) and extends it in sprint 3 (bearer token, `X-API-Key`). Sprint 1 ships the
  registry and the pipeline step only.
- **Contract of `authenticate`:** no credentials presented → resolve to `undefined` (anonymous); good
  credentials → the `Actor`; bad credentials (unknown, expired, revoked) → throw `Unauthorized`; any other
  error is a bug and ends in a 500. The request is never let through as someone else, and the
  authenticator must not read the body.
- **Pipeline step 4** runs per module route, after the rate limit and before validation. It does not run
  for `/healthz`, `/readyz` and `/metrics`, which must answer without the database. Without an entry
  every caller is anonymous.
- **Bad credentials on a `public: true` route mean "not signed in", not 401.** A stale session cookie must
  not stop someone from logging in again. On every other route they are a 401. A broken authenticator is
  a 500 on public routes too.

### Interim authorisation

- **Production stays deny-by-default until M3** (ADR-0005). Nothing changes: every non-public route
  answers 403, now after authentication, so a caller without credentials is not told more than before.
- **Tests use a test-only authoriser** from `@scorpion/testing` (`testAuthorizer(permissions)`): a
  signed-in actor gets through for the listed permissions (`'*'` for all), an anonymous one gets 401,
  anything else 403. It is passed to `createApp()` or contributed by a test fixture module, and it must
  never be in the manifest of a module that ships.
- **Consequence for M2:** the M2 routes cannot be used in a real deployment until M3. This is accepted;
  the gate is Gate 1 (M0–M5), and the 0.3.0 release notes say so.

### `identity_user.isBootstrapAdmin`

- M2 needs a first administrator ("not first registrant", defect 1) but roles are data seeded in M3. M2
  therefore stores a plain boolean column `isBootstrapAdmin` on the user that `scorpion create-admin` or
  the first-run token creates (sprint 3).
- **The column is temporary and grants nothing.** No route, service or query in M2 reads it, the user
  service never selects it, and a test fails if any non-test file other than the schema mentions it.
- **M3's seed migration maps it to the Admin role assignment and then drops the column completely**, with
  a test that it no longer exists (`docs/implementation.md`, M3). Until then it must not be used for any
  decision; the alternative of reading it as a stand-in for the Admin role was rejected because it
  would leave a second source of truth for who is an administrator.

### Rate limiting

- The Postgres token bucket of pipeline step 2 is described in its own pull request (table
  `kernel_rate_bucket`, per address and per credential, `429` with `Retry-After`). The client address
  comes from the socket, and from `X-Forwarded-For` only for the proxies in `TRUSTED_PROXIES`.

## Consequences

- Every later module can rely on `c.get('actor')` and `request.actor`; none parses credentials itself.
- Contributing to `kernel.authenticator` decides who everyone is, so, as with the authoriser, the module
  list of a profile is the trust boundary.
- Sessions and tokens have no effect until sprints 2 and 3 contribute the entry.
- The authenticator runs on every module route, including public ones; with the session cache of
  sprint 2 that is one lookup per request that carries a cookie.
