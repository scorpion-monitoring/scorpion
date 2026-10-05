# ADR-0024: Kernel maintenance in `core.audit`, the result of a job, and the CSV export

- Status: Accepted
- Date: 2026-10-05

## Context

M4 decision 9 hosts the kernel's maintenance (retention of the outbox and of the job-run history, the requeue of a dead delivery) in
`core.audit`, because a kernel-level admin surface needs a contributor without a manifest. The plan names the jobs
`system.outbox-retention` and `system.job-run-retention` and says a retention job records the rows it removed "in the job-run history",
which has no column for it. It also asks for a CSV export and leaves its columns and cap open. ADR-0021 holds the decisions about the
sink; this one holds the rest.

## Decisions

### 1. Names, schedules and settings of the kernel maintenance

The kernel requires a job name to start with its module's id, so the plan's short names cannot be used. The jobs are

| Job                                   | Schedule (UTC) | Setting (module `core.audit`)                              | Default     |
| ------------------------------------- | -------------- | ---------------------------------------------------------- | ----------- |
| `core.audit.retention`                | `37 3 * * *`   | `retentionDays`, `apiRetentionDays`, `ipTruncateAfterDays` | 365, 90, 30 |
| `core.audit.system.outbox-retention`  | `47 3 * * *`   | `outboxRetentionDays`                                      | 14          |
| `core.audit.system.job-run-retention` | `57 3 * * *`   | `jobRunRetentionDays`                                      | 90          |

The settings live in `core.audit`'s settings (changed with `PUT /settings/core.audit`). The kernel keeps the SQL
(`deleteDeliveredEvents`, `deleteJobRuns`, `requeueDelivery`, next to `outboxStats` and `listDeadDeliveries`, tested in
`packages/kernel`); the module adds the permission checks, the batches and the audit entry. The permissions are
`core.audit.system.read` and `core.audit.system.manage`; Admin holds them by resolution.

**Outbox retention** deletes events older than the setting whose deliveries are all `delivered`, and events with no subscribers. An event
with a `pending` or `dead` delivery is **never** deleted, so nothing is dropped that a subscriber has to handle or that an operator has
not seen. That is how the username of a purged account leaves the outbox: its events are delivered and old. A `dead` delivery keeps its
event until it is requeued and delivered (the system page shows them). **Job-run retention** deletes finished runs, never a `running` one.
Both delete in batches of 1000 and stop when told to.

### 2. A job may return a result; the history keeps it

`JobDef.handler` may return `Promise<void | JobResult>`, `JobResult` being a flat record of counts, flags and short strings. The kernel
writes it to the new column `kernel_job_run.result` (kernel migration `0003`) when the attempt succeeds, keeping only numbers, booleans
and strings of at most 200 characters (masked like an error), and drops anything nested. `listJobRuns` returns it. A job that returns
nothing leaves `null`. The retention jobs return their counts, so "how many rows did last night's run remove" is in the history and in
no log line that could carry a name.

### 3. The requeue is a repair with its trail

`POST /system/outbox/deliveries/{id}/requeue` runs `requeueDelivery` and the audit entry `system.outbox.requeued` (the delivery id, the
event name, the subscriber, the attempts it had used; the payload of the event is never read) **in one transaction**. If the entry cannot
be written the delivery stays dead (a test). `404` for an unknown or malformed id, `409` for a delivery that is not `dead`; two requests at
once requeue it once (the update locks the row and re-checks the state).

### 4. The CSV export

`GET /audit/export.csv` takes the filters of the list, and needs `core.audit.export`.

- **Columns:** `id, occurred_at, source, action, outcome, actor_kind, user_id, token_id, ip, method, path, status, subject_type,
subject_id, request_id, truncated, query, body, payload`. `query`, `body` and `payload` are compact JSON in one cell (they were
  redacted and capped when written).
- **Order and streaming:** newest first, like the list, read with keyset pagination on `(occurred_at, id)` in batches of 500 and
  written as it is read, so memory does not grow with the result. The file is the trail as it was when the export began: the entry
  written for the export is not in it. The header, the cap and a truncation flag are response headers (`X-Row-Count`, `X-Row-Cap`,
  `X-Truncated`).
- **Cap:** the `csvMaxRows` setting, default 50 000, at most 1 000 000. More matches than the cap are cut off at the cap, and the
  response says so.
- **Quoting and the formula rule:** RFC 4180 (`"` doubled, cells with `,` `"` CR or LF quoted, CRLF line ends). A text cell whose first
  character is `=`, `+`, `-`, `@`, a tab, a carriage return or a line feed gets a leading `'`, whichever column it is in (the trail holds
  text an attacker chose: a path, an action, a subject). Numbers and booleans are written as they are, so `-5` in a numeric column is
  not changed. The writer is in-house (`service/csv.ts`, table-driven tests); no dependency was added.
- **The export is an audit entry** (`audit.exported`: who, the filters, the row count and whether it was capped), written before the first
  byte, plus the request entry of the route with the query string. The CSV carries no BOM; Excel users import it as UTF-8.

### 5. The channels setting

`channels.admin` and `channels.api` (both on by default) switch what is logged: `api` is the request log of the **public API**
(`/api/v1`, M8 onwards; nothing writes it yet); `admin` is everything else: ordinary events, `ctx.audit` entries, and calls of routes on
the internal API. Security-critical events are always logged (ADR-0021, decision 5). Retention follows `source`: `apiRetentionDays` for
the request log, `retentionDays` for events and `ctx.audit` entries.

## Consequences

- One more kernel migration; `listJobRuns` has a `result` field.
- The names of the jobs differ from the plan's short ones; the plan and the README say so.
- A profile that needs outbox retention must include `core.audit`. A profile without it keeps the outbox forever, as before.
