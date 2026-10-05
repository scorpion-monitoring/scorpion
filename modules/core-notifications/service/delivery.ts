// The queue operations on `notify_delivery` (ADR 0020): claim with a lease, and the four moves of
// the status machine. Every move is one `UPDATE … WHERE status = <from>`, so two workers cannot
// both finish a row, and a worker whose lease was taken over (the attempt number moved on) writes
// nothing. Nothing here logs: the caller logs ids and codes only.
import type { Db } from '@scorpion/kernel';
import { and, eq, sql } from 'drizzle-orm';
import type { PgUpdateSetSource } from 'drizzle-orm/pg-core';
import { delivery } from '../db/schema.ts';

export type DeliveryStatus = 'queued' | 'sending' | 'sent' | 'dead';

/** The state machine. A row moves along these edges and no others. */
export const TRANSITIONS: Readonly<Record<DeliveryStatus, readonly DeliveryStatus[]>> = {
  queued: ['sending'],
  sending: ['sent', 'queued', 'dead'],
  sent: [],
  dead: [],
};

export function canMove(from: DeliveryStatus, to: DeliveryStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

/** How long a worker holds a claimed row before another may take it. */
export const LEASE_SECONDS = 300;

export interface ClaimedDelivery {
  id: string;
  template: string;
  channel: 'email' | 'webhook';
  recipientAddress: string | null;
  locale: string;
  subject: string;
  textBody: string | null;
  htmlBody: string | null;
  sensitive: boolean;
  /** Counted when the row was claimed: 1 for the first attempt. */
  attempts: number;
  createdAt: Date;
}

type ClaimRow = {
  id: string;
  template: string;
  channel: 'email' | 'webhook';
  recipient_address: string | null;
  locale: string;
  subject: string;
  text_body: string | null;
  html_body: string | null;
  sensitive: boolean;
  attempts: number;
  /** Drizzle's raw `execute` hands timestamps back as the driver's text, so this is converted below. */
  created_at: Date | string;
};

/**
 * Takes up to `limit` due rows: `queued` rows whose time has come and `sending` rows whose lease
 * ran out (their worker died). One statement: the attempt is counted and the lease set at claim
 * time, so a message that kills its worker every time still ends `dead`. `SKIP LOCKED` lets
 * workers claim different rows at once.
 */
export async function claimDue(db: Db, limit: number): Promise<ClaimedDelivery[]> {
  const result = await db.execute<ClaimRow>(sql`
    with due as (
      select id from notify_delivery
       where (status = 'queued' and next_attempt_at <= now())
          or (status = 'sending' and locked_until < now())
       order by next_attempt_at
       limit ${limit}
         for update skip locked)
    update notify_delivery d
       set status = 'sending',
           attempts = d.attempts + 1,
           locked_until = now() + ${LEASE_SECONDS}::int * interval '1 second',
           status_changed_at = now()
      from due
     where d.id = due.id
    returning d.id, d.template, d.channel, d.recipient_address, d.locale, d.subject,
              d.text_body, d.html_body, d.sensitive, d.attempts, d.created_at`);
  return result.rows.map((row) => ({
    id: row.id,
    template: row.template,
    channel: row.channel,
    recipientAddress: row.recipient_address,
    locale: row.locale,
    subject: row.subject,
    textBody: row.text_body,
    htmlBody: row.html_body,
    sensitive: row.sensitive,
    attempts: row.attempts,
    createdAt: new Date(row.created_at),
  }));
}

// A sensitive message loses its rendered body in the same statement that ends it (ADR 0019).
const scrubbed = {
  textBody: sql`case when ${delivery.sensitive} then null else ${delivery.textBody} end`,
  htmlBody: sql`case when ${delivery.sensitive} then null else ${delivery.htmlBody} end`,
};

const ownedClaim = (id: string, attempts: number) =>
  and(eq(delivery.id, id), eq(delivery.status, 'sending'), eq(delivery.attempts, attempts));

/** Moves a claimed row out of `sending`, if it is still this worker's. The edge is checked against `TRANSITIONS`. */
async function move(
  db: Db,
  row: ClaimedDelivery,
  to: Exclude<DeliveryStatus, 'sending'>,
  set: PgUpdateSetSource<typeof delivery>,
): Promise<boolean> {
  if (!canMove('sending', to)) throw new Error(`notify_delivery cannot move from sending to ${to}`);
  const moved = await db
    .update(delivery)
    .set({ status: to, statusChangedAt: sql`now()`, lockedUntil: null, ...set })
    .where(ownedClaim(row.id, row.attempts))
    .returning({ id: delivery.id });
  return moved.length === 1;
}

/**
 * `sending → sent`. Returns false when the row is no longer this worker's (its lease ran out and
 * another worker took it): the caller then logs it and writes nothing.
 */
export function markSent(db: Db, row: ClaimedDelivery, transport: string): Promise<boolean> {
  return move(db, row, 'sent', { sentAt: sql`now()`, transport, ...scrubbed });
}

/** `sending → queued`, due again after `delaySeconds`. */
export function markRetry(
  db: Db,
  row: ClaimedDelivery,
  failure: { code: string; delaySeconds: number; transport: string | null },
): Promise<boolean> {
  return move(db, row, 'queued', {
    nextAttemptAt: sql`now() + ${failure.delaySeconds}::int * interval '1 second'`,
    lastError: failure.code,
    transport: failure.transport,
  });
}

/** `sending → dead`: no more attempts. The code stays, a sensitive body goes. */
export function markDead(
  db: Db,
  row: ClaimedDelivery,
  failure: { code: string; transport: string | null },
): Promise<boolean> {
  return move(db, row, 'dead', {
    lastError: failure.code,
    transport: failure.transport,
    ...scrubbed,
  });
}
