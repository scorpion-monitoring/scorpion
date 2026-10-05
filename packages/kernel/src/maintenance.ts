// Kernel maintenance: the deletes and the one repair the kernel's own tables need (ADR 0003, 0021).
// Plain functions over `Db`, tested against real Postgres. The jobs and routes that call them live in
// `core.audit` (M4 decision 9); the kernel only keeps the SQL next to the tables it belongs to.
import { sql } from 'drizzle-orm';
import type { Db, DbTx } from './db.ts';
import { NOTIFY_CHANNEL } from './outbox.ts';

const MAX_BATCH = 5000;
const clampBatch = (limit: number | undefined) =>
  Math.min(Math.max(Math.trunc(limit ?? 1000), 1), MAX_BATCH);

/**
 * Deletes up to `limit` events that were emitted before `olderThan` and need no further delivery:
 * every delivery is `delivered`, or the event has no subscribers. An event with a `pending` or `dead`
 * delivery stays, so nothing is dropped that a subscriber still has to handle or that an operator
 * has not looked at. The deliveries go with their event (the foreign key cascades). Returns how many
 * events were deleted; call it until it returns less than `limit`.
 *
 * This is also where the usernames of purged accounts leave the outbox: the events of a user carry
 * the name (ADR 0013).
 */
export async function deleteDeliveredEvents(
  db: Db | DbTx,
  options: { olderThan: Date; limit?: number },
): Promise<number> {
  const result = await db.execute(sql`
    with doomed as (
      select o.id from kernel_outbox o
       where o.occurred_at < ${options.olderThan}
         and not exists (
           select 1 from kernel_outbox_delivery d where d.event_id = o.id and d.status <> 'delivered'
         )
       order by o.occurred_at, o.id
       limit ${clampBatch(options.limit)}
    )
    delete from kernel_outbox o using doomed where o.id = doomed.id`);
  return result.rowCount ?? 0;
}

/**
 * Deletes up to `limit` finished job runs (`succeeded` or `failed`) that started before
 * `olderThan`. A `running` row is never deleted: the kernel closes it when its timeout passes.
 */
export async function deleteJobRuns(
  db: Db | DbTx,
  options: { olderThan: Date; limit?: number },
): Promise<number> {
  const result = await db.execute(sql`
    with doomed as (
      select id from kernel_job_run
       where started_at < ${options.olderThan} and status <> 'running'
       order by started_at, id
       limit ${clampBatch(options.limit)}
    )
    delete from kernel_job_run r using doomed where r.id = doomed.id`);
  return result.rowCount ?? 0;
}

export interface RequeuedDelivery {
  deliveryId: string;
  eventId: string;
  eventName: string;
  subscriber: string;
  /** Attempts the delivery had used before it was reset. */
  attempts: number;
}

/**
 * Puts a `dead` delivery back in the queue: `pending`, attempts reset, due now, error cleared, and
 * wakes the dispatcher. Returns `undefined` when there is no such delivery or it is not `dead` (a
 * pending delivery needs no help, a delivered one must not run twice). Run it in the transaction
 * that records why, so the repair and its trail commit together.
 */
export async function requeueDelivery(
  db: Db | DbTx,
  deliveryId: string,
): Promise<RequeuedDelivery | undefined> {
  const { rows } = await db.execute<{
    id: string;
    event_id: string;
    name: string;
    subscriber: string;
    attempts: number;
  }>(sql`
    update kernel_outbox_delivery d
       set status = 'pending', attempts = 0, last_error = null, locked_until = null,
           next_attempt_at = now(), delivered_at = null
      from (
        select d2.id, d2.attempts from kernel_outbox_delivery d2
         where d2.id = ${deliveryId} and d2.status = 'dead' for update
      ) before, kernel_outbox o
     where d.id = before.id and o.id = d.event_id
 returning d.id, d.event_id, o.name, d.subscriber, before.attempts`);
  const row = rows[0];
  if (!row) return undefined;
  await db.execute(sql`select pg_notify(${NOTIFY_CHANNEL}, ${row.event_id})`);
  return {
    deliveryId: row.id,
    eventId: row.event_id,
    eventName: row.name,
    subscriber: row.subscriber,
    attempts: row.attempts,
  };
}
