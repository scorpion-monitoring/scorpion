# Backlog

## Kernel follow-ups

- ~~Outbox retention~~ Done in M4 sprint 4: `deleteDeliveredEvents` in the kernel, the job `core.audit.system.outbox-retention` (setting
  `outboxRetentionDays`, default 14) deletes events whose deliveries are all `delivered` and events with no subscribers; an event with a
  `pending` or `dead` delivery stays. Requeue of a `dead` mail delivery is done (M4 sprint 3), requeue of a `dead` outbox delivery too
  (`POST /system/outbox/deliveries/{id}/requeue`, ADR-0024).
- ~~Job-run retention~~ Done in M4 sprint 4: `deleteJobRuns` and the job `core.audit.system.job-run-retention` (`jobRunRetentionDays`, 90).
  `kernel_job_run` also has a `result` column now, filled from what a handler returns.
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

## Audit follow-ups (M4 sprint 4)

What M4 deferred (plan §9) and what the sprint found. The viewer screens, the inbox bell and the system page are M5; the routes are ready.

- **Rich search.** The viewer filters on method, user, endpoint prefix, action, outcome, source and a date range. Full-text search over bodies and payloads (a GIN index on the `jsonb` columns or `tsvector`), saved filters and "all entries about this subject" are not built.
- **Export to an external log sink.** Syslog, OTLP logs or an S3 archive of old rows before retention deletes them. The trail is only in the database; the CSV export is the way out.
- **Tamper evidence.** The table refuses `UPDATE`, `DELETE` and `TRUNCATE` for the application (ADR-0021) but a database superuser can drop the trigger. A hash chain over the rows, or a periodically signed digest, would make a change detectable; so would shipping rows to a second system as they are written.
- **Partitioning.** `audit_event` is one table with an index on `(occurred_at, id)`. Revisit monthly range partitions (and dropping a partition instead of batched deletes) if the load test (M18) shows bloat. Batched `DELETE` under the flag leaves dead tuples until autovacuum.
- **Audit volume of reads.** The three read routes of the viewer are audited (who looked). A busy admin screen that polls fills the table. Sample reads, or stop auditing the list and keep the export and the single entry, when the UI exists.
- **Login, logout and failed sign-ins are not in the trail.** Auth routes are not `audit` routes: the actor of a login is anonymous when the pipeline writes the entry, and a failed-login flood would fill the table. A `identity.session.created@1` event (success) and a counted failure event would fix both; decide with the account-lockout question (identity follow-ups).
- **Redaction is by name.** A secret under an innocent key, or in a value (a token pasted into a free-text field), is not recognised. A content check for the token and key formats this system issues (`scp_`, `srt_`) would catch the likeliest case. Routes that store a body should stay few and reviewed.
- **Settings values are stored in the body of `PUT /settings/{module}`.** Settings never hold secrets by rule, but a URL with a token in its query would be stored. Add a secret-hygiene guard on the settings schemas (settings follow-ups) or `redact: ['url']` for that route.
- **The old value of a setting is not in the trail.** The event names the keys, not the values (ADR-0017). If an operator needs "from what to what", store the diff in the audit payload for keys that a schema marks as non-sensitive.
- **Event payloads without `username`.** The stored payload leaves the username out so a purge does not leave a name in an append-only table. The viewer shows ids; the admin UI must join the user table and show "deleted account" for a purged one.
- **A purged account's id stays in the trail** as an actor or subject, until retention. That is the point of an audit trail; say so in the privacy text (M5).
- **The public API channel has no writer yet.** `channels.api` and `apiRetentionDays` are in place, but `/api/v1` exists only from M8. The first public route sets `audit: true`; check that `surface: 'v1'` entries land under `channels.api`.
- **Optional peers for later modules.** A module that declares events (M6 onwards) fails the decisions test until `core.audit` has a decision for it; add the module as an optional peer of `core.audit` at the same time. A registry through which a module contributes its own decisions would remove the edit to `decisions.ts`; not worth it for a few modules.
- **`ctx.audit` has no caller yet** besides the module's own export and requeue entries. The first service that changes something without an event (M6 and later) uses it inside its transaction.
- **A job-run page.** `kernel_job_run.result` is filled, and `listJobRuns` returns it, but there is no route to list job runs. Add `GET /system/job-runs` (`core.audit.system.read`) with the system page (M5).
- **Dead outbox deliveries are kept for ever.** Outbox retention never deletes an event with a `dead` delivery. A dead delivery that nobody will fix should be dismissed on purpose: a `DELETE /system/outbox/deliveries/{id}` (audited) is not built.
- **Requeue is one delivery at a time**, as for mail.
- **CSV extras.** No BOM (Excel users import as UTF-8), no choice of columns, no XLSX. The row cap is a setting; a larger export is a background job that writes a file to the blob store, not built.
- **Per-surface retention.** `retentionDays` and `apiRetentionDays` split by `source`. If administrators want the internal request log shorter than the events, split `api` rows by surface.

