# M4 Sprint Plan: `core.notifications` + `core.audit`

Status: approved, 2026-10-05 (§11 is in `implementation.md`). Decisions 1 to 11 were answered the same day (§10).
Scope source: [implementation.md](implementation.md) §3, M4. Closes no defect of FEATURES §5; it adds the "log reads" case to the
defect-1 suite. Releases as `0.5.0`.

M4 is size M (about 3 weeks for one developer). It adds two modules, moves `core.identity` onto the first of them, and
takes over the hand-offs that M2 and M3 parked for M4 (README "M4", `docs/backlog.md`). This plan splits it into four sprints of
about one week, each one `feature/m4-*` branch and one pull request into `dev`. M4 is released once, after sprint 4.

## 0. Before sprint 1

1. `dev` carries `0.4.0` (the merge-back of `release/0.4.0` is done). The working branch for sprint 1 starts from `dev`.
2. The decisions in §10 are answered. Write ADR-0019 (module graph and the notifications port) as the first commit of sprint 1.
3. Add the lines in §11 to M4's scope in `implementation.md`. FEATURES §2 shows `core.audit` depending on identity and does not
   list the authz and settings dependencies; where it conflicts with the architecture or this plan, the plan and the ADRs win.

## 1. What M2 and M3 hand to M4

| Hand-off                                                                                                                   | Where it was recorded                  | Sprint |
| -------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- | ------ |
| The `Mailer` port and the two plain-text mails move behind `core.notifications`; the port in `core-identity` is deleted    | ADR-0012, identity README, backlog     | 2      |
| `SMTP_URL` (can hold a password) is replaced by notification settings and a secret                                         | backlog (sprint 5 follow-ups)          | 1, 2   |
| A crash between commit and send loses one mail; a failed send is only logged: queue with retries and visible status        | ADR-0012                               | 1, 2   |
| The unconfigured mailer's "not sent" warning must not flood logs once every registration sends mail                        | backlog                                | 2      |
| Welcome, admin "registration request", approved and rejected mails (FEATURES §3.15)                                        | FEATURES §3.15                         | 2      |
| `POST /auth/register` answers 409 for a taken address; hide it with a mail to the owner                                    | backlog ("Register without revealing") | 2      |
| `authz.role.assigned@1` and `.removed@1` have no subscriber; `setRolePermissions` emits nothing                            | backlog (authz follow-ups), M3 plan §9 | 4      |
| `settings.changed@1`, `settings.secret.changed@1`, `settings.vocabulary.changed@1` have no subscriber (history of changes) | backlog (settings follow-ups)          | 4      |
| Outbox retention (events keep usernames of purged accounts), job-run retention, requeue of dead deliveries                 | backlog (kernel follow-ups), ADR-0003  | 4      |
| Registries `notify.transport` and `notify.template`; in-app inbox; user preferences; admin status list; log viewer and CSV | implementation.md M4, architecture     | 1 to 4 |
| Module README "until M4" sentences removed                                                                                 | identity README                        | 2      |

## 2. Cross-sprint rules

- Stay inside M4. Anything else goes to `docs/backlog.md`.
- **One pull request per sprint** (CLAUDE.md, "Pull requests are expensive: batch them"). ADRs, README updates, backlog lines
  and review fixes go into the sprint's pull request. Push the branch and open the pull request when the sprint is complete and
  verified locally (`pnpm check`, tests of every touched module).
- Every service method has an integration test against real Postgres, including a denied-permission case and a rollback case for
  multi-row writes. Every route has a denied-request test and an entry in the "denied for a plain User" matrix (the route-table
  walker from M3 fails otherwise).
- Pure logic (backoff schedule, template rendering and escaping, redaction, CSV escaping, address-range checks) gets table-driven
  unit tests.
- **Nothing secret in a delivery row that outlives its use, a log line, an event, an audit entry or an API response.** Mails
  with a token (`sensitive` templates) have their rendered body deleted when the delivery reaches `sent` or `dead`. A test captures the
  log stream and the audit table and greps them for a reset token, the SMTP password and the webhook secret.
- Use the factories in `packages/testing`; add `makeDelivery`, `makeInboxItem` and `makeAuditEvent`.
- Update the README of every module whose manifest changes in the same commit (CLAUDE.md).
- Every pull request carries a changeset. Write it for operators: `SMTP_URL` is gone, new settings, new routes, new
  permissions, what stops working.
