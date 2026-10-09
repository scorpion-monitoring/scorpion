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
  /** Default: now. The retention job counts from here. */
  statusChangedAt?: Date;
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
        sensitive, status, attempts, next_attempt_at, locked_until, last_error, sent_at, created_at, transport, status_changed_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, coalesce($13, now()), $14, $15, $16, coalesce($17, now()), $18, coalesce($19, now()))
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
      overrides.statusChangedAt ?? null,
    ],
  );
  return rows[0]!;
}

export interface MakeInboxItem {
  /** Default: a new random user id. */
  userId?: string;
  template?: string;
  title?: string;
  text?: string;
  link?: string | null;
  /** Default: now. */
  createdAt?: Date;
  readAt?: Date | null;
}

export interface InboxItemRow {
  id: string;
  user_id: string;
  template: string;
  title: string;
  text: string;
  link: string | null;
  created_at: Date;
  read_at: Date | null;
}

/** An inbox item, by default unread, for a random user. */
export async function makeInboxItem(
  db: Queryable,
  overrides: MakeInboxItem = {},
): Promise<InboxItemRow> {
  const n = next();
  const { rows } = await db.query<InboxItemRow>(
    `insert into notify_inbox_item (id, user_id, template, title, text, link, created_at, read_at)
     values ($1, $2, $3, $4, $5, $6, coalesce($7, now()), $8)
     returning *`,
    [
      randomUUID(),
      overrides.userId ?? randomUUID(),
      overrides.template ?? 'test.message',
      overrides.title ?? `Title ${n}`,
      overrides.text ?? `Text ${n}`,
      overrides.link ?? null,
      overrides.createdAt ?? null,
      overrides.readAt ?? null,
    ],
  );
  return rows[0]!;
}

// What a test sees of the mail a module queued, read straight from the table (no worker runs, so a
// `queued` mail still has its body).
/** A mail as core.notifications stored it. */
export interface QueuedMail {
  /** The template key: `identity.password-reset`. */
  template: string;
  to: string;
  subject: string;
  text: string;
  html: string;
  locale: string;
  sensitive: boolean;
  status: string;
  userId: string | null;
}

export interface Mailbox {
  /** Every mail queued so far, oldest first. */
  all(): Promise<QueuedMail[]>;
  /** The queued mails of one template key (or all), oldest first. */
  of(template: string): Promise<QueuedMail[]>;
  /** The recipients of every queued mail, in order. */
  recipients(): Promise<string[]>;
  /** The template keys of every queued mail, in order. */
  templates(): Promise<string[]>;
  /** Forgets what was queued, so a test can look at what the next step adds. */
  clear(): Promise<void>;
}

type Row = {
  template: string;
  recipient_address: string;
  subject: string;
  text_body: string | null;
  html_body: string | null;
  locale: string;
  sensitive: boolean;
  status: string;
  recipient_user_id: string | null;
};

export function mailbox(pool: Queryable): Mailbox {
  const all = async (): Promise<QueuedMail[]> =>
    (
      await pool.query<Row>(
        'select template, recipient_address, subject, text_body, html_body, locale, sensitive, status, recipient_user_id from notify_delivery order by created_at, id',
      )
    ).rows.map((row) => ({
      template: row.template,
      to: row.recipient_address,
      subject: row.subject,
      text: row.text_body ?? '',
      html: row.html_body ?? '',
      locale: row.locale,
      sensitive: row.sensitive,
      status: row.status,
      userId: row.recipient_user_id,
    }));
  return {
    all,
    of: async (template) => (await all()).filter((mail) => mail.template === template),
    recipients: async () => (await all()).map((mail) => mail.to),
    templates: async () => (await all()).map((mail) => mail.template),
    clear: async () => void (await pool.query('delete from notify_delivery')),
  };
}

/** The mail queue as stored, oldest first (column names as in the table), for a test that reads who was mailed what. */
export async function deliveryRows(db: Queryable) {
  const { rows } = await db.query<{
    template: string;
    recipient_address: string | null;
    recipient_user_id: string | null;
    locale: string;
    subject: string;
    text_body: string | null;
  }>(
    `select template, recipient_address, recipient_user_id, locale, subject, text_body
       from notify_delivery order by created_at, id`,
  );
  return rows;
}

/** The inbox items as stored, oldest first. */
export async function inboxRows(db: Queryable) {
  const { rows } = await db.query<{
    user_id: string;
    template: string;
    title: string;
    text: string;
    link: string | null;
  }>('select user_id, template, title, text, link from notify_inbox_item order by created_at, id');
  return rows;
}

/** Makes the mail queue refuse an insert, so a mail cannot be stored. Returns the undo. */
export async function breakDeliveries(db: Queryable) {
  await db.query(`
    create or replace function test_break_deliveries() returns trigger as $$
    begin raise exception 'the mail queue is broken for this test'; end $$ language plpgsql;
    create trigger test_break_deliveries before insert on notify_delivery
      for each row execute function test_break_deliveries();`);
  return () => db.query('drop trigger test_break_deliveries on notify_delivery');
}

/** Makes the inbox refuse an insert (an item is a second write after the mail). Returns the undo. */
export async function breakInbox(db: Queryable) {
  await db.query(`
    create or replace function test_break_inbox() returns trigger as $$
    begin raise exception 'the inbox is broken for this test'; end $$ language plpgsql;
    create trigger test_break_inbox before insert on notify_inbox_item
      for each row execute function test_break_inbox();`);
  return () => db.query('drop trigger test_break_inbox on notify_inbox_item');
}