## Notifications follow-ups (M4 sprint 3)

- **Unsubscribe links, digests and quiet hours.** Non-mandatory mail still has no unsubscribe link (it needs a public route and a token); no digest or
  batching; no quiet hours. The preference switches are the only control (M4 plan §9).
- **Per-user webhooks** (a webhook for a person's own notifications) and per-event transport routing.
- **The UI** for the inbox bell, the preference form and the delivery list is M5; the routes are ready. The preference form should read
  `GET /notifications/preferences/categories` and write `PUT /preferences/notifications.preferences` (which replaces the whole object).
- **`inApp` is not switched on in `core.identity`.** The flag works for any recipient with a user id, and identity passes one for the administrators'
  registration request and for the person's own mails. Turning it on (a registration request and an approval in the inbox) is a small change in
  `identity-mail.ts` that needs a decision on which mails earn an inbox item; leave it for M5 together with the bell.
- **Inbox size per user is not capped.** Only read items are deleted (after `inboxRetentionDays`). A sender that floods one user can grow the table;
  a per-user cap (oldest read first) or a rate on `inApp` writes is the answer if it happens.
- **Delivery rows keep the address of a purged account until `retentionDays`.** `recipient_user_id` has no foreign key (ADR-0019) and the address
  stays on the row; clearing both for a purged user (a trusted call like `removeInboxOfUser`) would shorten that. Related: the personal data in
  `queued` rows older than the retention.
- **Preference definitions: done for `notifications.preferences` only.** The category list endpoint is the definition for that key; the general
  `GET /preferences/definitions` of core.settings (registered keys with descriptions, schemas and defaults) is still open (see "Settings follow-ups").
- **Requeue is one at a time.** A "requeue all dead" and a bulk filter are not built; the list filter makes a UI loop easy.
- **The test mail has no result.** The route answers 202 with the delivery id; whether the relay accepted it shows in the delivery list. A synchronous
  "sent / failed with code" answer would need the route to wait for one delivery pass.
- **Job name.** The plan calls the daily job `notify.retention`; the kernel requires the module id as a prefix, so it is `core.notifications.retention`.
- **Registry `notify.recipientAddress` has one use.** Only the test mail asks it. If the audit or a digest needs addresses too, extend the entry
  rather than adding a second lookup.

## Notifications follow-ups (M4 sprint 2)

- **The language of a request comes from the body.** `POST /auth/register` and `POST /auth/password-reset` take an optional `locale`; the server
  does not read `Accept-Language`. The UI (M5) sends the browser's language. Reading the header in the route is a small addition if a client needs it.
- **Reset and register-attempt mails use the request's language, not the owner's preference.** The owner exists but the caller does not, and
  reading their preference only on the known path would add a difference between the paths. A mail to a signed-in person or an administrator
  uses the preference `notifications.locale`.
- **A rejected applicant who registers again gets no mail.** The address of a soft-deleted account stays taken for the 30 days of the purge
  retention (ADR-0013); a new registration with it is a quiet 202 and creates nothing. M5 should tell a rejected person what to do (contact address).
- **At most 1000 administrators are mailed per registration** (`listHoldersAsSystem` caps its answer). A larger group would need a digest or a
  fan-out job; nothing near it exists.
- **Admin mails are sent one by one inside the registration transaction.** Fine for a handful; with many administrators a fan-out job reading the
  list after the commit would shorten the request.
- **Templates of modules that do not exist yet live in core.notifications** (`registry.membership-*`, `onboarding.application-*`,
  `kpi.reporting-reminder`). When M6, M10 and M15 land, each module takes over its own (a rename of the contributor, same key).
- **No unsubscribe link.** Done in M4 sprint 3: `category` and `mandatory` drive the preference switches (ADR-0023). Still open: an unsubscribe link in the mail.
- **The text and HTML of a template are not checked by a mail-client test.** The HTML is plain tables-free markup with inline styles; the
  layout is tested for escaping and structure, not rendered in real clients.
- **A start-up message for a leftover `SMTP_URL` was left out.** The M4 plan's risk table asks for one; its definition of done (the old name
  appears only in documentation) wins. The changeset and the READMEs say the variable is ignored.

