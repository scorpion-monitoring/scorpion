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

export interface JobRunRow {
  id: string;
  jobName: string;
  module: string;
  jobId: string;
  attempt: number;
  status: 'running' | 'succeeded' | 'failed';
  startedAt: Date;
  finishedAt: Date | null;
  durationMs: number | null;
  error: string | null;
}

export interface JobRunFilter {
  jobName?: string;
  status?: JobRunRow['status'];
  limit?: number;
  offset?: number;
}

/** The history of job runs, newest first. */
export async function listJobRuns(db: Db, filter: JobRunFilter = {}): Promise<JobRunRow[]> {
  const limit = Math.min(Math.max(filter.limit ?? 100, 1), 1000);
  const offset = Math.max(filter.offset ?? 0, 0);
  const { rows } = await db.execute<{
    id: string;
    job_name: string;
    module: string;
    job_id: string;
    attempt: number;
    status: JobRunRow['status'];
    started_at: Date;
    finished_at: Date | null;
    duration_ms: number | null;
    error: string | null;
  }>(sql`
    select id, job_name, module, job_id, attempt, status, started_at, finished_at, duration_ms, error
      from kernel_job_run
     where (${filter.jobName ?? null}::text is null or job_name = ${filter.jobName ?? null})
       and (${filter.status ?? null}::text is null or status = ${filter.status ?? null})
     order by started_at desc, id desc
     limit ${limit} offset ${offset}`);
  return rows.map((row) => ({
    id: row.id,
    jobName: row.job_name,
    module: row.module,
    jobId: row.job_id,
    attempt: row.attempt,
    status: row.status,
    startedAt: new Date(row.started_at),
    finishedAt: row.finished_at ? new Date(row.finished_at) : null,
    durationMs: row.duration_ms,
    error: row.error,
  }));
}
