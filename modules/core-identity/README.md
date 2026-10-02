# core.identity

Users, the ways they sign in, sessions, personal access tokens and approval. Package
`@scorpion/core-identity`, id `core.identity`, table prefix `identity_` (set in the manifest, so the tables
are `identity_user` and not `core_identity_user`; ADR-0004).

This is **sprint 2 of M2, part 1** ([sprint plan](../../docs/m2-sprint-plan.md)): the schema, the validation
rules, password hashing, a user service skeleton, and now the session service, the `__Host-session` cookie,
CSRF protection and the authenticator that turns the cookie into an `Actor`. There are no routes yet (register,
login and approval follow in part 2) and no tokens in use, so no request can carry a valid cookie before then.

## Manifest

| Part         | Now                                                     | Later                                                                                            |
| ------------ | ------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Permissions  | none                                                    | sprint 2: approve and reject users, list pending; M3 adds `identity.role.assign`                 |
| Settings     | none                                                    | sprint 2: `localAccounts` (default `true`, enforced on the server)                               |
| Events       | none emitted, none handled                              | `identity.user.registered@1`, `.approved@1`, `.rejected@1`, through the outbox (sprints 2 and 5) |
| Registries   | contributes the session entry to `kernel.authenticator` | declares `auth.approvalPolicy` (part 2); the entry also reads tokens (sprint 3)                  |
| Jobs         | none                                                    | hourly cleanup of expired sessions, login states and tokens (sprint 5)                           |
| CLI commands | none                                                    | `create-admin` (sprint 3)                                                                        |
| Routes       | none                                                    | register, login, logout, `GET /me`, tokens (sprints 2 and 3)                                     |

The README changes together with the manifest.

## Tables

| Table                  | Holds                                                                                                                                                                                                   |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `identity_user`        | The person: unique `username`, `email` (a verified address is unique, case-insensitively), `status`, soft delete, `avatar_blob_id` (nullable, unused until M3), `is_bootstrap_admin` (temporary, below) |
| `identity_auth_method` | One way to sign in: `(provider, subject)` unique; at most one `local` (password) method per user; the argon2id hash for `local`                                                                         |
| `identity_session`     | A browser session: SHA-256 of the 256-bit session id, sliding expiry, `revoked_at`                                                                                                                      |
| `identity_login_state` | An OIDC login in progress: provider id and the hash of `state`, expiry (10 minutes, single use)                                                                                                         |
| `identity_token`       | A personal access token: unique 8-character `prefix`, argon2id `secret_hash`, scopes, expiry, last use; name unique per user                                                                            |

Keys are UUIDv7 (`ids.uuidv7()` from the kernel). No secret is stored in the clear: sessions and login
states are SHA-256 hashes of random 256-bit values, passwords and token secrets are argon2id hashes.

### `is_bootstrap_admin` is temporary

It marks the administrator that `scorpion create-admin` or the first-run token creates (sprint 3), because roles
are data seeded only in M3. **Nothing reads it:** the service does not select it, no route uses it, a test fails
if a file other than the schema mentions it. M3's seed migration turns it into an Admin role assignment and
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
- `findByUsername(name)` and `findByEmail(address)`: case-insensitive, `undefined` when there is no match,
  soft-deleted users included (the caller refuses their login).

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
