# core.audit

The append-only trail of administrative and permission-relevant actions and of API calls, a viewer with filters and a CSV
export, retention, and the kernel's own maintenance (outbox and job-run retention, requeue of a dead event delivery). It writes
through two doors: it subscribes to the events of the modules it depends on (atomic with the change, idempotent through the event
id), and it contributes the kernel's **audit sink** that the request pipeline and `ctx.audit(entry)` call
([ADR-0021](../../docs/adr/0021-audit-sink-redaction-and-append-only.md), [ADR-0024](../../docs/adr/0024-kernel-maintenance-job-results-and-export.md)).

Status: M4 sprint 4. The viewer screens are M5; the routes below are what they use.

## Manifest

| Part           | Value                                                                                                                                              |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| id             | `core.audit`                                                                                                                                       |
| table prefix   | `audit_` (set in the manifest; ADR-0004): one table, `audit_event`                                                                                 |
| dependencies   | `core.authz`, `core.settings`, `core.identity`; `core.notifications` as an optional peer (its three events are recorded when it is in the profile) |
| routes         | internal API: the viewer, one entry, the CSV export, the outbox page and its requeue, see "Routes"                                                 |
| jobs           | `core.audit.retention`, `core.audit.system.outbox-retention`, `core.audit.system.job-run-retention`, see "Jobs"                                    |
| events         | emits none; subscribes to every logged event, see "What is logged"                                                                                 |
| registries     | contributes the one entry of the kernel registry `kernel.auditSink`                                                                                |
| public service | none. `public.ts` declares an empty service; nobody calls the trail directly. Write through `ctx.audit(entry)`.                                    |

Profiles: `full` and `kpi-tracker` list it. `denbi-registry` and `nfdi-onboarding` have no modules yet; add it when they get
`core.identity`. A profile without `core.audit` starts: the sink is a function that does nothing, no table is created and the routes
do not exist (tested).

### Permissions

| Permission                 | Allows                                                    | Held by default by |
| -------------------------- | --------------------------------------------------------- | ------------------ |
| `core.audit.read`          | List the trail with filters, open one entry               | Admin              |
| `core.audit.export`        | Export the trail as CSV                                   | Admin              |
| `core.audit.system.read`   | See the state of the event outbox and its dead deliveries | Admin              |
| `core.audit.system.manage` | Put a dead event delivery back in the queue               | Admin              |

Admin holds every declared permission by resolution (ADR-0014). **Reading the log needs `core.audit.read` or `core.audit.export` and
nothing else.** A plain User gets 403 on every route of this module (the walker in `defect-01.privilege-escalation.test.ts`, and its
"log reads" cases: session, token, a token with the scope and an owner without the permission).

### Settings

Stored by `core.settings` under `core.audit` (`PUT /settings/core.audit`). Nothing secret.

| Key                   | Default | Meaning                                                                                                                               |
| --------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `channels.admin`      | `true`  | Log administrative actions: ordinary events, `ctx.audit` entries and calls of internal-API routes. Critical events are logged anyway. |
| `channels.api`        | `true`  | Log calls of the public API (`/api/v1`, M8 onwards).                                                                                  |
| `retentionDays`       | `365`   | Rows with source `event` (events and `ctx.audit`) older than this are deleted by the daily job.                                       |
| `apiRetentionDays`    | `90`    | Rows with source `api` (the request log) older than this are deleted.                                                                 |
| `ipTruncateAfterDays` | `30`    | Older rows keep the client address as a network prefix only: `203.0.113.0/24`, `2001:db8:1234::/48`.                                  |
| `csvMaxRows`          | `50000` | The most rows one export writes (at most 1 000 000).                                                                                  |
| `outboxRetentionDays` | `14`    | Kernel maintenance: outbox events whose deliveries are all done, older than this, are deleted.                                        |
| `jobRunRetentionDays` | `90`    | Kernel maintenance: finished job runs older than this are deleted.                                                                    |

## The table

`audit_event`, one row per thing that happened. UUIDv7 ids; no foreign keys (an actor or subject id is kept as written, also after the
account is purged).

