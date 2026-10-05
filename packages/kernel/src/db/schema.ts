// The kernel's own tables. Every name starts with `kernel_` (ADR 0004). Migrations for this file
// live in packages/kernel/migrations; create one with `pnpm db:generate --filter @scorpion/kernel`.
import {
  boolean,
  check,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

const timestamptz = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });

/** Domain events, written in the same transaction as the change that caused them. */
export const outbox = pgTable(
  'kernel_outbox',
  {
    id: uuid().primaryKey(),
    /** Versioned name, `service.created@1`. */
    name: text().notNull(),
    /** Id of the module that emitted the event. */
    emitter: text().notNull(),
    payload: jsonb().notNull(),
    occurredAt: timestamptz('occurred_at').notNull().defaultNow(),
  },
  (table) => [index('kernel_outbox_occurred_at_idx').on(table.occurredAt)],
);

/**
 * One row per event and subscribing module. The dispatcher works on these rows, so a failing
 * subscriber is retried without touching the deliveries of the others.
 */
export const outboxDelivery = pgTable(
  'kernel_outbox_delivery',
  {
    id: uuid().primaryKey(),
    eventId: uuid('event_id')
      .notNull()
      .references(() => outbox.id, { onDelete: 'cascade' }),
    /** Id of the subscribing module. */
    subscriber: text().notNull(),
    /** `pending` until delivered, then `delivered`; `dead` after the last failed attempt. */
    status: text().notNull().default('pending'),
    attempts: integer().notNull().default(0),
    /** When the next attempt is due; for a `dead` delivery, when it was given up. */
    nextAttemptAt: timestamptz('next_attempt_at').notNull().defaultNow(),
    /** While a dispatcher works on the delivery, no other picks it up before this time. */
    lockedUntil: timestamptz('locked_until'),
    lastError: text('last_error'),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
    deliveredAt: timestamptz('delivered_at'),
  },
  (table) => [
    uniqueIndex('kernel_outbox_delivery_event_subscriber_idx').on(table.eventId, table.subscriber),
    index('kernel_outbox_delivery_due_idx').on(table.status, table.nextAttemptAt),
    check(
      'kernel_outbox_delivery_status_check',
      sql`${table.status} in ('pending', 'delivered', 'dead')`,
    ),
  ],
);

/** History of job runs: one row per attempt, written by the kernel around every handler. */
export const jobRun = pgTable(
  'kernel_job_run',
  {
    id: uuid().primaryKey(),
    /** Full job name, `kpi.ingestion.reminder`. */
    jobName: text('job_name').notNull(),
    /** Id of the module that declares the job. */
    module: text().notNull(),
    /** The pg-boss job id; the attempts of one job share it. */
    jobId: text('job_id').notNull(),
    /** 1 for the first attempt. */
    attempt: integer().notNull(),
    /** `running`, then `succeeded` or `failed`. */
    status: text().notNull().default('running'),
    /** How long the handler may run; a `running` row older than this belongs to a dead process. */
    timeoutSeconds: integer('timeout_seconds').notNull(),
    startedAt: timestamptz('started_at').notNull().defaultNow(),
    finishedAt: timestamptz('finished_at'),
    durationMs: integer('duration_ms'),
    error: text(),
    /** What the handler returned: counts and flags (`JobResult`), e.g. rows a retention job removed. */
    result: jsonb(),
  },
  (table) => [
    index('kernel_job_run_job_started_idx').on(table.jobName, table.startedAt),
    index('kernel_job_run_started_idx').on(table.startedAt),
    check(
      'kernel_job_run_status_check',
      sql`${table.status} in ('running', 'succeeded', 'failed')`,
    ),
  ],
);

/**
 * Token buckets of the rate limiter, one row per key (`ip:<group>:<address>`). The bucket holds
 * `tokens` as of `updated_at`; it refills continuously, so nothing has to run to top it up. Rows
 * that have not been touched for a day are full again and are pruned.
 */
export const rateBucket = pgTable(
  'kernel_rate_bucket',
  {
    key: text().primaryKey(),
    tokens: doublePrecision().notNull(),
    /** Whether the last request that touched the bucket took a token. */
    allowed: boolean().notNull(),
    updatedAt: timestamptz('updated_at').notNull().defaultNow(),
  },
  (table) => [index('kernel_rate_bucket_updated_at_idx').on(table.updatedAt)],
);