- New runtime dependencies are named in the pull request description. M4 expects none: `nodemailer` is already a dependency
  (ADR-0012), webhooks use `fetch`, templates are TypeScript. If sprint 1 needs a CSV writer or an address-range helper, write it
  in-house (it is a few dozen lines) and say so.

## 3. Sprint overview

| Sprint | Branch                               | Theme                                                                                | Closes |
| ------ | ------------------------------------ | ------------------------------------------------------------------------------------ | ------ |
| 1      | `feature/m4-notifications-core`      | `core.notifications`: delivery queue, retries, transports, settings, secret          | none   |
| 2      | `feature/m4-templates-identity-mail` | Templates and locales, identity moved onto notifications, register without revealing | none   |
| 3      | `feature/m4-inbox-preferences`       | In-app inbox, preferences, admin status, deliveries, requeue and test routes         | none   |
| 4      | `feature/m4-audit-release`           | `core.audit`: sink, subscriber, viewer, CSV, retention; kernel jobs; release         | none   |

Order matters: notifications comes first because identity depends on it (Decision 1) and because sprint 2 removes `SMTP_URL`.
Sprint 3 needs sprint 2's templates only for the inbox text, so it could start once sprint 1 is merged if there is a second
developer. Audit (sprint 4) is independent of notifications except that it records their events; it can run in parallel with
sprints 2 and 3.

Module graph after M4 (no cycle): `core.authz` ← `core.settings` ← `core.blob` ← `core.notifications` (settings, authz) ←
`core.identity` (authz, settings, blob, notifications) ← `core.audit` (authz, settings, identity; and notifications as an
optional peer for its events). Table prefixes `notify_` and `audit_` are set in the manifests (ADR-0004).

## 4. Sprint 1: `core.notifications` core

**Branch:** `feature/m4-notifications-core`. **Goal:** a message handed to the module is stored in the caller's transaction, delivered
with retries, and visible; nothing in `core.identity` uses it yet.

Work items

1. Create `modules/core-notifications` (`module.ts`, `public.ts`, `README.md`, `db/schema.ts`, first migration), prefix `notify_`.
   It is user-agnostic like `core.authz` (Decision 1): it stores an opaque `recipient_user_id` without a foreign key and takes the
   address from the caller.
2. Table `notify_delivery`: id (UUIDv7), `template` key, `channel` (`email` or `webhook`), `recipient_address`, `recipient_user_id`
   (nullable), `locale`, `subject`, `text_body`, `html_body`, `sensitive` flag, `status` (`queued → sending → sent | queued | dead`,
   a text column checked in the service, with `status_changed_at`), `attempts`, `next_attempt_at`, `locked_until`, `last_error`
   (an error **code**, never a message), `sent_at`, `created_at`, `transport` id used. Indexes for the claim and for the status list.
3. **Public service** `enqueue(tx, message)`: throws unless it runs inside `ctx.db.tx()`, like `ctx.events.emit` (ADR-0003). It
   validates the message (Zod, size limits), inserts the row and sends `pg_notify` inside the transaction. Rolling back removes
   the mail. This closes the "crash between commit and send" gap of ADR-0012.
4. **Delivery** as a job `notify.deliver`: claims due rows with `FOR UPDATE SKIP LOCKED` and a lease (5 min), counts the attempt at
   claim time, sends outside any transaction, marks `sent`, or schedules the next attempt. Backoff 30 s doubling up to 1 h,
   `maxAttempts` 8 (setting), then `dead`. A failing row never blocks the others. The job is woken by `pg_notify` through the
   kernel's listener and by `ctx.jobs.enqueue` after the commit, and a cron sweep every minute covers missed wake-ups. (Verify in
   source: `ctx.jobs.enqueue` sends through pg-boss outside the caller's transaction, so the table, not the pg-boss queue, is
   the source of truth.)
5. **Registry `notify.transport`** with three entries: `smtp` (Nodemailer; host, port, TLS mode `starttls | tls | none`, user,
   timeouts), `webhook` (Decision 6: a mirror for admin-addressed notifications; JSON body, HMAC-SHA256 signature header, 5 s
   timeout, no redirects), and `none` (accepts and records the message as `sent` with transport `none`, so a deployment without
   mail works and the status list says so). The email channel uses `smtp` or `none`; the webhook is an extra target.
