# core.identity

Users, the ways they sign in, sessions, personal access tokens and approval. Package
`@scorpion/core-identity`, id `core.identity`, table prefix `identity_` (set in the manifest, so the tables
are `identity_user` and not `core_identity_user`; ADR-0004).

This is **sprint 3 of M2** ([sprint plan](../../docs/m2-sprint-plan.md)): local accounts, sessions, approval and
personal access tokens. People can register with a password, sign in and out, an approver can approve or reject new
accounts, a signed-in person can create tokens for scripts, and a fresh install gets its first administrator from
`scorpion create-admin` or a one-time first-run token. OIDC, password reset and the profile follow.

**Nothing is reachable in a real deployment yet.** Production denies every route that is not public until
`core.authz` exists in M3 ([ADR-0005](../../docs/adr/0005-deny-by-default-before-authz.md)), so register and login
work, and everything behind a session answers 403. Tests use `testAuthorizer()` from `@scorpion/testing`.

## Manifest

| Part         | Now                                                                                                                                                                                                                                                                                                                 | Later                                                                  |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| Permissions  | `core.identity.session.manage`, `core.identity.me.read`, `core.identity.user.list-pending`, `core.identity.user.approve`, `core.identity.user.reject`, `core.identity.token.read`, `core.identity.token.manage`                                                                                                     | M3 adds the role-assignment permission                                 |
| Settings     | `localAccounts` (default `true`, enforced on the server), `approvalPolicy` (default `manual`)                                                                                                                                                                                                                       | M3: stored settings replace the defaults                               |
| Events       | emits `identity.admin.created@1`, `identity.user.registered@1`, `identity.user.approved@1`, `identity.user.rejected@1`, `identity.token.created@1`, `identity.token.revoked@1`, `identity.token.rotated@1` through the outbox; handles `system.ready` only (issues the first-run token, below)                      | handlers arrive with core.notifications (M4)                           |
| Registries   | declares `auth.approvalPolicy`, contributes `manual` to it; contributes the one entry to `kernel.authenticator` (session cookie, `Authorization: Bearer`, `X-API-Key`)                                                                                                                                              | none                                                                   |
| Jobs         | none                                                                                                                                                                                                                                                                                                                | hourly cleanup of expired sessions, login states and tokens (sprint 5) |
| CLI commands | `scorpion create-admin --username <name> --email <address>` (password from the prompt or stdin)                                                                                                                                                                                                                     | none                                                                   |
| Routes       | internal API: `POST /auth/register`, `POST /auth/login`, `POST /auth/logout`, `POST /auth/logout-all`, `GET /auth/me`, `GET /users/pending`, `POST /users/{id}/approve`, `POST /users/{id}/reject`, `GET /tokens`, `POST /tokens`, `DELETE /tokens/{id}`, `POST /tokens/{id}/rotate`, `POST /bootstrap/first-admin` | password reset, profile (sprint 5)                                     |

The README changes together with the manifest.

### Routes

All are under `/api/internal`. Bodies are JSON only; anything else is refused (415 or 422), which also keeps a
cross-site HTML form from reaching them ([ADR-0007](../../docs/adr/0007-session-cookie-and-csrf.md)).

