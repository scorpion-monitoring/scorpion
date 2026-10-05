# ADR-0020: Delivery queue in a table, with job wake-up

- Status: Accepted
- Date: 2026-10-05

## Context

A mail must be stored in the transaction of the work that causes it, sent outside any transaction, retried when the relay is
down and visible to an operator. pg-boss jobs are sent on their own connection (`ctx.jobs.enqueue` calls `boss.send`, which
does not join the caller's transaction; checked in `packages/kernel/src/jobs.ts`), so a job cannot be the queue: it
would exist when the work was rolled back, or not exist when the process died between commit and `send`.

## Decision

- **The table `notify_delivery` is the queue and the source of truth.** `enqueue(tx, message)` inserts a row (`status =
  'queued'`, `next_attempt_at = now()`) and calls `pg_notify('notify_delivery', <id>)` in the same transaction. A job is
  only a way to wake a worker; losing every wake-up delays delivery and loses nothing.
- **Status is a text column with a state machine in the service**, every move one `UPDATE … WHERE status = <from>`: `queued →
  sending` (claim), `sending → sent`, `sending → queued` (retry, with `next_attempt_at`), `sending → dead`. Nothing else moves a
  row in sprint 1 (a `dead → queued` requeue is sprint 3). `status_changed_at` is set by every move. A pg enum was
  rejected (CLAUDE.md rule 8 spirit; a text check is easier to extend).
- **Claiming is one statement with a lease**, as in ADR-0003: select due rows (`queued` and due, or `sending` with an expired
  lease) `FOR UPDATE SKIP LOCKED`, set `status = 'sending'`, `locked_until = now() + 5 min` and **`attempts = attempts + 1`**.
  The send runs outside any transaction. Counting at claim time means a message whose send kills the process every time still
  ends `dead`. Finishing a row is `UPDATE … WHERE id = $1 AND status = 'sending' AND attempts = $2`: a worker whose lease was
  taken over writes nothing. Two workers cannot send the same row at once; the lease bounds a crashed worker.
- **Backoff** after failed attempt `n`: `min(30 s · 2^(n-1), 1 h)`. After attempt `maxAttempts` (setting, default 8) the row is
  `dead` with the last error code. A failing row never blocks others: each row is claimed, sent and finished on its own, and
  a pass loops until nothing is due.
- **Wake-up has three sources.** (1) `pg_notify`: the module holds one `LISTEN` connection per process (the kernel's listener
  is the outbox's and offers modules no hook) and, when it hears the channel, enqueues the job `core.notifications.deliver`
  through `ctx.jobs.enqueue`, coalescing bursts. `NOTIFY` is delivered only on commit, so a rolled-back message wakes nobody.
  (2) That `ctx.jobs.enqueue` call, which happens after the commit by construction. (3) A cron sweep every minute (the job's own
  schedule), which also delivers retries that came due and covers a lost listener or a down queue.
- **The job name is `core.notifications.deliver`**, not `notify.deliver`: the manifest rule requires job names to start with the
  module id.
- **Transports are a registry**, `notify.transport`: `{ id, channel, create(input) }` where `create` builds a `Transport` with
  `send(message)`. Entries: `smtp`, `webhook`, `none`. The service keeps one built transport per id and rebuilds it when the
  settings or a notification secret change in this process (`settings.changed@1`, `settings.secret.changed@1`) and
  when it is older than the settings port's 5 s TTL (ADR-0017), which is the bound for a change made in another process.
- **Webhook target protection.** The host is resolved once; every address must be public (loopback, private, link-local,
  unique-local, multicast, reserved, cloud-metadata and the IPv4 forms inside IPv6 are refused); the connection goes to that
  address through a custom `lookup`, with SNI and `Host` of the original name; redirects are not followed (a 3xx is a
  failure), the response is read up to a cap and then dropped, and the whole call has a 5 s timeout. A name that resolves to a
  public and a private address is refused. `allowPrivateTargets` lifts only the range check; it also permits `http://`
  (an internal relay), which is otherwise refused so a signed body is not sent in clear to a public host.
  Node's `http`/`https` are used instead of `fetch` because `fetch` cannot be pinned to a resolved address without a new
  dependency.
- **No message text in the table's error column, in logs or in events**: `last_error` is a code such as `ECONNREFUSED`,
  `timeout`, `redirect`, `http-502`, `target-refused` or `send-failed`.

## Consequences

- Delivery latency is at most one job poll (2 s) after a commit, and at most a minute when a wake-up is lost.
- Every process with a listener may enqueue a wake-up job for one commit; the extra runs find nothing due and end quickly.
- The module opens one extra Postgres connection per process for `LISTEN`. It has no shutdown hook from the kernel yet; the
  service exposes `close()` for tests and the connection ends with the process (backlog: a module stop hook).
- A retention job for delivered rows (`retentionDays`) and requeueing a dead row come in sprint 3.