6. **Settings** (`core.notifications` settings schema): `emailTransport`, `smtp` (without password), `webhook` (`enabled`, `url`,
   `allowPrivateTargets`), `defaultLocale`, `maxAttempts`, `retentionDays` for delivered rows. The SMTP password and the webhook
   signing secret live only in the secrets store under `notifications.smtp.password` and `notifications.webhook.secret`
   (`scorpion set-secret`). No `SMTP_URL` fallback (Decision 7): the variable is not read by the new module; identity stops reading it in
   sprint 2.
7. **Transport cache** is rebuilt when the settings or the secret change (`settings.changed@1`, `settings.secret.changed@1`, plus the
   5 s cache TTL of the settings port as the cross-process bound). A test with two kernels over one database proves a change
   reaches the second process within the TTL.
8. **Webhook target protection** (Decision 8): resolve the host, refuse loopback, link-local, private, unique-local and
   metadata addresses (IPv4 and IPv6, including IPv4-mapped), connect to the resolved address (no second lookup), follow no
   redirects, cap the response read. `allowPrivateTargets` (off by default) lifts the range check for an internal relay. Table-driven
   tests for the range check, including DNS rebinding (the name resolves to a public then a private address) and `http://`
   downgrade.
9. Visible status in the service: `status()` returns counts by status, the last error codes and whether the transport is `none`.
   (Routes come in sprint 3.)
10. ADR-0019: "Module graph and the notifications port" (Decision 1, including why notifications does not subscribe to identity events
    and what the sensitive-body scrub guarantees). ADR-0020: "Delivery queue in a table, with job wake-up" (item 4).

Definition of done: `pnpm check` and `pnpm test --filter @scorpion/core-notifications` pass. A message enqueued in a transaction that
rolls back is not delivered; one that commits is delivered once, even with two workers racing. A relay that is down yields
`queued` rows with growing `attempts`, then `dead` after the last attempt, and the other rows still go out. A `sensitive` body is
gone once the row is `sent` or `dead`. The webhook refuses `127.0.0.1`, `169.254.169.254`, `[::1]`, `10.x` and a name that resolves to them.

## 5. Sprint 2: Templates, locales, identity on notifications

**Branch:** `feature/m4-templates-identity-mail`. **Goal:** every mail the system sends goes through notifications; registering
produces the right mails in Mailpit.

Work items

1. **Registry `notify.template`**: one entry per template key, declared by the module that owns the event, with a Zod schema for
   its data, the `sensitive` flag, a `category` (for preferences, sprint 3) and a `mandatory` flag (security mails cannot be
   switched off), and a render function `(data, locale, branding) → { subject, text, html }`. Validated at start-up: a template
   without an `en` and a `de` catalogue entry fails the start.
2. **Rendering** in TypeScript, no template engine (Decision 3): a shared layout (instance name, logo URL, contact address, imprint
   link from branding settings, rule 9), an escaping helper for the HTML part, and a plain-text part built from the same data.
   Locale catalogues `en` and `de` in the module; a missing key falls back to English at run time and fails a test.
   Snapshot tests per template and locale, and an escaping test with hostile names (`<script>`, a bidi override, a line break in a
   subject, which must not allow header injection).
3. **Locale choice** (Decision 5): the user preference key `locale` (registered in the settings preference registry), else the
   instance `defaultLocale`. A mail sent before an account exists (reset request, register, register attempt) uses the default or
   the locale the request carried, validated against the shipped list.
