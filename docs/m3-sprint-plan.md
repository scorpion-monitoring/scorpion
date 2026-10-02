# M3 Sprint Plan: `core.authz` + `core.settings`

Status: draft, 2026-10-02
Scope source: [implementation.md](implementation.md) §3, M3. Closes defect 1 (FEATURES §5). Releases as `0.4.0`.

M3 is size M (about 3 weeks for one developer), but it is the riskiest security milestone: it replaces
deny-by-default (ADR-0005) with real authorisation, and it is the first milestone that changes `core.identity`
after its release. It also takes over about a dozen hand-offs that M2 parked for it (README "M3", `docs/backlog.md`).
This plan splits it into four sprints of about one week, each one `feature/m3-*` branch (more if a branch grows past a
reviewable size) and one pull request into `dev`. M3 is released once, after sprint 4.

## 0. Before sprint 1

1. Merge #35 (`main` back into `dev`) and #36 (backlog entry) so `dev` carries 0.3.0.
2. Answer the four decisions in §10. Decision 1 changes the dependency direction between two modules and conflicts
   with FEATURES §2.1, so per CLAUDE.md it needs an answer and an ADR before code.
3. Add the lines in §11 to M3's scope in `implementation.md` (needs your approval; this plan does not edit it).

## 1. What M2 hands to M3

Each item is a promise M2 made in code, README or backlog. Sprint numbers are where this plan delivers it.

| Hand-off from M2                                                                                                           | Where it was recorded                   | Sprint          |
| -------------------------------------------------------------------------------------------------------------------------- | --------------------------------------- | --------------- |
| `identity_user.is_bootstrap_admin` becomes an Admin role assignment, the column is dropped, a test proves it is gone       | ADR-0006, implementation.md M3          | 2               |
| `Actor.roles` is empty; `/auth/me` returns empty roles; "no administrator yet" means "no user holds the Admin role"        | README (sessions, bootstrap)            | 2               |
| `ctx.authz.require()` in the service layer: approve/reject, token routes, own-resource checks                              | CLAUDE.md, backlog (sprint 2 follow-up) | 2               |
| Token scopes are checked in shape only; they must be intersected with the owner's permissions                              | README (access tokens)                  | 2               |
| `IdentitySettings` reads schema defaults; M3 stores settings and replaces that default and nothing else                    | README (settings), backlog              | 3               |
| Retention constants (`PURGE_RETENTION_MS`, `TOKEN_GRACE_MS`, `PURGE_BATCH`), rate-limit and mail-budget numbers → settings | README (cleanup), backlog               | 3               |
| `OIDC_<ID>_CLIENT_SECRET` moves to the encrypted secrets store (`service/oidc-secret.ts` is the one place to change)       | README (OIDC), backlog                  | 3               |
| `instanceName` and `mailFrom` move out of identity into branding settings                                                  | README (settings), backlog              | 4               |
| Avatar upload (`avatar_blob_id` exists, unused)                                                                            | backlog                                 | 4               |
| Role assignments must not block the purge of a user; they subscribe to `identity.user.purged@1`                            | README (cleanup)                        | 2               |
| Admin user management: list users, deactivate, revoke sessions                                                             | backlog                                 | not M3 (see §9) |

## 2. Cross-sprint rules

- Stay inside M3. Anything else goes to `docs/backlog.md`.
- Every service method has an integration test against real Postgres, including a denied-permission case and a rollback
  case for multi-row writes. For `core.authz` the denied case is the point of the module: test it per route.
- Pure logic (permission matching, scope intersection, key derivation, vocabulary term ordering) gets table-driven unit tests.
- The defect-1 regression suite is `defect-01.privilege-escalation.test.ts` (named in ADR-0005). It is written in
  sprint 2, extended by every later sprint that adds a route, and never weakened.
- **No route without a denied-request test**, and a test that walks the live route table and fails if a non-public
  route has no entry in the "denied for a plain User" matrix. This is the structural guard for defect 1.
- No secret, token, key, password or session id in a log line, API response, event or error message. Secrets are
  write-only through the API.
- Use the factories in `packages/testing`; add `makeRole`, `makeSetting`, `makeSecret`, `makeVocabulary` there.
- Update the README of every module whose manifest changes in the same commit (CLAUDE.md). `core.identity`'s README
  has many "until M3" sentences; sprint 2 and 3 each remove theirs.
