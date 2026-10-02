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

## Later

- Move to TypeScript 7 once typescript-eslint and svelte-check support it.

## Identity follow-ups

- Approval policies `auto-by-email-domain` and `invite-only` (architecture lists them; M2 ships `manual` only).
  Invite-only needs an invitation table and email delivery (M4) and admin permissions (M3).
- Avatar upload endpoint for the profile (needs the blob store from M3). The `avatarBlobId` column exists from M2.
- Settings for `core.identity`: the manifest `settings` schema is only validated and stored by the kernel today; nothing at runtime reads it and `ctx` has no settings access. Sprint 2 reads `localAccounts` through a module-internal `IdentitySettings` port whose default comes from the module's own schema (`parse({})`); M3 swaps in the real store.
- Test harness for a module: every module test file builds a kernel over Postgres by hand (`modules/core-identity/test/harness.ts`). Move it to a shared helper once a second module needs it; `packages/testing` cannot import the kernel without a package cycle, so it probably belongs with the kernel's test exports.
- Rate-limit limits, the per-credential bucket for session cookies and finer keys (for example per username on login) arrive with settings in M3 and the login service in sprint 2.
- Sprint 2 follow-ups: (1) `approve` and `reject` check only the route permission, the caller and "not your own account"; add `ctx.authz.require` in the service when core.authz exists (M3). (2) An `Origin` check as a third CSRF layer (ADR-0007) needs the public origin to be reliable behind every proxy; revisit with the settings in M3. (3) `POST /auth/register` answers 409 for a taken username or address, which tells a caller that it exists; revisit with email verification (sprint 5). (4) Rejected accounts keep their email address, so it cannot be used to register again; decide on a retention rule with the purge of soft-deleted users (sprint 5).
