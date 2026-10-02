# Backlog

## Kernel follow-ups

- Outbox retention: a job that deletes events whose deliveries are all `delivered` (and events
  with no subscribers) after a configurable time. Requeue a `dead` delivery from the admin UI (M5).
- Job-run retention: delete old `kernel_job_run` rows.
- `scorpion worker` listens on no port, so it has no liveness or metrics endpoint. Add a small
  internal listener if operators need one (job durations are observed in the worker process, so
  its `/metrics` would be the only place to scrape them when `WORKER_MODE=separate`).
- Start-up preflight for cron expressions: today an invalid `schedule` is reported when the workers
  start, not before migrations.
- Make the image build's lockfile step reproducible: it reuses every locked version, but it does
  rewrite `pnpm-lock.yaml` inside the build stage for non-`full` profiles.
- Release image workflow: CI builds only throwaway `scorpion:ci-<profile>` images and has no tag
  trigger, so the release step "build the profile images as `scorpion:<x.y.z>-<profile>`"
  (CONTRIBUTING.md, "Releases") is manual (`pnpm build --profile <name> --tag scorpion:<x.y.z>-<name>`).
  Add a workflow that runs on `v*` tags: check that the tag matches the root `package.json` version,
  build every release profile (not `fixture-ab`) with `docker/Dockerfile`, run the same smoke tests as
  CI, tag `scorpion:<x.y.z>-<profile>` and push to a registry. The registry (and its credentials as
  repository secrets) needs a decision first; record it in an ADR.

## Later

- Move to TypeScript 7 once typescript-eslint and svelte-check support it.

## Identity follow-ups

- Approval policies `auto-by-email-domain` and `invite-only` (architecture lists them; M2 ships `manual` only).
  Invite-only needs an invitation table and email delivery (M4) and admin permissions (M3).
- Avatar upload endpoint for the profile (needs the blob store from M3). The `avatarBlobId` column exists from M2.
- Settings for `core.identity`: the manifest `settings` schema is only validated and stored by the kernel today; nothing at runtime reads it and `ctx` has no settings access. Sprint 2 reads `localAccounts` through a module-internal `IdentitySettings` port whose default comes from the module's own schema (`parse({})`); M3 swaps in the real store.
- Test harness for a module: every module test file builds a kernel over Postgres by hand (`modules/core-identity/test/harness.ts`). Move it to a shared helper once a second module needs it; `packages/testing` cannot import the kernel without a package cycle, so it probably belongs with the kernel's test exports.
- Rate-limit limits, the per-credential bucket for session cookies and finer keys (for example per username on login) arrive with settings in M3 and the login service in sprint 2.
- Sprint 2 follow-ups: (1) Done in M3 sprint 2: `approve` and `reject` check the permission and "not your own account" with `ctx.authz.require` in the service. (2) An `Origin` check as a third CSRF layer (ADR-0007) needs the public origin to be reliable behind every proxy; revisit with the settings in M3. (3) `POST /auth/register` answers 409 for a taken username or address, which tells a caller that it exists. Decided in sprint 5 to keep it for M2; see "Sprint 5 follow-ups". (4) Done in sprint 5: the purge of soft-deleted accounts after 30 days frees the username and the address (ADR-0013).
- Sprint 4 follow-ups (OIDC): (1) A public `GET /auth/oidc/providers` (id and display name) for the login page, with the UI in M5. (2) Done in sprint 5: the hourly cleanup job removes expired `identity_login_state` rows. (3) `email_verified` sent as the string `"true"` by some providers is treated as not verified; add a per-provider option if a real provider needs it. (4) Provider icons (FEATURES asks for a display icon) arrive with the blob store in M3. (5) The code exchange cannot be aborted (arctic has no signal); revisit if arctic gains one. (6) Several identities of one provider per user are refused (409); lift that only with a product reason.
- Sprint 5 follow-ups (recovery, profile, cleanup):
  - **Real settings and secrets wiring (M3).** `IdentitySettings` reads the schema defaults today. M3 stores the settings and replaces the default. Move with it: `instanceName` and `mailFrom` (they belong to core.settings and core.notifications, not identity), the retention constants of the cleanup job (`PURGE_RETENTION_MS`, `TOKEN_GRACE_MS`, `PURGE_BATCH`), the rate-limit and mail-budget numbers, and the two secrets that come from the environment (`OIDC_<ID>_CLIENT_SECRET`, `SMTP_URL` with a password in it) into the encrypted secrets store.
  - **Real mailer through core.notifications (M4).** The `Mailer` port and the two plain-text mails live in `modules/core-identity/service`. M4 moves the port behind core.notifications and brings templates, localisation, an HTML part, a queue with retries on the outbox (today a crash between commit and send loses one mail, and a failed send is only logged), delivery status in the admin list, and the mails the FEATURES list needs (welcome, approved, rejected). Check that the unconfigured mailer's "not sent" warning does not flood logs once registrations send mail in every deployment without SMTP.
  - **Register without revealing.** `POST /auth/register` still answers 409 for a taken address. Hiding it needs a mail to the address's owner ("someone tried to register with your address", M4) and a UI that says "check your mail" for everybody (M5). The username 409 stays: usernames are public.
  - **Avatar upload (M3).** Needs the blob store; `avatar_blob_id` exists and is unused. Re-encode rasters with `sharp`, sanitise SVG, size limits (CLAUDE.md security rules).
  - **Bio as Markdown.** FEATURES asks for a bio, not for Markdown, so it is plain text (max 2000). If wanted: render on the server and sanitise with DOMPurify. Also consider stripping Unicode format characters (bidi overrides) from display names; only control characters are refused today.
  - **Guessing one username from many addresses.** No lockout and no per-username counter (README, "Account locking"): both are a denial of service against a known username. Options that avoid it: alerting on failed logins per username, a proof-of-work or CAPTCHA step-up after repeated failures, 2FA.
  - **Revoke access tokens on a reset (optional).** A reset or a change ends sessions only (ADR-0012). A "revoke my tokens too" switch on the reset page, or a security-event setting, would cover the case of a token minted from a hijacked session.
  - **Reset marks the address confirmed?** Opening a reset link proves control of the mailbox, but the reset does not mark the address verified (kept separate on purpose). Revisit if the UI wants a one-step recovery for unverified accounts.
  - **Self-service account deletion and data export (GDPR).** FEATURES lists account deletion as missing; the purge job already deletes soft-deleted accounts, so deletion needs the route, the confirmation (password or mail link) and the event.
  - **Admin user management (M3/M5).** List, deactivate, change email, force a reset, revoke sessions. Not in M2.
  - **2FA (TOTP, WebAuthn).** Not in M2.
  - **Public `GET /auth/oidc/providers`** for the login page (id and display name), with the UI in M5 (sprint 4 follow-up 1, still open).
  - **Outbox retention** (kernel follow-up above) now also matters for the purge: events keep the usernames of purged accounts.

