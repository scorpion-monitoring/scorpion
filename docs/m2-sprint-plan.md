# M2 Sprint Plan: `core.identity`

Status: draft, 2026-10-02
Scope source: [implementation.md](implementation.md) §3, M2. Closes defects 3, 4, 5 and 13 (FEATURES §5).

M2 is size L (about 4+ weeks for one developer). This plan splits it into five sprints of about one
week. Each sprint is one `feature/m2-*` branch (more if a branch grows past a reviewable size) and one pull
request into `dev`, with small commits as in CONTRIBUTING.md. M2 is released once, after sprint 5 (`0.3.0`,
a minor release, see CONTRIBUTING.md "Releases").

## 1. What M2 needs that the plan does not list

M2 depends only on M1, but its scope touches things that M3 and M4 deliver and things no milestone lists.
Each gap gets a decision here, so the sprints do not stall.

| Gap                                                                                                                                                                                                         | Why it matters                                                    | Proposed decision                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Actor and authenticator.** The pipeline (architecture §"Request pipeline", step 3) resolves a cookie or PAT to an `Actor`. M1 built the pipeline skeleton but no `Actor` type and no authentication step. | Sessions and PATs have no effect until the pipeline can use them. | Sprint 1 adds an `Actor` type and a `kernel.authenticator` registry to `packages/contracts` and the pipeline, modelled on `kernel.authorizer` (ADR-0005). `core.identity` contributes the single entry. Record it in an ADR.                                                                                                                                                                                                                                                                                                                                                                            |
| **Authorisation before M3.** With `denyByDefault` (ADR-0005), every non-public route answers 403 until `core.authz` exists. Logout, profile and PAT routes are not public.                                  | Those routes cannot be tested end to end through the pipeline.    | Integration tests use a test-only `kernel.authorizer` entry from `packages/testing` that allows a given permission set. Production behaviour stays deny-by-default until M3. The ADR from sprint 1 states this.                                                                                                                                                                                                                                                                                                                                                                                         |
| **Rate limiting.** Login, register and token use must be rate-limited (CLAUDE.md, security rules). The architecture puts a Postgres token bucket in the pipeline (step 2), but no milestone builds it.      | M2 is the first milestone with public endpoints.                  | Sprint 1 builds the token bucket in the kernel (table in the kernel's own schema, per-IP and per-key buckets, `429` problem+json with `Retry-After`). Limits come from module constants now and move to settings in M3.                                                                                                                                                                                                                                                                                                                                                                                 |
| **Settings (M3).** `Local Accounts` must be enforced server-side (defect 13).                                                                                                                               | `core.settings` does not exist yet.                               | `core.identity` declares the setting in its manifest with a default (`localAccounts: true`) and reads it through a small `IdentitySettings` port. M2 supplies the default implementation; M3 swaps in the real one. Verify in sprint 1 how the M1 manifest `settings` field is read at runtime.                                                                                                                                                                                                                                                                                                         |
| **Email (M4).** Reset and verification emails.                                                                                                                                                              | `core.notifications` does not exist yet.                          | A `Mailer` port with two implementations (decided): an SMTP one over Nodemailer that reads `SMTP_URL` (the dev Mailpit at `smtp://localhost:1025`, already in `docker-compose.dev.yml` and `.env.example`), and an in-memory one for tests. Nothing logs a reset or verification link, so the plan's "until then they are logged" is replaced by "sent to Mailpit". Nodemailer is a new runtime dependency (named in the pull request); M4 reuses the transport behind `core.notifications`. Without `SMTP_URL` the mailer refuses to send and logs only that an email was not sent, never its content. |
| **Blob store (M3).** Avatars are stored in the blob store.                                                                                                                                                  | Not available in M2.                                              | Sprint 5 builds the profile service without the avatar upload. The `avatarBlobId` column is nullable and unused. The avatar endpoint arrives in M3; add it to `docs/backlog.md`.                                                                                                                                                                                                                                                                                                                                                                                                                        |
| **`scorpion create-admin` and `seed`.** M1's CLI says these arrive with the module that needs them.                                                                                                         | Bootstrap admin is an M2 deliverable.                             | Sprint 3 adds `create-admin` to the CLI through a module-contributed command, not a hard-coded one. Roles are data seeded in M3, so M2 stores a plain `isBootstrapAdmin` marker on the first admin (decided). The marker is temporary: M3 maps it to the Admin role in its seed migration and then **drops the column completely**, with no code left that reads it. M3's scope and acceptance must say so (§11). No route or service in M2 reads the marker, so it grants nothing by itself.                                                                                                           |

## 2. Cross-sprint rules

- Stay inside the M2 scope. Anything else goes to `docs/backlog.md`.
- Every service method has an integration test against real Postgres, including a denied-permission case and a
  rollback case for multi-row writes (CLAUDE.md, testing rules).
- Pure logic (validation, token parsing, expiry arithmetic) gets table-driven unit tests.
- Regression tests are named `defect-NN.<topic>.test.ts`: `defect-03.invalid-token`, `defect-04.logout-revokes`,
  `defect-05.oidc-validation`, `defect-13.local-accounts`. Never weaken them.
- No secret, token, password or session id appears in a log line, an API response or an error message.
- Use the factories in `packages/testing`; add identity factories there (`makeUser`, `makeSession`, `makeToken`).
- Every pull request carries a changeset (`pnpm changeset`, package `scorpion`) unless it is docs-only. Write
  user-visible ones for operators (new env vars, new CLI commands, new endpoints).
- Update `modules/core-identity/README.md` in the same commit as any manifest change.
- New runtime dependencies (`arctic`, `@node-rs/argon2`, `uuidv7` or equivalent) are named in the pull request
  description with the reason.

## 3. Sprint overview

| Sprint | Branch                                | Theme                                                                     | Closes        |
| ------ | ------------------------------------- | ------------------------------------------------------------------------- | ------------- |
| 1      | `feature/m2-identity-foundation`      | Module, schema, hashing, validation, Actor, rate limit                    | none          |
| 2      | `feature/m2-local-accounts-sessions`  | Register, login, logout, sessions, CSRF, approval                         | defects 4, 13 |
| 3      | `feature/m2-tokens-bootstrap`         | PATs, bearer authentication, `create-admin`, first-run token              | defect 3      |
| 4      | `feature/m2-oidc`                     | OIDC login, provisioning, linking, Keycloak test                          | defect 5      |
| 5      | `feature/m2-recovery-profile-release` | Reset, verification, password change, profile, cleanup job, docs, release | none          |

Sprints 3 and 4 do not depend on each other and can run in parallel if a second developer is available. Both
need sprint 2.

## 4. Sprint 1: Foundation

**Branch:** `feature/m2-identity-foundation`. **Goal:** an empty-but-wired `core.identity` module, plus the three
kernel pieces everything else relies on.

Work items

1. Create `modules/core-identity` with `module.ts`, `public.ts`, `README.md`, `db/schema.ts` and a first
   migration. Table prefix `identity_` (ADR-0004).
2. Tables: `identity_user`, `identity_auth_method`, `identity_session`, `identity_login_state`, `identity_token`.
   UUIDv7 primary keys. Unique constraints:
   - user: `username`, and a unique index on lower-cased `email` where it is set and verified;
   - auth method: `(provider, subject)` and `(user_id, provider)` for local;
   - token: `prefix`; token name unique per user.
     Session ids and token secrets are stored hashed, never in clear.
3. Validation schemas (Zod, with size limits): username 3–31 `[a-z0-9_-]`, password 8–255, email format. Table-driven
   unit tests for each rule (defect 13: email is validated).
4. Password hashing wrapper over `@node-rs/argon2` (argon2id). Parameters in one place, with a unit test that checks
   verification and rejection.
5. User service skeleton: `createUser`, `findByUsername`, `findByEmail`. The duplicate check covers **all** auth
   methods, not just local accounts.
6. `Actor` type and the `kernel.authenticator` registry in `packages/contracts` and the pipeline (step 3). A request
   with no credentials resolves to an anonymous actor; a `public: true` route accepts it, any other route is
   handled by the authorizer as before.
7. Postgres token-bucket rate limiter in the pipeline (step 2): per IP and per key, configurable per route group, `429`
   with `Retry-After`. Take the client IP from a trusted proxy setting, not from a raw header.
8. Test-only authorizer in `packages/testing`.
9. ADR-0006: "Actor, authenticator registry and interim authorisation". Also record the `isBootstrapAdmin` decision
   (temporary column, removed completely in M3).

Definition of done: `pnpm check` and the tests of every touched module pass; the module loads in the `full` and
`kpi-tracker` profiles without changing their behaviour; the migration runs under the advisory lock; the rate limiter
has a concurrency test (two parallel requests do not both pass the last token).

## 5. Sprint 2: Local accounts, sessions, approval

**Branch:** `feature/m2-local-accounts-sessions`. **Goal:** a user can register, log in and out, and logout revokes the
session at once (defects 4 and 13).

Work items

1. Register: validates input, honours `localAccounts` **on the server** (defect 13), creates the user as `pending` under
   the approval policy. The rate limiter's strict bucket applies.
2. Login: constant-time-ish failure path (same response for unknown user and wrong password), rate limit, refusal for
   `pending`, `rejected` and soft-deleted users.
3. Session service: 256-bit random id, stored as a hash; sliding 7-day expiry; short in-memory cache keyed by the
   hash, invalidated on logout and "log out everywhere"; every request checks the database when the cache misses or
   expires (defect 4).
4. Cookie `__Host-session` (Secure, HttpOnly, SameSite=Lax, Path=/, no Domain). CSRF token for cookie-authenticated
   writes; PAT requests skip it.
5. Authenticator entry: session cookie to `Actor`.
6. Routes: `POST /register`, `POST /login`, `POST /logout`, `POST /logout-all`, `GET /me`. Each declares a permission
   or `public: true` with a reason. Use the `url()` helper rules for any link the server renders.
7. `auth.approvalPolicy` registry (declared here, `manual` contributed by `core.identity`). Approve, reject and
   list-pending service methods. Reject soft-deletes; a user can never approve their own account. Role assignment is
   M3, so M2 only flips status.
8. Regression tests: `defect-04.logout-revokes` (a copied cookie fails after logout and after "log out everywhere"),
   `defect-13.local-accounts` (register and login are refused when the setting is off, and an invalid email is a 422).
9. Rollback test: a failure while creating the user and its auth method leaves neither row.

Definition of done: all of the above, plus a denied-permission test for approve and reject, and a self-approval test.

## 6. Sprint 3: Tokens and bootstrap

**Branch:** `feature/m2-tokens-bootstrap`. **Goal:** personal access tokens work end to end, and a fresh install can
create its first admin without the "first registrant" rule. Closes defect 3.

Work items

1. PAT format `scp_<8-char prefix>_<secret>`. Parsing is a pure function with table-driven tests: wrong length, missing
   separators, wrong prefix, non-ASCII and empty input all give "invalid", never an exception (defect 3).
2. Token service: create (secret shown once), list, revoke, rotate; name unique per user; optional expiry; scopes;
   `lastUsed` updated without blocking the request. Lookup by prefix, then argon2id verify per token.
3. Authenticator entry: `Authorization: Bearer <PAT>` and the `X-API-Key` alias to `Actor` with scopes. An invalid, expired
   or revoked token is **401**, never 500. The strict rate-limit bucket applies to failed attempts.
4. Routes under the internal API for own tokens. Resource-scoped checks use `ctx.authz.require` from M3; until then the
   service compares owner ids and has a test that proves one user cannot revoke another's token.
5. Bootstrap: `scorpion create-admin` (contributed by the module through the CLI registry) and a one-time first-run
   token that is printed to the log once when no admin exists, stored hashed, single use, with an expiry.
6. Regression test `defect-03.invalid-token`: a table of malformed keys through the real pipeline returns 401.

Definition of done: a token test that proves no secret is logged (capture the log stream in the test); rollback test
for rotate (old token stays valid if creating the new one fails).

## 7. Sprint 4: OIDC

**Branch:** `feature/m2-oidc`. **Goal:** OIDC login that validates everything and stores nothing sensitive in the login
state (defect 5).

Work items

1. Provider configuration through settings and the encrypted secrets store. Until M3, read the client secret from an
   environment variable and keep the lookup behind one function, so M3 changes one place. Never put it in `settings`
   JSON, in logs or in a response.
2. `arctic` flow: discovery, authorisation URL with PKCE S256 and a nonce, callback with code exchange.
3. Login state: stores only the provider id (plus the PKCE verifier and nonce, held server-side and hashed or encrypted
   as the design requires), expires after 10 minutes, deleted on use. An unknown or expired state returns **400**,
   not a crash.
4. id_token validation: JWKS signature, `iss`, `aud`, `exp`, and the nonce. Cache JWKS with a timeout and a stub in tests.
5. Auto-provisioning on first login (status `pending`, under the approval policy). Linking an OIDC identity to an existing
   account by **verified** email, or from the profile page for a logged-in user. Never link by unverified email.
6. Keycloak Testcontainer test: full flow, plus a tampered-nonce test, a wrong-audience test, an expired-state test and a
   replayed-state test.
7. Regression test `defect-05.oidc-validation`.

Definition of done: the tampered-nonce test fails the login with 400/401 and creates no session and no user.
Risks: a Keycloak container is slow in CI; keep one shared container per test file and note the added time in the
pull request.

## 8. Sprint 5: Recovery, profile, cleanup and release

**Branch:** `feature/m2-recovery-profile-release` (split into `m2-recovery` and `m2-profile-release` if it grows).
**Goal:** finish the account lifecycle, then release.

Work items

1. Password reset (request and confirm), email verification and password change. Tokens are single use, hashed, expire,
   and invalidate all sessions on password change. The request endpoint answers the same for known and unknown emails.
   Emails go through the `Mailer` port (see §1): the SMTP implementation sends to Mailpit in development, and tests
   read the token from the in-memory implementation. A test proves no link or token reaches the log stream.
2. Profile service: name, email (a change re-triggers verification), bio. No avatar yet (see §1).
3. Hourly cleanup job: expired sessions, login states, reset and verification tokens, expired PATs, and purge of
   soft-deleted users after the retention period (retention value from a module constant until M3 settings).
4. Account-locking behaviour decision: lock out after repeated failures or rely on the rate limiter. Record the choice in
   the module README.
5. Module README complete: permissions, settings keys, events (`identity.user.registered@1`, `.approved@1`,
   `.rejected@1`, emitted through the outbox in the same transaction), registries, jobs, CLI commands.
6. E2E-level check through the real pipeline (not Playwright; there is no UI until M5): register, approve, log in, create
   a PAT, call an endpoint with it, log out, confirm the cookie is dead.
7. Backlog entries: avatar upload (M3), real settings and secrets wiring (M3), real mailer (M4).
8. Release: branch `release/0.3.0` from `dev`, `pnpm changeset version`, pull request into `main`, tag `v0.3.0`, merge
   `main` back into `dev`.

## 9. Acceptance (from implementation.md) mapped to tests

| Acceptance criterion                                          | Where it is proved                    |
| ------------------------------------------------------------- | ------------------------------------- |
| Regression tests for defects 3, 4, 5, 13 pass                 | Sprints 3, 2, 4, 2                    |
| A copied session cookie stops working after logout            | `defect-04.logout-revokes` (sprint 2) |
| OIDC flow against Keycloak passes, including a tampered nonce | Keycloak test (sprint 4)              |

Additional gates this plan adds, taken from the ground rules: every route has a denied-request test; every multi-row
write has a rollback test; invalid input is 422, never 500; no secret in logs.

## 10. Risks

| Risk                                                                                   | Effect                                              | Mitigation                                                                                                                                                                  |
| -------------------------------------------------------------------------------------- | --------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Interim authorisation (§1) leaves M2 routes unreachable in a real deployment until M3. | M2 cannot be demonstrated end to end outside tests. | Accepted: the gate is Gate 1, which needs M0–M5. Say so in the release notes for 0.3.0.                                                                                     |
| Kernel changes (Actor, authenticator, rate limiter) grow sprint 1.                     | Delays everything after it.                         | Keep sprint 1 to interfaces and one implementation each; split the rate limiter into its own branch if the pull request passes about 800 changed lines.                     |
| Session cache gives stale reads after logout.                                          | Defect 4 comes back by the back door.               | Invalidate on the same process at logout, keep the TTL short (seconds), and test it. With several server processes the TTL is the bound, so state that bound in the README. |
| Keycloak container makes CI slow or flaky.                                             | Slow pull requests.                                 | One container per file, pinned image tag, retry only the container start.                                                                                                   |
| Argon2 parameters cost too much in tests.                                              | Slow suites.                                        | Use cheap parameters under `NODE_ENV=test` only, and keep a production-parameter unit test.                                                                                 |

## 11. Decisions taken

1. **Bootstrap admin: `isBootstrapAdmin` column, removed completely in M3.** M2 sets it from `create-admin` and the
   first-run token. M3's seed migration turns it into an Admin role assignment and drops the column. Add a line to
   M3's scope in `implementation.md` when this plan is merged, and add a test in M3 that the column no longer exists.
2. **Interim mail: Nodemailer to the dev Mailpit.** Links are never logged. Pulls the Nodemailer dependency forward from
   M4; the transport, not the templates or queueing, is the only M4 work done early.
3. **Approval policy: `manual` only.** `auto-by-email-domain` and `invite-only` go to `docs/backlog.md`. In sprint 2,
   check that the `auth.approvalPolicy` registry interface lets a policy decide a new user's status from the
   registration context, so later policies are contributions and not changes to `core.identity`.
