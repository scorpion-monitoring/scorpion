# ADR-0003: Transactional outbox and per-subscriber dispatcher

- Status: Accepted
- Date: 2026-09-30

## Context

Modules talk to each other through domain events (architecture "Jobs, events and external
adapters"). An event must not be lost when the process dies between the commit and the delivery,
and it must not exist when the change that caused it was rolled back. A slow or failing
subscriber must not hold up or repeat deliveries to the others.

## Decision

- **Emit inside the transaction.** `ctx.events.emit(name, payload)` throws unless it runs inside
  `ctx.db.tx()` (the kernel tracks the open transaction with `AsyncLocalStorage`). It validates the
  payload against the schema the emitting module declared in `events.emits` (Zod), then inserts one
  row into `kernel_outbox` and **one row per subscribing module into `kernel_outbox_delivery`**,
  all in the caller's transaction. Rolling back removes them together with the change.
- **Names are versioned**: `service.created@1`. A module may emit only events it declares, and
  event names are unique across the profile. A module may subscribe only to its own events and to
  events of its (required or present optional) dependencies; the loader checks this at startup.
- **At-least-once, per subscriber.** The dispatcher claims due delivery rows and calls the
  subscriber's handler. Success marks the row `delivered`. A failure records the error and
  schedules the next attempt with exponential backoff (5 s, doubling, at most 15 min); after
  `maxAttempts` (8) the row becomes `dead`. Because state is per delivery row, a failing subscriber
  is retried on its own and the others are never called again. Handlers must be idempotent.
  There is no ordering guarantee across retries.
- **Claiming uses a lease, not a long transaction.** One statement selects due rows with
  `FOR UPDATE SKIP LOCKED`, counts the attempt, and sets `locked_until` (5 min). The handler then
  runs outside any transaction. If the process dies mid-handler, the lease expires and the
  delivery is claimed again. Counting the attempt at claim time means an event that crashes the
  process every time still ends `dead` instead of looping.
- **Wake-up by `LISTEN/NOTIFY`, with a polling fallback.** `emit` calls `pg_notify('kernel_outbox')`
  inside the transaction, which Postgres delivers on commit only. The dispatcher holds one
  dedicated listener connection and wakes at once. It also polls (5 s) so that retries that come
  due, missed notifications and a lost listener connection (it reconnects) never stall delivery.
- **A dispatcher that starts late works.** Everything is in tables, so an event committed before
  any dispatcher ran is delivered by whichever process starts one later.
- **Dead deliveries are visible** through the kernel query functions `listDeadDeliveries()` and
  `outboxStats()` (pending, dead, lag). The admin UI that shows them comes in M5; requeueing from
  there is future work.
- `system.ready` is not an outbox event: the kernel calls its handlers in-process once, after the
  services are built. It is unversioned and per process.

## Consequences

- A committed event costs 1 + n inserts (n subscribers) and a `NOTIFY` per event.
- Subscribers added in a later release do not receive events emitted before that release: the
  delivery rows are created at emit time.
- Events with no subscribers stay in `kernel_outbox` until a retention job removes them (backlog).
- Two dispatchers (web process and worker) can run at once; `SKIP LOCKED` and the lease keep them
  apart.
- Webhook delivery to outside systems is not part of M1; it would be one more kind of subscriber
  on the same rows.
