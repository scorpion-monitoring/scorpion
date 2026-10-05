---
'scorpion': minor
---

**Audit trail, kernel maintenance and the audit sink** (new module `core.audit`, in the `full` and `kpi-tracker` profiles). With this
the M4 changes are complete. The breaking points that earlier M4 changesets already announced stand and are unchanged by this one:
`SMTP_URL` is gone (the relay is a `core.notifications` setting and its password a secret), and `POST /auth/register` answers `202` for
every well-formed request.

- **New migrations.** `core.audit` creates one table, `audit_event`, and a trigger that makes it append-only; the kernel adds a column
  `kernel_job_run.result`. Run `scorpion migrate` (or just start the server). A profile without `core.audit` gets only the kernel column.
- **What is recorded.** Role changes, **changes of what a role may do** (new event `authz.role.permissions.changed@1`, from
  `setRolePermissions`), setting, secret and vocabulary changes, approvals and rejections, token creation, revocation and rotation, password
  and sign-in-method changes, the first administrator, account purges, registrations, and the three `core.notifications` events. Each
  row has the actor (a user, a token with its id, the system or nobody), the subject, the time and the event payload. Calls of routes marked
  `audit` are recorded too (who, which route, the outcome, the client address), **also when the call was refused (401, 403, 429) or invalid
  (422)**. Today those routes are: approve and reject, assigning and removing a role, creating, revoking and rotating a token, saving
  settings, setting and removing a secret, vocabulary changes, uploading a file, requeueing a delivery, sending a test mail, and reading the log.
- **What is never recorded.** Passwords, tokens, secret values, the body of a route under `/auth/`, mail content or addresses. A body or
  query string is stored only for a route that opts in, with keys named `password`, `token`, `secret`, `authorization`, `apikey`, `code`
  or `value` (also as a suffix, such as `newPassword`) replaced by `[redacted]`, and cut to 8 KB. Event payloads leave out the username.
  The client address is kept in full for 30 days and then as a network prefix (`203.0.113.0/24`).
- **The table is append-only.** The database refuses `UPDATE`, `DELETE` and `TRUNCATE` on `audit_event`; only the retention job, in its
  own transaction, may delete old rows or shorten an address. A database superuser can still remove the trigger.
- **New permissions** (Admin only; custom roles get none): `core.audit.read`, `core.audit.export`, `core.audit.system.read`,
  `core.audit.system.manage`. A plain User gets **403** on every audit and system route; reading the log needs one of the first two and
  nothing else.
- **New routes** (internal API): `GET /audit` (filters `method`, `user`, `endpoint`, `action`, `outcome`, `source`, `from`, `to`; newest
  first, standard envelope, 0-based pages), `GET /audit/{id}`, `GET /audit/export.csv` (streamed, cells that start with `=`, `+`, `-`, `@`,
  a tab or a line break get a leading `'`, capped by `csvMaxRows`, and the export is itself an entry), `GET /system/outbox` (counts and
  dead event deliveries) and `POST /system/outbox/deliveries/{id}/requeue`.
- **New settings** (under `core.audit`): `channels.admin` and `channels.api` (default on; role, approval, token, settings and secret
  events are always logged), `retentionDays` (365), `apiRetentionDays` (90), `ipTruncateAfterDays` (30), `csvMaxRows` (50000),
  `outboxRetentionDays` (14), `jobRunRetentionDays` (90).
- **New jobs** (daily, UTC): `core.audit.retention`, `core.audit.system.outbox-retention` and `core.audit.system.job-run-retention`.
  The outbox job deletes events whose deliveries are all done, which is what removes the usernames of purged accounts from it; an
  event with a pending or dead delivery is kept. Each job's counts are in the job-run history (`kernel_job_run.result`).
- **For module authors.** `createRoute({ audit })` takes `true` or `{ body, redact }` (a route under `/auth/` cannot store a body),
  `ctx.audit(entry)` writes an entry in the caller's transaction, and both do nothing in a profile without `core.audit`. The settings
  events `settings.changed@1`, `settings.secret.changed@1` and `settings.vocabulary.changed@1` gained a field `actorId` (additive).
  A job handler may return counts. The authenticated actor of a token call carries `tokenId`.
- **If an audit write fails**, the request is not affected: the failure is logged with the request id and the error code only.