| Column                              | Meaning                                                                                                                        |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `occurred_at`                       | For an event, when it was emitted; for a request, when the entry was written.                                                  |
| `source`                            | `event`: a domain or administrative action. `api`: the log of a request.                                                       |
| `action`                            | The event name (`authz.role.assigned@1`), `api.<METHOD>`, or the action of a `ctx.audit` entry (`audit.exported`).             |
| `outcome`                           | `ok`; `denied` (401, 403, 429); `error` (everything else ≥ 400, 422 included).                                                 |
| `actor_kind`, `user_id`, `token_id` | `user`, `token` (with the owner and the token id, never the token), `anonymous` (no credentials or refused ones), `system`.    |
| `ip`                                | The client address as the pipeline resolved it (`TRUSTED_PROXIES`); cut to a prefix after `ipTruncateAfterDays`.               |
| `method`, `path`, `status`          | The route **template** with its surface (`/api/internal/users/{id}/approve`), never the concrete URL.                          |
| `query`, `body`, `truncated`        | Only for a route with `audit: { body: true }`: redacted, each at most 8 KB; `truncated` says a part was cut.                   |
| `request_id`                        | The `X-Request-Id` of the call, to find it in the logs.                                                                        |
| `subject_type`, `subject_id`        | What it was done to: the first path segment and the last path parameter of a request; for an event, from its payload.          |
| `event_id` (unique)                 | The outbox event this row records; a redelivered event makes no second row.                                                    |
| `payload`                           | The event payload (without `username`), or the payload of a `ctx.audit` entry. No secret by design; a test proves the schemas. |

**Append-only.** A trigger refuses `UPDATE`, `DELETE` and `TRUNCATE` with SQLSTATE `42501`, except inside the retention job's
transactions, which switch on the transaction-local flag `scorpion.audit_maintenance` (`set_config(…, true)`, i.e. `SET LOCAL`): then
`DELETE` is allowed, and so is an `UPDATE` that changes only `ip`. A database superuser can drop the trigger; the trail is not tamper-evident
against whoever owns the database. After a change of the table: `pnpm db:generate --filter @scorpion/core-audit`; the trigger is the
hand-written migration `0001_append_only.sql` and must stay when the table changes.

## What is logged

**Events.** `service/decisions.ts` holds a decision for every event a loaded module declares: logged (actor, subject, critical or not) or
skipped with a reason. A test fails when a declared event has none, so a new event is a decision somebody made.