## Notifications follow-ups (M4 sprint 1)

- **A module stop hook in the kernel.** `core.notifications` opens a `LISTEN` connection per process at `system.ready` and has no way to be
  told about shutdown (`kernel.stop()` calls only the dispatcher and the jobs). The service exposes `close()` for tests and the socket is
  unref'd, so the process still ends. A `system.stopping` event or a `stop()` on the service would let modules release resources; the kernel's
  own outbox listener could then also be offered to modules (a `ctx.listen(channel, fn)`), which would replace the module's connection.
- **No post-commit hook in `ctx.db.tx()`.** The wake-up goes through `pg_notify`, which Postgres delivers on commit, so the module needs its own
  listener. An `afterCommit(fn)` on the transaction would let `enqueue` call `ctx.jobs.enqueue` directly.
- **One wake-up job per process per commit burst.** Every process with a listener queues `core.notifications.deliver` when it hears a
  notification (coalesced over 100 ms). The extra runs find nothing due. A singleton key on `ctx.jobs.enqueue` would remove them.
- **Permanent SMTP failures are retried like transient ones.** A 5xx for the recipient (a mailbox that does not exist) is tried 8 times over
  about two hours before the row is dead. Mapping `responseCode >= 500` to an immediate `dead` needs a decision on greylisting and relays that
  answer 5xx for policy reasons.
- **`emailTransport` is an enum in the settings schema.** The registry `notify.transport` is open, but the admin form needs the ids at validation
  time, so a new email transport adds its id to `settingsSchema` in the same change. A schema that is told the registry's ids (a kernel hook
  on settings schemas) would remove that edit.
- **Webhook TLS pinning and per-event routing.** One signed URL for admin-addressed messages; per-user webhooks, per-event routing and
  a retry-after header are out of scope (M4 plan §9).
- **Drizzle's `execute` returns timestamps as text.** `claimDue` converts `created_at` itself; any other raw `db.execute` that selects a
  timestamp must do the same.

## Later

- Move to TypeScript 7 once typescript-eslint and svelte-check support it.

## Identity follow-ups

- Approval policies `auto-by-email-domain` and `invite-only` (architecture lists them; M2 ships `manual` only).
  Invite-only needs an invitation table and email delivery (M4) and admin permissions (M3).