| Route                         | Access                            | Notes                                                                                                                                                                                                                                                                                         |
| ----------------------------- | --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /auth/register`         | public (strict rate limit)        | `{ username, email, password }` → 201 `{ user }`, status `pending` under the manual policy. 403 when `localAccounts` is off, 409 when the name or address is taken, 422 for bad input                                                                                                         |
| `POST /auth/login`            | public (strict rate limit)        | `{ username, password }` → 200 `{ user, csrfToken }` and the cookie. 401 for an unknown user, a wrong password, a rejected or deleted account (same answer); 403 for a pending account (after the right password) or when `localAccounts` is off                                              |
| `POST /auth/logout`           | `core.identity.session.manage`    | 204, ends the caller's session, clears the cookie                                                                                                                                                                                                                                             |
| `POST /auth/logout-all`       | `core.identity.session.manage`    | `{ revoked }`, ends every session of the caller                                                                                                                                                                                                                                               |
| `GET /auth/me`                | `core.identity.me.read`           | `{ user, roles, csrfToken }`; roles are empty until M3                                                                                                                                                                                                                                        |
| `GET /users/pending`          | `core.identity.user.list-pending` | list envelope, oldest first                                                                                                                                                                                                                                                                   |
| `POST /users/{id}/approve`    | `core.identity.user.approve`      | pending → active. 404 unknown, 409 not pending, 403 your own account                                                                                                                                                                                                                          |
| `POST /users/{id}/reject`     | `core.identity.user.reject`       | pending → rejected and soft-deleted (the username stays reserved). Same refusals                                                                                                                                                                                                              |
| `GET /tokens`                 | `core.identity.token.read`        | the caller's live tokens, oldest first, list envelope; never a secret                                                                                                                                                                                                                         |
| `POST /tokens`                | `core.identity.token.manage`      | `{ name, scopes?, expiresAt? }` → 201 with `token` (shown once), `Cache-Control: no-store`. Strict rate limit. 409 for a taken name or more than 50 tokens, 422 for bad input                                                                                                                 |
| `DELETE /tokens/{id}`         | `core.identity.token.manage`      | 204; also when it was already revoked; 404 for an unknown id and for someone else's                                                                                                                                                                                                           |
| `POST /bootstrap/first-admin` | public (strict rate limit)        | `{ token, username, email, password }` → 201 `{ user }` (an active administrator; no cookie). 401 for a token that is unknown, used, expired or malformed, and for any token once an active user exists; 409 for a taken name or address and 422 for bad input, both leaving the token usable |
| `POST /tokens/{id}/rotate`    | `core.identity.token.manage`      | `{ expiresAt? }` (send `{}`) → the new token, same name and scopes, shown once; the old one is dead. Strict rate limit. 404 as above                                                                                                                                                          |

The token routes are described under [Access tokens](#access-tokens). The three approval routes are not in plan §5 item 6, which lists five routes. The plan's definition of done asks for a
denied-permission test for approve and reject, and before `ctx.authz` exists (M3) the route's `permission` is the only
place that can be checked. The service still refuses an anonymous caller and your own account.

Registering and signing in tell a caller when a username or address is taken (409) and, after the right password,
that an account is pending; they do not tell whether a username exists when signing in.

### Access tokens

[ADR-0008](../../docs/adr/0008-personal-access-tokens.md) has the reasoning. In short:

- **Format** `scp_<8-character prefix>_<secret>`, 56 characters; the secret is 256 random bits (base64url) and is stored
  only as an argon2id hash. `service/token-format.ts` parses it (anything else is "invalid", never an exception: defect 3).
- **Use** `Authorization: Bearer <token>` or `X-API-Key: <token>` (`Authorization` wins). The authenticator turns a good
  token into an `Actor` `{ via: 'token', scopes }`. A malformed, unknown, wrong, expired or revoked token, or one whose
  owner is not active, is a **401**, the same answer for each, and the check costs the same (a decoy hash for an unknown
  prefix). On a `public: true` route a bad token means "not signed in".
- **A request with a token is a token request:** the cookie is ignored (no CSRF check, no session privileges). A bad
  token is a 401 even with a good cookie.
- **Scopes** are `read:<resource>` or `write:<resource>`, resource in dotted kebab case, at most 20 per token; anything
  else is a 422. They limit nothing until `core.authz` (M3) intersects them with the owner's permissions.
- **Managing tokens needs a session.** Create, list, revoke and rotate answer 403 to a caller who used a token, so a
  stolen token cannot mint another. Every query is scoped to the caller; someone else's token id gets the same 404 as an
  unknown one. Until `ctx.authz` exists (M3) that, with the route's permission, is the whole check.
- **Cache and the staleness bound.** A verified token is trusted in memory for **5 seconds** (`TOKEN_CACHE_TTL_MS`,
  keyed by the SHA-256 of the token), because argon2id on every call is too expensive. Revoke and rotate drop the entries
  of _this_ process at once. **With several server processes another process can accept a revoked token for at most
  5 seconds.** Wrong tokens are never cached; the entry honours the token's own expiry.
- **Last use** (`last_used_at`) is written at most once a minute, off the request path; a failed write is logged and
  ignored.
- **Failed attempts** are charged to a strict bucket per client address (burst of 10, then 10 a minute) that is checked
  _before_ the token is verified: when it is empty every token request from that address gets a 429, even with a good
  token, until it refills. This is in the server's pipeline (`pipeline/authenticate.ts`), not in this module.
- **Rotating** revokes the old token and creates the new one in one transaction. A name is unique among live tokens, so
  a revoked token frees its name.

### Bootstrap: `create-admin` and the first-run token

[ADR-0010](../../docs/adr/0010-first-run-token-and-bootstrap-admin.md) and [ADR-0009](../../docs/adr/0009-module-cli-commands.md)
have the reasoning. The "first registrant becomes admin" rule is gone (defect 1).

- **`scorpion create-admin --username <name> --email <address>`** creates an _active_ local account and marks it as
  administrator. The password is read from the terminal prompt (no echo) or, without a terminal, as the first line of
  standard input: `printf '%s\n' "$PW" | scorpion create-admin …`. It is **never** taken from an argument:
  `--password` is refused, and the password appears in no output and no log. Exit codes: 0 created, 1 refused (invalid
  input, taken name or address; the message names fields, never values), 2 wrong usage. The command can be run again to
  add another administrator. It is contributed by this module (`commands`), so a profile without it has no such command.
- **The first-run token.** When the server (or worker) starts and the install has **no active user** and no first-run
  token that is still good, it issues one and shows it _once_ as a plain-text block on **standard error**: `sfr_` and 43
  characters, valid for 1 hour, single use. It is the one secret printed anywhere: it does not go through the structured
  logger, and nothing repeats it (not a later line, a response, an event or the database, which keeps only its SHA-256).
  Use it with `POST /api/internal/bootstrap/first-admin` (below `BASE_PATH`) and the body `{ token, username, email,
password }`. A failed attempt that is the caller's mistake (taken name, weak password) does not use the token up.
- A restart while the token is still good cannot show it again; the log says that one is outstanding (without the
  secret). Wait for it to expire, or run `create-admin`. `create-admin` also ends any outstanding token.
- "No administrator yet" is decided as "no active, non-deleted user", **not** from the marker column (which nothing
  may read). With the `manual` policy an account becomes active only through an approver, so this is exact for M2;
  M3 replaces it with "no user holds the Admin role".
- Under `NODE_ENV=test` the default shows nothing; a test passes `announce` to receive the text.
- **Events.** Both paths emit `identity.admin.created@1 { userId, username, origin: 'cli' | 'first-run' }` in the
  same transaction as the account, the marker and the end of the tokens. No password or token is in it.

### Events (decision)

CLAUDE.md rule 6 says a write that touches more than one row emits its domain events through the outbox in the same
transaction, and registering is one: the user and its auth method. So the three events are emitted **from sprint 2**,
not left to sprint 5, which only completes this README. `register` emits `identity.user.registered@1`
`{ userId, username, status }`; `approve` and `reject` emit `identity.user.approved@1` `{ userId, username, approvedBy }`
and `identity.user.rejected@1` `{ userId, username, rejectedBy }`, each in the transaction that changes the status. No
event holds an email address, a password or a hash. A test reads the outbox row and another proves a failing outbox
rolls the write back.

### Settings

`localAccounts` and `approvalPolicy` are declared in the manifest (`service/settings.ts`). The kernel only validates
and stores a module's settings today and `ctx` has no settings access, so the module reads them through one internal
port, `IdentitySettings`, whose default implementation is `settingsSchema.parse({})`. **M3 replaces that default and
nothing else.** The server enforces `localAccounts` (defect 13): register and login answer 403 when it is off, whatever
the UI shows. Existing sessions and logout are not affected.

### Approval policies (`auth.approvalPolicy`)

The registry entry is `{ id, description?, decide(registration) }`; `decide` receives
`{ username, email, emailVerified, provider }` and returns `{ status: 'pending' | 'active' }`. The `approvalPolicy`
setting names the entry in force. `manual` (contributed here) returns `pending` for everyone. A policy decides from the
registration context, so `auto-by-email-domain` and `invite-only` (`docs/backlog.md`) are contributions from other
modules that depend on `core.identity`, and need no change here; a test contributes one from a second module. If the
configured policy is not installed the account stays `pending` and a warning is logged, so a typo never approves anyone.
Approving only flips the status; roles are assigned in M3.

## Tables

| Table                      | Holds                                                                                                                                                                                                   |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `identity_user`            | The person: unique `username`, `email` (a verified address is unique, case-insensitively), `status`, soft delete, `avatar_blob_id` (nullable, unused until M3), `is_bootstrap_admin` (temporary, below) |
| `identity_auth_method`     | One way to sign in: `(provider, subject)` unique; at most one `local` (password) method per user; the argon2id hash for `local`                                                                         |
| `identity_session`         | A browser session: SHA-256 of the 256-bit session id, sliding expiry, `revoked_at`                                                                                                                      |
| `identity_login_state`     | An OIDC login in progress: provider id and the hash of `state`, expiry (10 minutes, single use)                                                                                                         |
| `identity_first_run_token` | The one-time token a fresh install prints: SHA-256 `secret_hash`, `expires_at`, `redeemed_at` (single use)                                                                                              |
| `identity_token`           | A personal access token: unique 8-character `prefix`, argon2id `secret_hash`, scopes, expiry, last use; name unique per user                                                                            |

Keys are UUIDv7 (`ids.uuidv7()` from the kernel). No secret is stored in the clear: sessions and login
states are SHA-256 hashes of random 256-bit values, passwords and token secrets are argon2id hashes.

### `is_bootstrap_admin` is temporary

It marks the administrator that `scorpion create-admin` or the first-run token creates, because roles
are data seeded only in M3. **Nothing reads it:** the service does not select it, no route uses it, a test fails
if a file other than the schema mentions it. The bootstrap service writes it through `BOOTSTRAP_ADMIN_MARK`, a value
that `db/schema.ts` exports, so the schema stays the only file that names the column; a second test pins that the
constant is used in one place, as the argument of an update. M3's seed migration turns it into an Admin role assignment and
**drops the column completely**, with a test that it is gone ([ADR-0006](../../docs/adr/0006-actor-authenticator-interim-authorisation.md)).

## Sessions, the cookie and CSRF

[ADR-0007](../../docs/adr/0007-session-cookie-and-csrf.md) has the reasoning. In short:

- The session id is 256 random bits (43 base64url characters). Only its SHA-256 is stored. A session lives 7 days
  from its last use (sliding; the database is written at most once a minute per session, and the cookie is then
  sent again).
- Cookie `__Host-session`: `Secure; HttpOnly; SameSite=Lax; Path=/`, no `Domain`.
- The authenticator (`authenticator.ts`, the entry in `kernel.authenticator`) reads only headers. No cookie: the
  caller is anonymous. A cookie the session service refuses: `Unauthorized`. A good cookie: `Actor`
  `{ kind: 'user', via: 'session', roles: [] }` (roles arrive with core.authz in M3). A session also ends when
  its user is no longer `active` or is soft-deleted.
- **CSRF.** A request with the session cookie and a method other than GET, HEAD or OPTIONS must send
  `X-CSRF-Token`, the session's token (a hash of the session id under its own label; the login and `me`
  responses return it). Otherwise it is a 401.
- **Cache and the staleness bound.** The session service keeps verified sessions in memory for **5 seconds**
  (`SESSION_CACHE_TTL_MS`). Logout and "log out everywhere" revoke in the database and drop the entries of
  _this_ process at once. **With several server processes another process can accept a revoked session for at most
  5 seconds**, the time its cache entry lives. Tests set the TTL to 0 for strict behaviour. Unknown ids are never
  cached.

## Public API (`public.ts`)

`ctx.deps['core.identity'].users` offers:

- `createUser(input)`: validates (422 `Invalid`), refuses a taken username, a taken email address (verified or not,
  whatever way its holder signs in, case-insensitive) or an identity that is already linked (409 `Conflict`), then
  writes the user and its auth method in one transaction. A race is stopped by the unique indexes and is also a 409.
  The result never holds a hash or an internal flag.
- `findById(id)`: `undefined` when there is no such user, also for text that is not a UUID.
- `findByUsername(name)` and `findByEmail(address)`: case-insensitive, `undefined` when there is no match,
  soft-deleted users included (the caller refuses their login).

The register, login, session and approval services are internal to the module; the routes call them through
`r.service()`. Other modules read users and, in M3, ask `core.authz` about permissions.

## Rules for input (`validation.ts`)

Username 3 to 31 of `a-z 0-9 _ -`; password 8 to 255 characters; email in address format, at most 254 characters;
provider id lower-case letters, digits and `-`; subject 1 to 255 characters. The service applies them to every
caller, so the routes, the CLI and OIDC provisioning cannot skip one.

## Passwords (`service/password.ts`)

argon2id through `@node-rs/argon2`: 64 MiB, 3 passes, 1 lane, 32-byte output (RFC 9106, lanes reduced to one).
The parameters are in one place; a unit test pins them. Under `NODE_ENV=test` only, cheap parameters are used.
`verifyPassword` returns `false` for a hash it cannot parse; it never throws.

## Testing

`pnpm test --filter @scorpion/core-identity` needs Docker (Testcontainers). Use the factories `makeUser`,
`makeAuthMethod`, `makeSession` and `makeToken` from `@scorpion/testing`, and `testAuthorizer()` when a test must get
through the pipeline before `core.authz` exists.

The routes are tested through the whole pipeline, on real Postgres, in `apps/server/src` (a module cannot import the
server; `cli.test.ts` runs the real `scorpion create-admin` and `scorpion start` as processes): `identity-routes.test.ts`, `defect-04.logout-revokes.test.ts` and `defect-13.local-accounts.test.ts`, `defect-03.invalid-token.test.ts`, `tokens-routes.test.ts` and `bootstrap-routes.test.ts`, with
`useIdentityApp()` from `src/testing/identity-app.ts`. A test builds its own manifest with
`createIdentityModule({ settings, sessionCacheTtlMs, tokenCacheTtlMs })` to change a setting or the cache TTL.