| Module               | Logged                                                                                                                                                                                                             | Skipped                                                     |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------- |
| `core.authz`         | `authz.role.assigned@1`, `authz.role.removed@1`, `authz.role.permissions.changed@1` (critical)                                                                                                                     |                                                             |
| `core.settings`      | `settings.changed@1`, `settings.secret.changed@1` (critical); `settings.vocabulary.changed@1`                                                                                                                      | `settings.preference.changed@1` (a person's own preference) |
| `core.identity`      | approval, rejection, token created, revoked and rotated, sign-in method linked, password reset requested, reset and changed, first administrator, purge (critical); registration, e-mail verified, profile updated |                                                             |
| `core.notifications` | `notifications.delivery.dead@1`, `.requeued@1`, `notifications.settings.tested@1` (only when the module is in the profile)                                                                                         |                                                             |

_Critical_ events are logged whatever `channels` says. The actor of an event is read from its payload (`actorId`, `approvedBy`,
`revokedBy`, …); an id that matches no user is kept as written; no actor means `system`. A request for a password reset or its
confirmation has the account as the subject and an anonymous actor.

**Requests.** A route is logged when its `createRoute()` has `audit`. `audit: true` records who called, which route template and the
outcome, **also when the caller was turned away** (401, 403, 429) **or the input was invalid (422)**, without body or query.
`audit: { body: true, redact: [...] }` adds the body and the query. A route under `/auth/` can never store a body: registration fails.
Routes that have `audit` today: approve and reject, assigning and removing a role, creating, revoking and rotating a token,
saving settings (with the body), setting and removing a secret (without it: the value is never read), vocabulary changes, uploading a file,
requeueing a delivery and sending a test mail, and the three read routes of this module.

**Redaction.** A key whose name (lower case, letters and digits only) equals or ends with `password`, `token`, `secret`, `authorization`,
`apikey`, `code` or `value`, or one of the route's `redact` names, has its value replaced by `[redacted]` at any depth. A body that is
not JSON is described (`[non-JSON body, 12 bytes]`), never copied. See ADR-0021 for the rules and their limits (a name rule, not a
content scan).

**Failure.** The pipeline writes the entry after the handler has returned; if that fails, the failure is logged by request id and
SQLSTATE and the response is unchanged. A `ctx.audit` in a service joins the caller's transaction and fails it.

## Routes

All under `/api/internal`. Every list uses the standard envelope with 0-based pages.

| Route                                         | Permission                 | Notes                                                                                                                                                             |
| --------------------------------------------- | -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /audit`                                  | `core.audit.read`          | Filters `method`, `user`, `endpoint` (route-template prefix, matched literally), `action`, `outcome`, `source`, `from`, `to`. Order: `occurred_at` desc, then id. |
| `GET /audit/{id}`                             | `core.audit.read`          | One entry; 404 for an unknown or malformed id.                                                                                                                    |
| `GET /audit/export.csv`                       | `core.audit.export`        | The same filters, no paging. Streamed. Headers `X-Row-Count`, `X-Row-Cap`, `X-Truncated`. The export is itself an entry (`audit.exported`).                       |
| `GET /system/outbox`                          | `core.audit.system.read`   | Counts (pending, dead, lag) and the dead deliveries (names, attempts, a masked error; never a payload).                                                           |
| `POST /system/outbox/deliveries/{id}/requeue` | `core.audit.system.manage` | A `dead` delivery only; 404 unknown, 409 not dead. Audited in the same transaction (`system.outbox.requeued`).                                                    |

The CSV columns, the cap and the formula guard (a cell that starts with `=`, `+`, `-`, `@`, a tab or a line break gets a leading `'`)
are in ADR-0024. There is no route that writes or deletes the trail.

## Jobs

| Job                                   | Schedule (UTC) | Does                                                                                                                                                           |
| ------------------------------------- | -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `core.audit.retention`                | `37 3 * * *`   | Deletes `event` rows past `retentionDays` and `api` rows past `apiRetentionDays`, in batches of 1000, then cuts the address of older rows. Returns the counts. |
| `core.audit.system.outbox-retention`  | `47 3 * * *`   | Deletes outbox events older than `outboxRetentionDays` whose deliveries are all delivered, or that have none. Never an event with a pending or dead delivery.  |
| `core.audit.system.job-run-retention` | `57 3 * * *`   | Deletes finished job runs older than `jobRunRetentionDays`; never a running one.                                                                               |

The plan calls them `audit.retention`, `system.outbox-retention` and `system.job-run-retention`; a job name must carry the module id.
Each returns its counts (`deletedEvents`, `deletedApi`, `ipTruncated`, `deleted`); the kernel stores them in `kernel_job_run.result`
(`listJobRuns`), so "how many rows did last night remove" is in the history and in no log line that could carry a name.

## Operating notes

- A secret never reaches the trail: bodies are stored only for routes that opt in, redacted and capped; the secrets routes store no
  body; events carry no secret by design (a test checks every declared schema); a test greps the log stream, the trail and the outbox for
  a reset token, the SMTP password and the webhook secret.
- Personal data in the trail: user and token ids, the client address (cut after 30 days), no username, no e-mail address. The trail
  cannot be edited, so what it holds is bounded by retention.
- The outbox keeps an event with a dead delivery until somebody requeues it and it is delivered; look at `GET /system/outbox`.
- To keep the trail longer, raise `retentionDays`; to switch off the request log of the public API, set `channels.api` to `false`.
- A route that is added with `audit` and a body must say why in review: the redaction is by name.

## Tests

`service/append-only.test.ts` (the trigger and the flag), `subscriber.test.ts` (events, actors, idempotence, channels), `sink.test.ts`
(redaction, caps, `ctx.audit` in a transaction, channels), `viewer.test.ts`, `export.test.ts`, `retention.test.ts`, `system.test.ts`,
`decisions.test.ts` (every declared event has a decision; no schema holds a secret), `redact.test.ts` and `csv.test.ts` (table-driven).
In `apps/server`: `audit-routes.test.ts` (the pipeline: denied, 422, bodies, secrets, the viewer, the export, the system routes),
`audit-journey.test.ts` (the journey of the plan with Mailpit) and the audit rows of `defect-01.privilege-escalation.test.ts`.
