// The tables of core.notifications. Every name starts with `notify_` (the manifest's `tablePrefix`,
// ADR 0004). Create a migration after a change: `pnpm db:generate --filter @scorpion/core-notifications`.
//
// The module is user-agnostic like core.authz (ADR 0014, 0019): `recipient_user_id` is an opaque id
// with no foreign key to the user table of core.identity, so a purge of a user is never blocked.
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

const timestamptz = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });

/**
 * One message to deliver, and the queue itself (ADR 0020). `status` is a text column; the service
 * moves it along `queued → sending → sent | queued | dead` and checks every move.
 */
export const delivery = pgTable(
  'notify_delivery',
  {
    id: uuid().primaryKey(), // UUIDv7
    /** The template key of the sender, `identity.password-reset`. */
    template: text().notNull(),
    /** `email` or `webhook`. */
    channel: text().notNull(),
    /** Null for the webhook channel, which has one configured target. Never logged. */
    recipientAddress: text('recipient_address'),
    /** An opaque user id, no foreign key (ADR 0019). */
    recipientUserId: uuid('recipient_user_id'),
    locale: text().notNull(),
    subject: text().notNull(),
    /** Null once a sensitive message has reached `sent` or `dead`. */
    textBody: text('text_body'),
    htmlBody: text('html_body'),
    sensitive: boolean().notNull().default(false),
    status: text().notNull().default('queued'),
    statusChangedAt: timestamptz('status_changed_at').notNull().defaultNow(),
    /** Attempts started: counted when a worker claims the row, not when the send finishes. */
    attempts: integer().notNull().default(0),
    nextAttemptAt: timestamptz('next_attempt_at').notNull().defaultNow(),
    /** The lease of the worker that holds the row; `sending` rows past it are claimed again. */
    lockedUntil: timestamptz('locked_until'),
    /** An error code (`ECONNREFUSED`, `http-502`), never a message. */
    lastError: text('last_error'),
    sentAt: timestamptz('sent_at'),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
    /** The id of the transport of the last attempt: `smtp`, `webhook`, `none`. */
    transport: text(),
  },
  (table) => [
    check(
      'notify_delivery_status_check',
      sql`${table.status} in ('queued', 'sending', 'sent', 'dead')`,
    ),
    check('notify_delivery_channel_check', sql`${table.channel} in ('email', 'webhook')`),
    check(
      'notify_delivery_address_check',
      sql`${table.channel} <> 'email' or ${table.recipientAddress} is not null`,
    ),
    // The claim: due `queued` rows, and `sending` rows whose lease ran out.
    index('notify_delivery_due_idx')
      .on(table.nextAttemptAt)
      .where(sql`${table.status} = 'queued'`),
    index('notify_delivery_lease_idx')
      .on(table.lockedUntil)
      .where(sql`${table.status} = 'sending'`),
    // The status list and its counts.
    index('notify_delivery_status_idx').on(table.status, table.createdAt),
  ],
);
