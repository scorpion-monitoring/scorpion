// Factories for the table of `core.notifications`. They insert rows directly, so a test can set up
// a delivery in any state without going through the service it is not testing. They know the
// column names: a change to the schema breaks the notifications integration tests, which is the
// point. They need the module's migrations to have run.
import { randomUUID } from 'node:crypto';
import type { Queryable } from './identity.ts';

let sequence = 0;
const next = () => ++sequence;

export interface MakeDelivery {
  template?: string;
  channel?: 'email' | 'webhook';
  /** Default: a unique address for the email channel, none for the webhook. */
  recipientAddress?: string | null;
  recipientUserId?: string | null;
  locale?: string;
  subject?: string;
  textBody?: string | null;
  htmlBody?: string | null;
  sensitive?: boolean;
  status?: 'queued' | 'sending' | 'sent' | 'dead';
  attempts?: number;
  /** Default: now, so a queued row is due. */
  nextAttemptAt?: Date;
  lockedUntil?: Date | null;
  lastError?: string | null;
  sentAt?: Date | null;
  createdAt?: Date;
  transport?: string | null;
}

export interface DeliveryRow {
  id: string;
  template: string;
  channel: string;
  recipient_address: string | null;
  recipient_user_id: string | null;
  locale: string;
  subject: string;
  text_body: string | null;
  html_body: string | null;
  sensitive: boolean;
  status: string;
  status_changed_at: Date;
  attempts: number;
  next_attempt_at: Date;
  locked_until: Date | null;
  last_error: string | null;
  sent_at: Date | null;
  created_at: Date;
  transport: string | null;
}

/** A delivery row, by default a due `queued` email with a unique address and a plain body. */
export async function makeDelivery(
  db: Queryable,
  overrides: MakeDelivery = {},
): Promise<DeliveryRow> {
  const n = next();
  const channel = overrides.channel ?? 'email';
  const { rows } = await db.query<DeliveryRow>(
    `insert into notify_delivery
       (id, template, channel, recipient_address, recipient_user_id, locale, subject, text_body, html_body,
        sensitive, status, attempts, next_attempt_at, locked_until, last_error, sent_at, created_at, transport)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, coalesce($13, now()), $14, $15, $16, coalesce($17, now()), $18)
     returning *`,
    [
      randomUUID(),
      overrides.template ?? 'test.message',
      channel,
      overrides.recipientAddress === undefined
        ? channel === 'email'
          ? `person-${n}@example.org`
          : null
        : overrides.recipientAddress,
      overrides.recipientUserId ?? null,
      overrides.locale ?? 'en',
      overrides.subject ?? `Subject ${n}`,
      overrides.textBody === undefined ? `Body ${n}` : overrides.textBody,
      overrides.htmlBody ?? null,
      overrides.sensitive ?? false,
      overrides.status ?? 'queued',
      overrides.attempts ?? 0,
      overrides.nextAttemptAt ?? null,
      overrides.lockedUntil ?? null,
      overrides.lastError ?? null,
      overrides.sentAt ?? null,
      overrides.createdAt ?? null,
      overrides.transport ?? null,
    ],
  );
  return rows[0]!;
}