- Test harness for a module: every module test file builds a kernel over Postgres by hand (`modules/core-identity/test/harness.ts`). Move it to a shared helper once a second module needs it; `packages/testing` cannot import the kernel without a package cycle, so it probably belongs with the kernel's test exports.
- Rate limits: the numbers are the `rateLimits` setting of `core.settings` since M3 sprint 3. Still open: a per-credential bucket for session cookies (they count against the address) and finer keys (for example per username on login).
- Sprint 2 follow-ups: (1) Done in M3 sprint 2: `approve` and `reject` check the permission and "not your own account" with `ctx.authz.require` in the service. (2) An `Origin` check as a third CSRF layer (ADR-0007) needs the public origin to be reliable behind every proxy; revisit with the settings in M3. (3) `POST /auth/register` answers 409 for a taken username or address, which tells a caller that it exists. Decided in sprint 5 to keep it for M2; see "Sprint 5 follow-ups". (4) Done in sprint 5: the purge of soft-deleted accounts after 30 days frees the username and the address (ADR-0013).
- Sprint 4 follow-ups (OIDC): (1) A public `GET /auth/oidc/providers` (id and display name) for the login page, with the UI in M5. (2) Done in sprint 5: the hourly cleanup job removes expired `identity_login_state` rows. (3) `email_verified` sent as the string `"true"` by some providers is treated as not verified; add a per-provider option if a real provider needs it. (4) Provider icons (FEATURES asks for a display icon): the blob store exists since M3 sprint 4; add an icon hash to the provider setting with the login page (M5). (5) The code exchange cannot be aborted (arctic has no signal); revisit if arctic gains one. (6) Several identities of one provider per user are refused (409); lift that only with a product reason.
- Sprint 5 follow-ups (recovery, profile, cleanup):
  - **Settings and secrets wiring (M3).** Done in sprint 3: `IdentitySettings` reads `ctx.settings`, the retention numbers, the mail budgets and the pipeline's rate limits are settings, and `OIDC_<ID>_CLIENT_SECRET` is replaced by the secrets store. Done in sprint 4: `instanceName` and `mailFrom` are branding settings of core.settings (ADR-0018). Done in M4 sprint 2: `SMTP_URL` is gone; the relay is a core.notifications setting and its password a secret.
  - **Real mailer through core.notifications (M4).** Done in M4 sprint 2: the `Mailer` port is deleted, every mail is a template of core.notifications queued in the transaction of the work, with retries and a visible status. Still open: the delivery status in an admin list (sprint 3).
  - **Register without revealing.** Done in M4 sprint 2: `POST /auth/register` answers 202 for every well-formed request and the owner of a taken address gets a notice mail; the username stays a 409. Still open: the "check your mail" page (M5).
  - **Bio as Markdown.** FEATURES asks for a bio, not for Markdown, so it is plain text (max 2000). If wanted: render on the server and sanitise with DOMPurify. Also consider stripping Unicode format characters (bidi overrides) from display names; only control characters are refused today.
  - **Guessing one username from many addresses.** No lockout and no per-username counter (README, "Account locking"): both are a denial of service against a known username. Options that avoid it: alerting on failed logins per username, a proof-of-work or CAPTCHA step-up after repeated failures, 2FA.
  - **Revoke access tokens on a reset (optional).** A reset or a change ends sessions only (ADR-0012). A "revoke my tokens too" switch on the reset page, or a security-event setting, would cover the case of a token minted from a hijacked session.
  - **Reset marks the address confirmed?** Opening a reset link proves control of the mailbox, but the reset does not mark the address verified (kept separate on purpose). Revisit if the UI wants a one-step recovery for unverified accounts.
  - **Self-service account deletion and data export (GDPR).** FEATURES lists account deletion as missing; the purge job already deletes soft-deleted accounts, so deletion needs the route, the confirmation (password or mail link) and the event.
  - **Admin user management (M3/M5).** List, deactivate, change email, force a reset. Not in M2. Revoking the sessions of one user or of everybody is done (M4b sprint 1, routes only; the screen is M5).
  - **2FA (TOTP, WebAuthn).** Not in M2.
  - **Public `GET /auth/oidc/providers`** for the login page (id and display name), with the UI in M5 (sprint 4 follow-up 1, still open).
  - ~~**Outbox retention** now also matters for the purge: events keep the usernames of purged accounts.~~ Done in M4 sprint 4: delivered events are deleted after `outboxRetentionDays`; a test proves the username of a purged account leaves the outbox. A `dead` delivery keeps its event (and the name) until somebody requeues it, see "Audit follow-ups".

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
- ~~**Role events are not audited yet.**~~ Done in M4 sprint 4: `core.audit` records `authz.role.assigned@1`, `.removed@1` and the new `authz.role.permissions.changed@1`, which `setRolePermissions` emits when the set changes. There is still no HTTP route that calls `setRolePermissions`; the admin UI (M5) adds it.

