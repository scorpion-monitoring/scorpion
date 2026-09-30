// The kernel's own tables. Every name starts with `kernel_` (ADR 0004). Migrations for this file
// live in packages/kernel/migrations; create one with `pnpm db:generate --filter @scorpion/kernel`.
import {
  check,
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