- Every pull request carries a changeset unless docs-only. Write it for operators: new env var `SECRETS_KEY`, new
  commands, new routes, new permissions, what stops working.
- New runtime dependencies are named in the pull request description with the reason. M3 expects `sharp` and
  `dompurify` with `jsdom` (or `isomorphic-dompurify`) in sprint 4; nothing else.

## 3. Sprint overview

| Sprint | Branch                          | Theme                                                               | Closes   |
| ------ | ------------------------------- | ------------------------------------------------------------------- | -------- |
| 1      | `feature/m3-authz-core`         | `core.authz`: permission registry, roles as data, authorizer, ADR   | none     |
| 2      | `feature/m3-authz-identity`     | Wire identity to authz: roles, bootstrap migration, defect-1 suite  | defect 1 |
| 3      | `feature/m3-settings-secrets`   | `core.settings`: settings, preferences, secrets, `rotate-secrets`   | none     |
| 4      | `feature/m3-vocab-blob-release` | Vocabularies, blob store, branding, avatar, README, release `0.4.0` | none     |

Order matters: authz comes first because every later module depends on `ctx.authz`, and because after sprint 2 an
instance is usable for the first time (`0.3.0` is not). Sprints 3 and 4 do not depend on each other except for the
settings port that sprint 4's branding and size limits read; start sprint 4's vocabularies in parallel if there is a
second developer.

## 4. Sprint 1: `core.authz`

**Branch:** `feature/m3-authz-core`. **Goal:** the authorizer is real, but nothing in `core.identity` uses it yet.

Work items

1. Create `modules/core-authz` (`module.ts`, `public.ts`, `README.md`, `db/schema.ts`, first migration), prefix `authz_`.
2. Tables: `authz_role` (id, key, label, system flag), `authz_role_permission` (role, permission), `authz_role_assignment`
   (user id, role id, assigned by, assigned at; unique `(user, role)`). The user id has no foreign key to `identity_user`,
   so a purge cannot be blocked (README, cleanup). UUIDv7 keys.
3. **Permission registry** filled from every loaded manifest (the kernel already collects them). A permission string the
   manifests do not declare cannot be stored in `authz_role_permission` (service check, plus a boot-time check that
   drops nothing silently: unknown stored permissions are logged and ignored, never granted).
4. **Seeds** (idempotent, the module's own migration or seed step): roles `Admin`, `Reviewer`, `User` with their default
   permission sets. Default sets come from a registry `authz.defaultRole` that modules contribute to (so M6+ add their
   own permissions to Reviewer without editing `core.authz`, CLAUDE.md rule 7). Admin holds every declared permission,
   resolved at check time, not copied, so a new module's permissions reach Admin without a data migration.
5. **Authorizer** contributed to `kernel.authorizer` (ADR-0005): resolves the actor's roles from `actor.userId`, checks the
   route's `permission`, short in-memory cache (TTL 5 s, invalidated in-process on a role change; the cross-process bound
   is documented as for sessions, ADR-0007). Anonymous → 401, missing permission → 403. A token actor is limited to its
   scopes (see sprint 2).
6. **`ctx.authz`** (`require(actor, permission, resource?)`, `can(...)`) and the resource-policy registry
   `authz.resourcePolicy` (`service.member` is the first user, in M7). Per Decision 1 this is delivered either as a
   public service of `core.authz` or as a kernel port; the ADR records which.
7. Built-in protections as service rules, not route code: nobody changes their own roles; nobody approves their own
   request (the check lives in the policy engine so every future module gets it); last Admin cannot be removed.
8. ADR-0014: "Authorisation model: roles as data, permission registry, dependency direction" (Decision 1, 2).
9. Remove the test-only authorizer's role as the only way to test routes: it stays for fixture modules, but identity's
   tests move to the real one in sprint 2.

Definition of done: `pnpm check` and `pnpm test --filter @scorpion/core-authz` pass; with the module in the `full` profile
the 0.3.0 behaviour (everything non-public is 403) is unchanged for a user without roles; a concurrency test shows two
parallel role changes cannot remove the last Admin.

## 5. Sprint 2: Identity on authz, bootstrap, defect 1

**Branch:** `feature/m3-authz-identity`. **Goal:** real deployments work; defect 1 is closed.

Work items

1. Identity's authenticator fills `Actor.roles` (or `core.authz` fills them in the authorizer; Decision 1 fixes which).
   `/auth/me` returns real roles. Remove the "roles are empty until M3" sentences from the README.