4. **Templates shipped in M4** (FEATURES §3.15 plus the plan's additions): `identity.welcome` (pending review),
   `identity.registration-request` (to admins), `identity.approved` (with a sign-in link), `identity.rejected` (with the contact
   address), `identity.password-reset` and `identity.email-verification` (both `sensitive`, `mandatory`), `identity.register-attempt`
   ("someone tried to register with your address", `mandatory`). `registry.membership-requested` and `registry.membership-decided`
   ship as registered templates with schemas and render tests, so M6 only enqueues them; the same holds for the onboarding and KPI
   reminder mails (M10, M15).
5. **Identity moves onto notifications.** `core.identity` declares the dependency, drops `service/mailer.ts` and `SMTP_URL`, and
   enqueues inside the transaction that does the work: register (welcome + one admin mail per admin), approve, reject, reset
   request, verification request, address change. "All admins" is resolved by identity (holders of the Admin role from the authz
   service plus their addresses; if `core.authz` has no method for it, add one that follows ADR-0015's trusted-caller rule, with a
   test that a route cannot reach it). Rejected and approved mails are enqueued in the same transaction as the status change, so a
   rollback sends nothing.
   5a. The mail-budget rate limits of ADR-0012 stay as they are; the "never wait for SMTP" timing rule now holds by construction,
   because the request only inserts a row.
6. **Register without revealing** (Decision 4): `POST /auth/register` answers 202 `{ accepted: true }` for every well-formed request.
   A new address gets the account, the welcome mail and the verification mail; a taken address gets `identity.register-attempt`
   and nothing else. The taken username stays a 409 (usernames are public, backlog). The budget is spent on both paths and the work
   is equal as far as practical (ADR-0012's timing rule). It is a response-code change on one route and no UI exists yet: say so in
   the changeset. The defect-13 and registration tests are updated, not weakened.
7. Quiet logs when nothing is configured: with `emailTransport = none` a mail logs one line at start-up and a counter, not one
   warning per message; `status()` shows "transport none" so operators notice.
8. Dev setup: `docker-compose.dev.yml` seeds Mailpit through settings (a seed step of `core.notifications` for local profiles only, never in
   a production image); `pnpm dev` documentation updated.
9. Identity README loses every "until M4" sentence; `core.notifications` README lists permissions, settings, secrets, registries,
   events, jobs.

Definition of done: registering through the real pipeline puts the welcome and the admin mails in Mailpit, with the sender and
instance name from branding; with the relay stopped the mails stay `queued`, retry, and arrive when it returns; a reset token
appears in the mail only (log and table greps are clean, the stored body is gone after sending); registering with a taken address
gets the same response as a new one and the owner receives the notice. `rg SMTP_URL` finds only docs and the changeset.

## 6. Sprint 3: Inbox, preferences, status routes

**Branch:** `feature/m4-inbox-preferences`. **Goal:** users see and control their notifications, administrators see the state of delivery.

Work items

1. **In-app inbox**: table `notify_inbox_item` (opaque user id, template key, title, text, optional link built with the
   `url()` rules of the base path, `created_at`, `read_at`). `enqueue` takes an `inApp` flag, so the item is written in the same
   transaction as the delivery (or alone, when a user has no address or switched email off).
2. Routes (internal API, session or token with scope): list own items (0-based pages, the standard envelope, stable order by
   `created_at` then id), unread count, mark one read, mark all read, delete one. Own items only, enforced in the service with the
   actor id; another user's id is a 403 without a 404 leak, as for tokens in M3. Permissions `core.notifications.inbox.read` and
   `.write` for every signed-in user; the walker's matrix says so.
3. **Preferences** through the settings preference registry (`notifications.preferences`): per template `category`, channel `email`
   and `inApp` on or off, default on. `mandatory` categories ignore the switch. The routes use `core.settings`' own preference
   routes; this sprint adds the registered schema and a `GET` of the category list with descriptions (resolves the "preference
   definitions" backlog item for this key only).
4. **Admin routes** (permissions `core.notifications.status.read`, `.deliveries.read`, `.deliveries.manage`, `.test`; Admin by default,
   through the `authz.defaultRole` registry): `GET /notifications/status` (counts, transport, last error codes), `GET
/notifications/deliveries` (filters: status, template, channel, date range; paginated; **no bodies**, only metadata), `POST
/notifications/deliveries/{id}/requeue` (only `dead`, resets attempts, audited), `POST /notifications/test` (sends a test mail to
   the caller's own address; rate-limited). Deliveries are deleted after `retentionDays` by a daily job `notify.retention`.
5. **Events** declared by notifications for the audit trail: `notifications.delivery.dead@1`, `notifications.delivery.requeued@1`,
   `notifications.settings.tested@1` (ids and template keys only, no address).
6. Retention of inbox items (read items after 90 days, setting) in the same job.
7. Factories, README, matrix entries for every new route in `defect-01.privilege-escalation.test.ts`.

Definition of done: a user sees only their own items and a copy of another user's id is a 403; switching a category off stops its
mail but never a `mandatory` one; an administrator can see a `dead` delivery without its body, requeue it, and the requeue is an
event; a plain User gets 403 on every admin route.

## 7. Sprint 4: `core.audit`, kernel maintenance, release

**Branch:** `feature/m4-audit-release`. **Goal:** admin and permission-relevant actions and public API calls leave an append-only
trail; the kernel's tables get retention; M4 is released.

Work items

1. Create `modules/core-audit` (prefix `audit_`), depending on `core.authz`, `core.settings`, `core.identity`, with
   `core.notifications` as an optional peer (Decision 2).
2. Table `audit_event` (UUIDv7): `occurred_at`, `source` (`event` or `api`), `action` (the event name, or `api.<METHOD>`),
   `outcome` (`ok`, `denied`, `error`), actor (`user_id`, `kind`, `token_id`), `ip`, `method`, `path` (route template, not the
   concrete URL), `status`, `query`, `body` (redacted JSON), `truncated`, `request_id`, `subject_type`, `subject_id`, `event_id`
   (unique, so the at-least-once subscriber is idempotent), `payload` (the event payload; events carry no secrets by design, a test
   proves it for every declared event schema). **Append-only**: a trigger refuses `UPDATE`; `DELETE` is allowed only inside the
   retention job's transaction (a `SET LOCAL` flag), and a test proves a plain `DELETE` and `UPDATE` fail.
3. **Subscriber**: subscribes to the events of `core.authz`, `core.settings`, `core.identity` (and notifications when present) and
   writes one row per event in the delivery handler; unknown actor ids are kept as written (no foreign key). A `channels` setting
   switches `admin` and `api` logging on and off (FEATURES §3.17: "which channels are logged"); security-critical events (role,
   approval, token, settings, secret) are always logged.
4. **Kernel audit sink** (Decision 2, ADR-0021): a port like `kernel.authorizer` (ADR-0005) that `core.audit` contributes and the
   pipeline and `ctx.audit(entry)` call. Without `core.audit` the sink is a no-op, so profiles without it work. `createRoute()`
   `audit` becomes `boolean | { body?: boolean; redact?: string[] }`. The pipeline writes an entry after the response for every
   route with `audit`, **including denied (401/403) and 422 outcomes**. Auth routes never store a body.
5. **Redaction and size** (Decision 5): the body and query are stored only when the route sets `body: true`; keys named
   `password`, `token`, `secret`, `authorization`, `apikey`, `code`, `value` (secret write) and the route's own `redact` list are
   replaced by `[redacted]` at any depth; the stored JSON is capped at 8 KB with `truncated = true`. Table-driven tests with nested
   and array bodies, a secret in a query string, and a body that is not JSON.
6. **Role events**: `core.authz` gets `authz.role.permissions.changed@1` from `setRolePermissions` (role key, added and removed
   permission strings, never user data), declared in its manifest and README, so the trail has no gap (backlog). The audit
   subscriber covers `authz.role.*` and the settings and vocabulary events (resolves "role events are not audited yet" and the
   settings history item).
7. **Viewer API** (permissions `core.audit.read`, `core.audit.export`; Admin by default): `GET /audit` with filters (method, user,
   endpoint prefix, action, outcome, date range), the standard envelope with a stable order (`occurred_at` desc, then id), `GET
/audit/{id}`, and `GET /audit/export.csv` (streamed, escaped, formula-injection guard for cells that start with `= + - @`, a row
   cap from settings, **the export itself is an audit entry**). Reading the log needs no permission other than these two (the
   defect-1 matrix gets the "log reads" case here).
8. **Retention**: daily job `audit.retention` (setting `retentionDays`, default 365; separate `apiRetentionDays`, default 90) deleting in
   batches and recording how many rows it removed in the job-run history. `ip` is cut to a network prefix after 30 days (setting).
9. **Kernel maintenance, hosted in `core.audit`** (Decision 9): the declared jobs `system.outbox-retention` (delete events whose
   deliveries are all `delivered`, and events with no subscribers, after a configurable time) and `system.job-run-retention`, and a
   `system` route group: `GET /system/outbox` (stats and dead deliveries, from the kernel's `outboxStats()` and
   `listDeadDeliveries()`), `POST /system/outbox/deliveries/{id}/requeue`. Permissions `core.audit.system.read` and
   `.manage`. The kernel keeps the query functions and gets the two missing ones (`deleteDeliveredEvents`, `requeueDelivery`),
   with tests in `packages/kernel`. A test proves that purged accounts' usernames leave the outbox after retention.
10. **Defect-1 and journey**: extend `defect-01.privilege-escalation.test.ts` with the audit, system and notification routes; extend the `full`
    journey: register, approve with a role, change a role's permissions and a setting, observe the trail, export it, run
    retention, find the welcome and admin mails in Mailpit, break the relay and watch retries.
11. Documentation: `core.audit` README; ADR-0021 (kernel audit sink, redaction rules, append-only enforcement); backlog entries for
    what M4 deferred (§9); the changeset says `SMTP_URL` is removed and registration answers 202.
12. Release: `release/0.5.0` from `dev`, `pnpm changeset version`, review `CHANGELOG.md`, pull request into `main`, annotated tag
    `v0.5.0`, images `scorpion:0.5.0-<profile>` (manual until the tag workflow in the backlog exists), merge `main` back into `dev` on
    a `feature/…` branch.

Definition of done: a role change, a role-permission change, a setting change, an approval and a token revoke each create an audit
entry with the right actor; a denied admin call to a `audit: true` route is recorded as `denied`; a request body with a password never
reaches the table; the audit table refuses `UPDATE` and an ordinary `DELETE`; retention removes old rows and leaves new ones; a plain
User gets 403 on every audit and system route; profiles that do not list `core.audit` still start.

## 8. Acceptance (from implementation.md) mapped to tests

| Acceptance criterion                                                                     | Where it is proved                                                                                          |
| ---------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Registering produces the welcome and admin emails in Mailpit                             | `apps/server/src/notifications-journey.test.ts` (sprint 2, Mailpit Testcontainer)                           |
| If the SMTP relay is down, emails are retried                                            | `core-notifications/service/delivery.test.ts`: relay down, `queued`, attempts grow, delivered on recovery   |
| …and the failure shows in the admin status list                                          | `apps/server/src/notification-routes.test.ts`: `dead` row listed without body, `last_error` code (sprint 3) |
| A role change creates an audit entry                                                     | `core-audit/service/subscriber.test.ts`, extended in the journey (sprint 4)                                 |
| Templates for all events of FEATURES §3.15, plus membership decided, reset, verification | `core-notifications/templates.test.ts`: every key in en and de, snapshots, escaping                         |
| In-app inbox and per-user preferences                                                    | `inbox.test.ts`, `preferences.test.ts`; own-only 403 cases                                                  |
| Middleware logs every public API call; viewer filters; CSV export; retention job         | `core-audit/service/sink.test.ts`, `viewer.test.ts`, `export.test.ts`, `retention.test.ts`                  |

Additional gates this plan adds: the route-table walker covers every new route; no secret in logs, the audit table or responses
(grep tests); the append-only trigger; sensitive bodies are scrubbed; the webhook refuses private targets; a transport change
reaches a second process within the TTL; a delivery is sent once with two workers; `rg SMTP_URL` is clean; outbox retention
removes delivered events and keeps pending ones.

## 9. Out of scope (goes to `docs/backlog.md` if not there)

- Per-user webhooks and per-event transport routing; Matrix, Slack and SendGrid transports (registry entries for later).
- Digest mails, batching, quiet hours, unsubscribe links for non-mandatory mail (needs a public unsubscribe route and a token).
- A rich audit search (full text over bodies), audit export to an external log sink, tamper-evident hash chains.
- The admin screens for deliveries, the inbox bell, the audit viewer and the system page: M5 builds the UI on these routes.
- Bounce handling and DKIM or SPF checks of the sender address (an operator concern; the operations docs in M18 cover it).
- The `invite-only` and `auto-by-email-domain` approval policies (backlog; they need invitation mails, which this milestone makes
  possible, but are not in M4's scope).
- The ALTCHA slot and the onboarding applicant confirmation mail (M15 enqueues through the port M4 builds).

## 10. Decisions taken (2026-10-05)

1. **`core.identity` depends on `core.notifications`; notifications is user-agnostic** (as authz in ADR-0014). Identity enqueues
   inside its own transaction and resolves recipients itself. Reason: a reset token cannot travel in an event (ADR-0012), and ADR-0003 allows
   subscription only to a dependency's events, so the reverse arrow would force a private mail path in identity. The rendered body of
   a `sensitive` mail lives in the queue row only until delivery and is then deleted. Recorded in ADR-0019.
2. **Audit is an event subscriber plus a kernel audit sink.** Entries for domain changes ride the outbox, so they are atomic with the
   change and idempotent (`event_id`). Public API calls, denied attempts and `ctx.audit()` use the sink port, which is a no-op without
   `core.audit`. Recorded in ADR-0021.
3. **Templates are typed TypeScript functions**, no new dependency, no MJML, no Svelte on the server.
4. **Register without revealing is in M4**: 202 for every request, a notice mail to the owner of a taken address, the username 409
   unchanged.
5. **Audit bodies are redacted and capped** (8 KB), stored only when a route opts in, never for auth routes.
6. **The webhook is an admin-notification mirror**, one signed URL; email stays the user channel.
7. **`SMTP_URL` is removed without a fallback**; host, port and TLS mode are settings, the password is a secret. Precedent: M3's
   decision 4. The release notes say it.
8. **Outbound webhooks refuse private and metadata addresses by default**, resolve once and connect to that address, follow no
   redirects; `allowPrivateTargets` lifts the check.
9. **Kernel maintenance (outbox and job-run retention, outbox requeue) is hosted in `core.audit`** under its own permissions; the kernel
   keeps the query functions. A kernel-level admin surface would need a manifest-less contributor, which is a larger change than M4 justifies.
10. **Locale:** a user preference `locale`, else the instance default; English and German catalogues ship, and a missing German key fails
    a test.
11. **Scope additions** taken over from the backlog: outbox and job-run retention, the role-permission change event, requeue of dead
    deliveries (mail and outbox).

## 11. Additions to M4's scope in `implementation.md` (to approve with this plan)

- Dependency order (ADR-0019): `core.authz` → `core.settings` → `core.blob` → `core.notifications` → `core.identity` → `core.audit`.
  `core.notifications` is user-agnostic; `core.identity` enqueues inside its transactions.
- Delivery rows are the queue; sensitive bodies are deleted after delivery; the webhook is an admin mirror with SSRF protection.
- `SMTP_URL` is removed; SMTP settings and secrets move to `core.notifications`.
- `POST /auth/register` answers 202 for every request (register without revealing).
- Audit: kernel sink, redacted and capped bodies, append-only table, `authz.role.permissions.changed@1`, retention; the kernel's outbox
  and job-run retention and the outbox requeue route are hosted in `core.audit`.
- Acceptance additions: no secret in logs or the audit table; a plain User gets 403 on every notification-admin, audit and system route.

## 12. Risks

| Risk                                                                                        | Impact                                            | Mitigation                                                                                                                     |
| ------------------------------------------------------------------------------------------- | ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Moving identity's mails changes the most security-sensitive flows (reset, verify, register) | A regression reopens an account-recovery weakness | Sprint 2 keeps ADR-0012's tests unchanged and adds the log, table and timing greps; no test is weakened                        |
| `core.audit` as a late subscriber misses events of modules not in its dependency list       | A gap in the trail for M6+ modules                | Optional peers per module; a test fails when a declared event has no audit decision (logged or explicitly skipped)             |
| The pipeline audit hook adds latency or loses entries on a crash                            | Slow requests, missing API entries                | The write happens after the response, errors are logged by id only; an `audit: true` route test checks the entry               |
| Audit volume from public API calls grows fast                                               | Table bloat                                       | `apiRetentionDays` is shorter, batched deletes, an index on `occurred_at`; revisit partitioning if the load test (M18) says so |
| Webhook protection is bypassed (rebinding, redirects, IPv6 forms)                           | SSRF from an admin account                        | Resolve once and connect to the address, no redirects, table-driven range tests including mapped IPv6                          |
| Removing `SMTP_URL` breaks existing dev setups                                              | Confusion for contributors                        | The Mailpit seed in dev, a clear start-up message when the variable is set but unused, README and changeset                    |
| Sprint 4 passes the 1500-line limit (audit, kernel jobs, release)                           | A PR too large to review                          | Split the kernel maintenance (item 9) into a stacked second PR if the diff grows past the limit                                |
