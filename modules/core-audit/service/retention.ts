// Retention (ADR 0021): the daily job that removes old rows and cuts old client addresses, and the two
// jobs that give the kernel's own tables a retention (M4 decision 9). The audit table is append-only:
// each batch below runs in its own transaction that switches on the flag the trigger looks for, with
// `set_config(..., true)`, which is SET LOCAL, so the flag ends with the transaction.
import type { Db, JobResult } from '@scorpion/kernel';
import { deleteDeliveredEvents, deleteJobRuns } from '@scorpion/kernel';
import { sql } from 'drizzle-orm';
import type { AuditSettings } from '../settings-schema.ts';

/** The flag the trigger of `audit_event` checks (migration 0001). */
export const MAINTENANCE_FLAG = 'scorpion.audit_maintenance';
export const BATCH = 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const daysAgo = (now: Date, days: number) => new Date(now.getTime() - days * DAY_MS);

export interface RetentionReport {
  deletedEvents: number;
  deletedApi: number;
  ipTruncated: number;
}

export interface RetentionService {
  /** Deletes rows past `retentionDays` (events) and `apiRetentionDays` (request log) in batches, then cuts old addresses. */
  run(options?: { now?: Date; signal?: AbortSignal }): Promise<RetentionReport & JobResult>;
  /** Kernel: events whose deliveries are all done, past `outboxRetentionDays`. */
  runOutbox(options?: { now?: Date; signal?: AbortSignal }): Promise<{ deleted: number }>;
  /** Kernel: finished job runs past `jobRunRetentionDays`. */
  runJobRuns(options?: { now?: Date; signal?: AbortSignal }): Promise<{ deleted: number }>;
}

export function createRetention(deps: {
  db: Db;
  settings: () => Promise<AuditSettings>;
}): RetentionService {
  const { db } = deps;

  /** Runs one statement with the maintenance flag on; the flag lives for this transaction only. */
  async function withFlag(statement: ReturnType<typeof sql>): Promise<number> {
    return db.tx(async (tx) => {
      await tx.execute(sql`select set_config(${MAINTENANCE_FLAG}, 'on', true)`);
      const result = await tx.execute(statement);
      return result.rowCount ?? 0;
    });
  }

  async function untilShort(step: () => Promise<number>, signal?: AbortSignal): Promise<number> {
    let total = 0;
    for (;;) {
      signal?.throwIfAborted();
      const n = await step();
      total += n;
      if (n < BATCH) return total;
    }
  }

  const deleteOld = (source: 'event' | 'api', cutoff: Date, signal?: AbortSignal) =>
    untilShort(
      () =>
        withFlag(sql`
          with doomed as (
            select id from audit_event
             where source = ${source} and occurred_at < ${cutoff}
             order by occurred_at, id
             limit ${BATCH}
          )
          delete from audit_event a using doomed where a.id = doomed.id`),
      signal,
    );

  /**
   * IPv4 to /24, IPv6 to /48: `203.0.113.7` → `203.0.113.0/24`. Rows already cut contain a `/` and are
   * left alone. The statement changes the `ip` column and nothing else, which is the one UPDATE the
   * trigger lets the flag through. (The sink stores only values `isIP` accepts, so the cast cannot fail.)
   */
  const truncateIps = (cutoff: Date, signal?: AbortSignal) =>
    untilShort(
      () =>
        withFlag(sql`
          with due as (
            select id from audit_event
             where ip is not null and ip not like '%/%' and occurred_at < ${cutoff}
             order by occurred_at, id
             limit ${BATCH}
          )
          update audit_event a
             set ip = network(set_masklen(a.ip::inet, case family(a.ip::inet) when 4 then 24 else 48 end))::text
            from due where a.id = due.id`),
      signal,
    );

  return {
    async run({ now = new Date(), signal } = {}) {
      const s = await deps.settings();
      const deletedEvents = await deleteOld('event', daysAgo(now, s.retentionDays), signal);
      const deletedApi = await deleteOld('api', daysAgo(now, s.apiRetentionDays), signal);
      const ipTruncated = await truncateIps(daysAgo(now, s.ipTruncateAfterDays), signal);
      return { deletedEvents, deletedApi, ipTruncated };
    },

    async runOutbox({ now = new Date(), signal } = {}) {
      const { outboxRetentionDays } = await deps.settings();
      const olderThan = daysAgo(now, outboxRetentionDays);
      return {
        deleted: await untilShort(
          () => deleteDeliveredEvents(db, { olderThan, limit: BATCH }),
          signal,
        ),
      };
    },

    async runJobRuns({ now = new Date(), signal } = {}) {
      const { jobRunRetentionDays } = await deps.settings();
      const olderThan = daysAgo(now, jobRunRetentionDays);
      return {
        deleted: await untilShort(() => deleteJobRuns(db, { olderThan, limit: BATCH }), signal),
      };
    },
  };
}