## Settings follow-ups (M3 sprint 3)

- **Admin form and history.** `GET /settings/{module}/schema` and the effective values are ready for the settings form (M5). The form needs per-field labels and grouping (Zod `.describe()` and `.meta()` flow into the JSON Schema); decide the convention with the first form. The history of changes is the audit trail (M4 sprint 4: `settings.changed@1` with the actor and the names of the keys that changed, never the values; `GET /audit?action=settings.changed@1`); the table keeps only the current version, so the trail cannot show the old value.
- **Partial updates.** `PUT` replaces the whole stored object, so the form sends every field. A `PATCH` that merges keys (and removes one with `null` to return to the default) would help scripts that change one setting; add it with the first such script.
- **Declared secrets.** The API lists stored secrets only, so the admin UI cannot show "OIDC secret for provider X: not set". A registry where modules declare the secret names they use (with a description, and a pattern for per-provider names) would let the UI list the unset ones. Secret names are not namespaced by module today: an Admin can set any name, and nothing checks that a module uses it.
- **Faster propagation.** A changed setting reaches another process within 5 seconds (cache TTL). If that is too slow for some setting, a `LISTEN/NOTIFY` message on write that empties the cache of the other processes would make it near-immediate; the kernel already has the listener machinery for the outbox.
- **Secret hygiene checks.** A guard that refuses a `settings` schema with a key that looks like a secret (`password`, `secret`, `token`) at start-up, and a `verify-secrets` command that decrypts every row with the current keys and reports names that fail (useful before and after a rotation), are not built.
- **Key escrow and backup.** The key lives in the environment only. A documented way to back it up with the deployment secrets of the operator's choice (and a `backup`/`restore` command that knows the key is not in the dump) belongs to the backup module.
- **Preference definitions for the UI.** Done for `notifications.preferences` in M4 sprint 3 (its category list). `GET /preferences` lists stored values only. The interface will want the registered keys with their descriptions, schemas and defaults (`GET /preferences/definitions`); add it with the first preference (M5). Preferences have no default in the registry entry yet.
- **The pipeline reads a module's setting.** The server's rate limit depends on the module id `core.settings` and the shape of its `rateLimits` setting (ADR-0017). A second pipeline setting would justify a kernel-level declaration of server settings.
- **`getSecret` is not cached.** It decrypts on every call; the only caller is the OIDC code exchange. Cache it (short TTL, emptied on write) if a hot path needs a secret.
- **Settings read before core.settings is built.** `ctx.settings.get()` called while services are being built, from a module that does not depend on `core.settings`, throws "not ready". Make the port fall back to the defaults in that window if a module needs it.

## Vocabularies, blob store and branding follow-ups (M3 sprint 4)