## Authz follow-ups (M3 sprint 1)

- **Create and delete roles.** M3 sprint 1 seeds Admin, Reviewer and User and lets `core.authz.role.manage` edit the permissions of the non-Admin roles. Creating and deleting custom roles (with the rule that a role in use cannot be deleted) is not built; the schema allows it (`system = false`).
- **Scoped permissions at the route.** The authoriser checks a scoped permission (for example `service.edit` with scope `service`) globally, so a provider member who lacks it globally is denied at the route even though a resource policy would allow them. M7 needs a route-level pass-through for scoped permissions, with the service re-check as the guard; decide it with the first resource policy.
- **"Last Admin" counts assignments, not accounts.** `core.authz` cannot see whether an Admin's account is deactivated. If M5's user management needs "the last _active_ Admin", the check moves to a call from identity that passes the active holders.
- **Grant escalation.** `core.authz.role.assign` lets the holder give any role, Admin included. Treat it as an admin permission; revisit if a delegated "assign only roles up to X" is wanted.
- **Cache invalidation after the outer commit.** The permission cache is emptied when a role change commits its own transaction. When a caller wraps the call in a larger transaction, a request that races with the outer commit can refill a stale entry for up to the 5 s TTL (the documented bound).

## Identity on authz follow-ups (M3 sprint 2)

- **List a user's roles.** `GET /users/{id}/roles` (identity, `core.identity.role.read`, `AuthzService.rolesOf`) for the admin UI; `GET /roles` lists the roles only. Add it with M5's user management.
- **Tokens of another user.** `core.identity.token.manage-any` revokes a token by id; there is no route to list another user's tokens, so an administrator needs the id. Add a list with the admin user management (M5).
- **Delegated approval.** Approving needs `core.authz.role.assign` as well as `core.identity.user.approve`, so a role that may only approve cannot approve. A "may assign only roles up to X" rule (see "Grant escalation") would let a reviewer approve accounts for the role `user`.
- **Old token scopes.** Tokens made in 0.3.0 keep their `read:kpi`-shaped scopes, which grant nothing. A cleanup that lists them for their owners, or a one-time migration that revokes them, is not built.
- **Wildcard scopes.** A scope names one permission. `core.identity.*` or a "read-only" preset would help scripts with many scopes; decide with the first real script.
- **Actor of kind `system`.** Trusted code with no human caller uses three methods of the authz service (ADR-0015). If jobs need to call methods that check permissions (`assignRole`), they need an actor for that; add it with the first such job and keep it out of the authenticator.
- **Role events are not audited yet.** `authz.role.assigned@1` and `.removed@1` have no subscriber until M4's audit trail; `setRolePermissions` emits nothing.