2. Role routes (permissions named `identity.role.*` in implementation.md): list roles, assign and remove a role for a user,
   with `ctx.authz.require` in the service. Approve now takes the role to assign (FEATURES 3.2: "approve and assign a
   role at the same time"; default `User`), in one transaction with the status change and the event.
3. Service-layer checks added where M2 only had the route permission: approve, reject, token list/revoke/rotate (own tokens
   or `core.identity.token.manage-any`), profile and password routes (own account only, enforced by the actor id, with a
   test that another user's id is a 403, not a 404 leak).
4. **Token scopes** are intersected with the owner's permissions: effective permission = scope ∩ owner. A scope that names a
   permission the owner lacks grants nothing; a revoked role takes effect within the cache TTL. Tokens still cannot
   manage tokens or sessions.
5. **Bootstrap migration** (Decision 3): every user with `is_bootstrap_admin = true` gets the Admin role, then the column is
   dropped completely. Tests: former bootstrap admins hold Admin; the column no longer exists; no non-test file mentions
   it (the M2 guard test is deleted in the same commit, with the reason in the message). `create-admin` and the first-run
   token now assign the Admin role through the authz service. "No administrator yet" becomes "no user holds the Admin
   role".
6. `identity.user.purged@1` subscriber in `core.authz`: delete the user's role assignments.
7. **Defect 1 regression suite** `defect-01.privilege-escalation.test.ts`: a plain User calling each admin endpoint gets
   403 (role changes, self-approval, approve/reject, token manage-any, session manage); cannot grant themselves a role by
   any route; cannot approve their own account or request; cannot revoke another user's token; an anonymous caller gets 401;
   a PAT whose scope is broader than its owner's permissions is still limited. Plus the route-table walker from §2.
8. Replace the identity tests' use of `testAuthorizer` with the real authorizer where they test permissions; keep it for
   transport-level tests.

Definition of done: a fresh `full` profile instance can be started, the first administrator created with
`create-admin`, a second person registered, approved with a role, and the whole flow (including a PAT with a limited
scope) works through the real pipeline with no test authorizer. `identity-journey.test.ts` runs on the real authorizer.
This is the first demonstrable end-to-end release candidate; say so in the sprint's pull request.

## 6. Sprint 3: `core.settings`: settings, preferences, secrets

**Branch:** `feature/m3-settings-secrets`. **Goal:** configuration and secrets are data, not constants.

Work items

1. Create `modules/core-settings` (prefix `settings_`): `settings_setting` (module id, JSON value, updated by/at,
   version), `settings_user_preference`, `settings_secret`.
2. **Settings port.** The kernel validates and stores a module's settings schema today and `ctx` has no access. Add
   `ctx.settings` (read the validated, defaulted value of own module; typed by the manifest schema) backed by the
   `core.settings` service, with a short TTL cache and in-process invalidation on write. Absent `core.settings`, the port
   returns schema defaults (this keeps profiles without it working, and is what `IdentitySettings` does today).
3. Routes: read all settings (secrets never), read/write one module's settings (validated by that module's Zod schema,
   422 with field errors, never 500), JSON Schema for the admin form (`zod-to-json-schema`). Permissions
   `core.settings.read` and `core.settings.write` (and `…secret.write`). Event `settings.changed@1` with the module id
   and the changed key names, never values.
4. **User preferences:** per-user key/value validated by a schema a module registers (`settings.userPreference` registry);
   own preferences only, enforced in the service.
5. **Secrets store.** AES-256-GCM, 12-byte random nonce per value, key from `SECRETS_KEY` (32 bytes, base64; refuse to start
   a profile that includes `core.settings` without it, with a message that says how to generate one). Key id stored per
   row so rotation can run while old rows exist. Values are write-only through the API (the API returns `set: true`, never
   the value). `ctx.secrets.get(name)` is internal, reachable only through `core.settings`' public service by modules that
   declare the dependency.
6. **CLI:** `scorpion rotate-secrets` (re-encrypt every row under a new key, in one transaction per batch, resumable, never
   prints a value; a test proves old-key rows still decrypt mid-run) and `scorpion set-secret <name>` (value from the
   prompt or standard input, like `create-admin`).
7. **Identity wiring (replaces defaults only):** `IdentitySettings` reads `ctx.settings`; `service/oidc-secret.ts` reads
   the secrets store first and the environment variable second (Decision 4); the retention constants, rate-limit numbers
   and mail budgets become settings with today's values as defaults. Log a one-line warning, once, when a secret still comes
   from the environment.
8. Defect-13 regression test stays green and gains a case: turning `localAccounts` off through the settings API takes
   effect within the cache TTL, and a non-admin cannot change it.

Definition of done: setting `localAccounts=false` through the API makes register and login answer 403 within the TTL on a
second server process (integration test with two kernels over one database); an OIDC client secret set through the CLI
is used for a Keycloak login in the existing Keycloak test; `SECRETS_KEY` is never logged; the API never returns a secret
(a test greps every response of the settings routes for the stored value).

## 7. Sprint 4: Vocabularies, blob store, branding, release

**Branch:** `feature/m3-vocab-blob-release`. **Goal:** the rest of M3's scope, the docs, and the release.

Work items

1. **Vocabularies** in `core.settings`: `settings_vocabulary` + `settings_vocabulary_term` (key, label per locale, sort order,
   active flag), registry `vocabulary` for modules to declare theirs, service `listTerms/validateTerm`, admin routes with
   permissions, deactivate instead of delete when a term is in use (modules declare a usage check). Seeds, idempotent:
   stages `DEV`, `DEMO`, `PROD`, `TERM`; thematic categories; necessity levels; sender types; aggregates. No pg enum
   anywhere (CLAUDE.md rule 8); a test fails on one.
2. **Blob store** (own small module `core.blob`, or inside `core.settings`: Decision 2): `blob` table (bytea, sha256, MIME,
   size), content-addressed; `GET /files/:hash` with a strict CSP, `X-Content-Type-Options: nosniff`, long cache with
   the hash as validator. Upload service re-encodes rasters with `sharp` (strip metadata, cap dimensions), sanitises SVG
   with DOMPurify, enforces the size limit from a setting, sniffs the real type (never trusts the client MIME). Never
   stores data URLs. Tests with hostile inputs: SVG with script and `foreignObject`, a polyglot, an oversized image, a
   decompression bomb.
3. **Branding settings:** instance name, logos, product name, sender address, contact email, imprint URL, legal texts
   (Markdown, rendered on the server and sanitised). `instanceName` and `mailFrom` move from identity's settings to
   branding; identity reads them through the settings port. Legal pages are served by a public route (FEATURES 3.2: they
   must not require login). A test greps `apps` and `modules` for the old hard-coded product strings (FEATURES §3.3).
4. **Avatar upload** in `core.identity`: session-only route, own account only, goes through the blob service,
   `avatar_blob_id` is set and the old blob is released. Update the README and delete the backlog entry.
5. Documentation: README of `core.authz` and `core.settings` complete (permissions, settings keys, events, registries,
   CLI, env vars: `SECRETS_KEY`); identity README loses every "until M3" sentence; ADR for the secrets store and key rotation.
   Backlog entries for whatever M3 deferred (§9).
6. Journey test through the real pipeline: bootstrap admin, register, approve with a role, change a setting, set a secret,
   upload an avatar, call with a scoped PAT, log out, copied cookie dead; the log holds no secret.
7. Release: branch `release/0.4.0` from `dev`, `pnpm changeset version`, review `CHANGELOG.md` (the release notes must say
   that `SECRETS_KEY` is now required and that 0.4.0 is the first release in which a signed-in user can do anything),
   pull request into `main`, annotated tag `v0.4.0`, images `scorpion:0.4.0-<profile>` (manual until the tag workflow in
   the backlog exists), merge `main` back into `dev` on a `feature/…` branch (the branch policy rejects other names).

## 8. Acceptance (from implementation.md) mapped to tests

| Acceptance criterion                                                                  | Where it is proved                                              |
| ------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| Defect-1 suite: a plain User calling each admin endpoint gets 403                     | `defect-01.privilege-escalation` (sprint 2), route-table walker |
| …including role changes, self-approval, revoking another user's token                 | same file, one test per case                                    |
| …KPI-set edits, announcement deletion, log reads                                      | M9, M17, M4 add their cases to the same file when they ship     |
| Secrets never appear in API responses or logs                                         | secrets and settings route tests, log-grep test (sprint 3)      |
| `identity_user.isBootstrapAdmin` no longer exists; former bootstrap admins hold Admin | bootstrap migration test (sprint 2)                             |

Additional gates this plan adds: every route has a denied-request test; the route-table walker; settings changes reach a
second process within the TTL; rotation never leaves an undecryptable row; hostile blob inputs.

## 9. Out of scope (goes to `docs/backlog.md` if not there)

- Admin user management UI/API beyond role assignment (list, deactivate, force reset, revoke sessions): M5 builds the UI;
  add the list endpoint only if M5's plan needs it.
- Notification templates and the real mailer (M4); `SMTP_URL` stays an environment variable and moves in M4 together with
  the transport, not here (the M2 backlog entry grouped it with M3; this plan splits it).
- Audit trail of role changes: M4 (`core.audit`). Sprint 2 emits `authz.role.assigned@1` and `.removed@1` so M4 only subscribes.
- Per-resource policies for services and providers: registered by M7; M3 ships the registry and a test policy.
- S3 blob backend (architecture mentions it); the table is the only M3 backend.

## 10. Decisions needed before sprint 1

1. **Dependency direction and where `ctx.authz` comes from.** FEATURES §2.1 says `core.authz` depends on identity. But
   identity must call `ctx.authz.require` (CLAUDE.md, security rules), and `identity.role.assign` is an identity permission.
   Both cannot depend on each other. **Recommendation:** `core.identity` depends on `core.authz`; `core.authz` is
   user-agnostic (an opaque user id, no foreign key, no import of identity), and identity owns the role-assignment routes
   and calls the authz service. This also lets the identity migration that drops the bootstrap column run after the authz
   tables exist. Alternative: a kernel-owned `ctx.authz` port filled by a registry entry, with the dependency left as in
   FEATURES. It keeps FEATURES intact but adds a second kernel extension point. Needs an ADR either way.
2. **Where the blob store lives.** Own module `core.blob` (clean ownership, one more package and profile entry) or inside
   `core.settings` (matches implementation.md's M3 list). **Recommendation:** own module; the size limit comes from a setting.
3. **How the bootstrap marker becomes a role.** Rule 3 forbids reading another module's tables, but a one-time data
   migration has to. **Recommendation:** one migration in `core.identity` (which runs after `core.authz` under
   Decision 1) inserts the Admin assignments with a single `INSERT … SELECT` into `authz_role_assignment`, then drops the
   column in the next statement, in one transaction. Documented in the ADR as the one sanctioned exception, with a test.
4. **Environment secrets after the store exists.** **Recommendation:** the store wins, the environment variable stays as a
   fallback with a once-per-start warning, so a 0.3.0 operator can upgrade without a flag day; removal is a later breaking
   release. Alternative: drop the fallback now (0.3.0 cannot have been used in production because of ADR-0005, so no one
   depends on it).

## 11. Proposed additions to M3's scope in `implementation.md` (to approve)

- `authz.defaultRole` and `authz.resourcePolicy` registries, and the route-table walker test.
- `scorpion set-secret`, next to `rotate-secrets`.
- Token scopes intersected with the owner's permissions; approve takes the role to assign.
- The M2 hand-offs in §1 (settings port for identity, secrets for OIDC, avatar upload, purge subscriber) as explicit items.
- Sprint 2's end state as an acceptance line: a fresh `full` instance works end to end without a test authorizer.

## 12. Risks

| Risk                                                                   | Effect                                        | Mitigation                                                                                                                     |
| ---------------------------------------------------------------------- | --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| A route is added later without a real permission check.                | Defect 1 returns quietly.                     | Registration already refuses a route without `permission`; the route-table walker catches a missing denied-case.               |
| Stale role cache after a demotion.                                     | A demoted admin keeps access for seconds.     | Invalidate in-process, keep TTL at 5 s, document the cross-process bound, test it.                                             |
| Bootstrap migration runs on a database with zero or many marked users. | No Admin, or too many.                        | Zero marked users: leave the instance as it is, `create-admin` and the first-run token still work. Test both.                  |
| `SECRETS_KEY` lost or rotated badly.                                   | OIDC and backup secrets unreadable.           | Key id per row, rotation is resumable and verifies decryption before it commits, document the backup of the key in the README. |
| Settings cache differs between processes.                              | `localAccounts=false` takes seconds to apply. | Same bound as sessions, tested with two kernels.                                                                               |
| `sharp` and DOMPurify add native or heavy dependencies to every image. | Larger images, build time.                    | Only profiles that include the blob module install them (image check already proves profile contents).                         |
| Sprint 2 touches most of identity's routes at once.                    | Large, hard-to-review pull request.           | Split by route group (accounts, tokens, profile) into stacked branches, as sprint 5 of M2 did.                                 |