- **Usage checks for the built-in vocabularies.** `stage`, `thematic-category`, `necessity`, `sender-type` and `aggregate` have no `usage` check, so every term an administrator adds can be deleted. The module that starts storing a key (registry.services for `stage`, M7; kpi.framework for the rest, M8) adds its entry to the registry `vocabulary` and calls `validateTerm` when it saves.
- **Vocabulary administration.** No import or export of terms, no list of locales to offer in the UI, no way to reorder many terms in one call, and no history beyond `settings.vocabulary.changed@1` (recorded by the audit trail since M4 sprint 4, without the labels). Administrators cannot declare a vocabulary; that stays with modules.
- **A full Markdown parser.** Legal texts use a small in-house subset (`packages/sanitize`) because the sprint allowed no dependency beyond `sharp` and DOMPurify. Tables, nested lists, images and reference links need a CommonMark parser (for example `marked` or `markdown-it`) in front of the same DOMPurify step; it needs approval as a new runtime dependency. The bio (plain text today) could use it too.
- **Legal texts per locale, and versions.** One text per page; no translations, no "accepted on" record, no history.
- **Branding extras.** Favicon, login background and theme colours (FEATURES 3.19: they swap with the theme) are not settings yet; add them with the UI shell (M5). Saving a logo is two steps (upload with `POST /files`, paste the hash into the settings); M5's form can do both. The sender address check is length only, not an address syntax check, because `Name <a@b>` is allowed.
- **Blob store limits.** No per-user quota or upload rate beyond the strict rate limit, no virus scan, no animated GIF or WebP (a GIF keeps its first frame as a PNG), no AVIF or HEIC, no image variants (thumbnails) and no listing or deletion of stored files in the admin UI. A leaked file is removed at once with a database statement; otherwise after the grace period.
- **S3 backend.** The architecture mentions it; the table is the only backend (plan §9). The service interface (`put`, `describe`, `setReference`) is what an S3 backend would sit behind; large files would move out of `bytea` first.
- **`GET /files/{hash}` below `/api/internal`.** The route registry has no root surface, so the public file URL is `/api/internal/files/{hash}`. If a shorter public path is wanted (for emails), add a root surface to the registry with an ADR.
- **Content hash in the URL is the only access control** of a stored file, which is right for avatars and logos and wrong for private attachments. A module that stores private files needs a permission-checked route and a flag on the file; decide it with the first such module.
- **Cross-process branding reads.** `getBranding()` is cached for 5 seconds like every setting; mail sent in the window after a change can still use the old name.

## Repository hardening follow-ups (M4a sprint 1)

