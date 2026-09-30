// Kernel query functions: read-only views of the kernel's tables, for the admin UI (M5) and
// the metrics. Plain functions over `Db`, tested against real Postgres.
import { sql } from 'drizzle-orm';
import type { Db } from './db.ts';

export interface DeadDelivery {
  deliveryId: string;
  eventId: string;
  eventName: string;
  subscriber: string;
  attempts: number;
  lastError: string | null;
  occurredAt: Date;
  failedAt: Date;
}

/** Deliveries that ran out of attempts, newest first. */
export async function listDeadDeliveries(
  db: Db,
  options: { limit?: number } = {},
): Promise<DeadDelivery[]> {
  const limit = Math.min(Math.max(options.limit ?? 100, 1), 1000);
  const { rows } = await db.execute<{
    id: string;
    event_id: string;
    name: string;
    subscriber: string;
    attempts: number;
    last_error: string | null;
    occurred_at: Date;
    next_attempt_at: Date;
  }>(sql`
    select d.id, d.event_id, o.name, d.subscriber, d.attempts, d.last_error, o.occurred_at, d.next_attempt_at
      from kernel_outbox_delivery d join kernel_outbox o on o.id = d.event_id
     where d.status = 'dead'
     order by o.occurred_at desc, d.id desc
     limit ${limit}`);
  return rows.map((row) => ({
    deliveryId: row.id,
    eventId: row.event_id,
    eventName: row.name,
    subscriber: row.subscriber,
    attempts: row.attempts,
    lastError: row.last_error,
    occurredAt: new Date(row.occurred_at),
    failedAt: new Date(row.next_attempt_at),
  }));
}

export interface OutboxStats {
  pending: number;
  dead: number;
  /** Seconds since the oldest pending delivery was created; 0 when nothing waits. */
  lagSeconds: number;
}

export async function outboxStats(db: Db): Promise<OutboxStats> {
  const { rows } = await db.execute<{ pending: string; dead: string; lag: string | null }>(sql`
    select count(*) filter (where status = 'pending') as pending,
           count(*) filter (where status = 'dead') as dead,
           extract(epoch from now() - min(created_at) filter (where status = 'pending')) as lag
      from kernel_outbox_delivery`);
  const row = rows[0]!;
  return {
    pending: Number(row.pending),
    dead: Number(row.dead),
    lagSeconds: Math.max(Number(row.lag ?? 0), 0),
  };
}