- **The `57P01` teardown error (#48, #50).** Resolved 2026-10-06. The CI error's object carried `err.client` with `release` and `_poolUseCount`, which only pg-pool's idle listener sets: the pool re-emitted a pooled client's error as its own `error` event, and nothing listened. Two pg-pool behaviours met: `pool.end()` resolves once it has let go of its clients, before they have closed, and a client closing in that gap still has the idle listener. The harness stopped the container in the gap. Now `createPool` listens for `error` (the kernel logs a warning with the SQLSTATE), and `closePool` waits until every connection has closed; the kernel's `stop()` and `openDatabase().close()` use it. `db.test.ts` reproduces the uncaught error without the listener and the early return without the wait. The same fix keeps a running server alive when Postgres ends an idle connection. The earlier `jobs.stop()` fix stays. Not looked at further: the listener clients of the outbox and `wake.ts` (suspect 2), and harnesses without `afterEach` cleanup (suspect 3); neither matches the CI error.
- **Base images outside the Dockerfile.** `postgres:16.15-alpine` (CI service, `docker-compose.dev.yml`) and `axllent/mailpit` are pinned by tag only, and Dependabot's `docker` ecosystem reads Dockerfiles, not these files. Scorecard does not count them. Pin by digest and add a `docker-compose` entry to `.github/dependabot.yml` if the score asks for it.
- **Dependabot runtime bumps without a changeset.** A Dependabot pull request that changes only dependency files needs no changeset (`scripts/changeset-check.ts`), so a security bump of a production dependency does not reach `CHANGELOG.md` by itself. Write a changeset by hand at release time for those, or revisit the exemption.
- **`cli.test.ts` picks a random port.** `freePort()` in `apps/server/src/cli.test.ts` returns a random number from 20000 to 40000 without checking it. It collided once with a port in use (`EADDRINUSE`, `exits 1 and says why when the database cannot be reached`) in a full local run and passed on the re-run. Bind port 0 and read the port back, or retry.

## Security assurance follow-ups (M4a sprint 2)

What the ASVS assessment and the tool left for later. The open requirements themselves are `fail` entries in `docs/security/asvs/v*.yaml` with an issue each; this list is what no entry covers.

- **Other ASVS chapters, Best Practices silver and gold.** Only V6, V7, V8 and V10 are claimed. Further chapters, and silver and gold (they need a second maintainer and two-person review), go here until there is one. Scorecard targets above 6.5 likewise.
- **Signed images, SLSA provenance and an SBOM** for the Signed-Releases check: M18 and Gate 4 (cosign on the profile images, provenance attached to the GitHub release).
- **Fuzzing** (`fast-check`) for the pure calculation library and the parsers: M10 and M11. Check the current Scorecard detection rules first.
- **Dependency review action** on pull requests and licence checks of dependencies.
- **Peer or external review** of the assessments: a second maintainer or an outside reviewer sets `assessment_type` to `peer` or `external` and fills `reviewer`.
- **Tests that would turn code pointers into tagged tests.** V6.2.8 (a password is verified exactly as received: surrounding spaces, case) and V6.3.2 (a fresh install has no user) pass on a code pointer only. The test OIDC providers (`apps/server/src/testing/oidc-flow.ts`, `modules/core-identity/test/oidc.ts`) do not check `code_verifier` against the S256 challenge, so V10.2.1 rests on the challenge being sent and the state being checked; make the stub verify it and add a test that a wrong verifier is refused. Nothing asserts that a configured `offline_access` scope leaves no refresh token stored.
- **RFC 9207 `iss` authorization-response parameter.** Not validated; mix-up protection (V10.2.2) rests on the per-provider callback, the state tied to the provider and the id_token `iss`. Validating `iss` when the provider sends it would be extra hardening.
- **Dedicated tests for table-driven evidence.** V10.5.3 and V10.5.4 (issuer and audience) and V6.2.1, V6.2.5 and V6.2.9 (password rules) are tagged on `it.each` titles, so the tag covers every case of the table. A test per requirement would make the evidence sharper.
- **`pnpm test --filter` overwrites `reports/vitest-junit.xml`.** The report holds only the projects that ran, so `pnpm security:asvs` after a filtered run can report a tag as having no passed test. Run the full `pnpm test` first.
- **`ASVS impact` as a required check.** It becomes one after it is on `main` (CONTRIBUTING.md, "Releases"): add it to the ruleset once the release that carries it is out.

## Authorization follow-ups (M4b sprint 3)

What the response-side audit and the walker (`apps/server/src/response-fields.test.ts`) left. The audit found no secret in any response schema, and nothing had to be fixed.

- **The walker reads declared schemas, not payloads.** No pipeline step validates a response against its schema, so a service that returned an extra field would not be seen. Services build named fields and the route tests for tokens, secrets, settings and the audit trail read real responses, but nothing checks every route. The contract tests of M8 (`pnpm test:contract`, every public route against its OpenAPI schema) should also fail on a forbidden name in a real response body.
- **Free-form values cannot be walked.** `values` of a setting and `value` of a preference are `z.unknown()` records, so a secret-named key inside them is not seen by the walker. The guard in "Secret hygiene checks" above (a settings schema with a secret-looking key is refused at start-up) would close that; do it with that item.
- **The route matrix is regenerated by hand.** `authorization-doc.test.ts` fails when `docs/security/authorization.md` differs from the live registry, but regenerating needs Docker and an environment variable (the header of the test says how). A `pnpm` command that boots the kernel without a database would make that quicker.
- **Rows for the registry modules.** `docs/security/authorization.md` gets the field tables of the services, KPIs and organisations when M6 and M7 add them; the generated route table needs no change, and the walker covers their responses from the first route.

## Sessions follow-ups (M4b sprint 1)

What the session work left for later ([ADR-0025](adr/0025-absolute-session-lifetime-and-recent-authentication.md), [docs/security/sessions.md](security/sessions.md)).

- **Lifetimes in hours.** `sessions.inactivityDays` and `absoluteDays` are whole days, at least 1. A high-risk deployment that wants 12 hours or 1 hour of inactivity needs `inactivityMinutes` and `absoluteMinutes` (or ISO durations) and a validation range.
- **Back-channel and RP-initiated logout.** Ending a session at the provider does not end the Scorpion session, and the reverse (sessions.md, 7.1.3). Needs a public back-channel endpoint, a table from the provider's `sid` to our sessions, a signature check of the logout token, and a provider setting for the end-session endpoint.
- **A session list with device names.** Times and the current marker only today (Decision 6). A label or a coarse location needs a privacy text (M5), a retention rule, and a way to keep it out of logs.
- **A limit on concurrent sessions,** if misuse shows up (Decision 6): a setting, the oldest session ended at the limit, and a message in the UI.
- **Cross-process session invalidation.** Another process accepts an ended session for at most 5 seconds. A `LISTEN/NOTIFY` message from `revoke*` that empties the other caches would make it immediate.
- **Re-authentication on admin termination, and a stricter window per action.** `sessions.recentAuthSeconds` is one window for every action; the administrators' routes do not ask for a recent authentication. A per-action `maxAgeSeconds` is already an argument of `requireRecentAuth`.
- **AAL2 behaviour.** A deployment whose provider enforces MFA may want its local session to follow the provider's `acr` and the NIST periods for AAL2; `acr` and `amr` are not read (sessions.md).
- **A notice mail when sessions are ended by an administrator, and when a new session starts** from an unfamiliar browser. The audit trail has the first; neither mails.
- **A disable-account feature** must call `revokeAll` in the same transaction and get a test (ASVS 7.4.2).
- **The re-authentication screen** (M5): the page that shows `reauthentication-required`, asks for the password or sends the person to the provider, and returns to the change. The OIDC callback redirects to the application root today, with no return path.

## Credentials follow-ups (M4b sprint 2)

What the credential work left for later ([ADR-0026](adr/0026-credential-rules-throttling-and-mail-confirmed-linking.md), [docs/security/authentication.md](security/authentication.md)).

- **TOTP, WebAuthn and recovery codes** (6.3.3 passes on a documented rationale today). Needs a dependency, a secret per person in the encrypted store, recovery codes (6.5.x applies), screens, and a rule for what an OIDC-only account does. An operator who needs a second factor requires it at the OIDC provider.
- **A notice mail on repeated failed logins** (6.3.5 and 6.3.7 are Level 3), and on a new link or a changed password. The throttle blocks; it does not tell the owner.
- **An offline floor of the 3000 most common passwords** (a file in the repository with its licence and SHA-256 recorded), checked when the breach service does not answer, so the fail-open window is not empty (6.2.4). Together with a self-hosted mirror of the range API for an installation that may not call the public one.
- **Alternatives to a hard lockout.** The throttle has no lockout on purpose. If a deployment sees distributed guessing that the ceiling does not stop: a CAPTCHA or proof-of-work after the free attempts (a dependency and a third party), a longer ceiling per account, or a requirement of a second factor for a blocked account. An administrator action to clear the counters of one account is also missing.
- **An admin view of the throttle:** which accounts are blocked and for how long, and settings screens for `loginThrottle` and `passwordBreachCheck` (the schema validates them; no screen exists until M5 and later).
- **Check the password at login.** The password is in hand at a successful login: checking it against the breach set then (and asking for a change) would catch a password that was breached after it was set. Today the rules apply when a password is set.
- **The page that confirms a provider link (M5)** should name the provider before the person confirms, which needs a read route for the token (`POST /account/oidc-link/confirm` names it only in its answer). The callback redirects to `/login?notice=check-mail` and the mail links to `/link-sign-in#token=…`; both pages are M5's.
- **A notice to the account holder when a provider is linked,** and a list of the linked providers with a way to unlink one, are not there.
- **The breach counter is per process,** not per server: `scorpion_password_breach_check_failures_total` reads a counter in `packages/integrations`. A kernel metrics API for modules would let each server own its counters.
- **Verification link of 10 minutes** if the maintainer rejects the reading of ADR-0026 section 3: change `VERIFICATION_TTL_MS`, the mail text and the README.
