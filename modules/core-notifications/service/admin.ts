// What an administrator does with deliveries (sprint 3): list them without their content, put a dead
// one back in the queue, send a test mail to their own address, and the retention job. Nothing here
// returns, logs or emits a body, an address, a subject or a URL: `deliveryView` has no such field,
// and the events carry ids and template keys only.
import {
  Conflict,
  DomainError,
  Invalid,
  NotFound,
  Unauthorized,
  z,
  type Actor,
  type UserActor,
} from '@scorpion/contracts';
import type { AuthzService } from '@scorpion/core-authz/public';
import type { Db, DbTx, ModuleContext, RateLimiter } from '@scorpion/kernel';
import { and, desc, eq, gte, inArray, lte, sql, type SQL } from 'drizzle-orm';
import { delivery } from '../db/schema.ts';
import type { NotificationSettings } from '../settings-schema.ts';
import { deleteReadInboxItems } from './inbox.ts';
import { TEST_TEMPLATE } from '../templates/system.ts';
import { WAKE_CHANNEL } from './wake.ts';
import type { RecipientAddressEntry } from './recipient-address.ts';

export const PERMISSION_DELIVERIES_READ = 'core.notifications.deliveries.read';
export const PERMISSION_DELIVERIES_MANAGE = 'core.notifications.deliveries.manage';
export const PERMISSION_TEST = 'core.notifications.test';

/** A test mail: 3 at once, then 6 an hour. Per administrator, and the route is in the `strict` group too. */
export const TEST_MAIL_BURST = 3;
export const TEST_MAIL_PER_HOUR = 6;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Rows removed per statement by the retention job. */
const RETENTION_BATCH = 1000;

export const deliveryFilterSchema = z.strictObject({
  status: z.enum(['queued', 'sending', 'sent', 'dead']).optional(),
  template: z.string().min(1).max(100).optional(),
  channel: z.enum(['email', 'webhook']).optional(),
  /** Created at or after. */
  from: z.date().optional(),
  /** Created at or before. */
  to: z.date().optional(),
});
export type DeliveryFilter = z.infer<typeof deliveryFilterSchema>;

/** A delivery as an administrator sees it: metadata only. There is deliberately no field for the content. */
export interface DeliveryView {
  id: string;
  template: string;
  channel: 'email' | 'webhook';
  status: 'queued' | 'sending' | 'sent' | 'dead';
  attempts: number;
  /** An error code, never a message. */
  lastError: string | null;
  transport: string | null;
  sensitive: boolean;
  /** An opaque id, or `null`. */
  recipientUserId: string | null;
  /** False once a sensitive body was removed: such a delivery cannot be requeued. */
  bodyAvailable: boolean;
  createdAt: Date;
  statusChangedAt: Date;
  nextAttemptAt: Date;
  sentAt: Date | null;
}

export interface TestMailResult {
  deliveryId: string;
  /** True when email goes nowhere (transport `none`): the test mail is recorded and dropped. */
  transportIsNone: boolean;
}

export interface RetentionReport {
  deliveries: number;
  inboxItems: number;
}

export interface AdminService {
  /** Needs `core.notifications.deliveries.read`. Newest first (`created_at`, then id). */
  list(
    actor: Actor,
    filter: DeliveryFilter,
    page: { page: number; pageSize: number },
  ): Promise<{ deliveries: DeliveryView[]; total: number }>;
  /**
   * Needs `core.notifications.deliveries.manage`. Only a `dead` delivery whose body is still there:
   * `NotFound` for an unknown id, `Conflict` for any other state and for a body that was removed.
   * Resets the attempts, wakes delivery and emits `notifications.delivery.requeued@1`, in one transaction.
   */
  requeue(actor: Actor, id: string): Promise<DeliveryView>;
  /**
   * Needs `core.notifications.test`. Queues the test mail for the caller's own address, through the
   * transport that is configured. 429 past the budget; `Conflict` when no module can tell an address
   * for the caller. Emits `notifications.settings.tested@1` in the transaction of the mail.
   */
  sendTest(actor: Actor): Promise<TestMailResult>;
  /** The daily job: deletes `sent` and `dead` deliveries past `retentionDays` and read inbox items past `inboxRetentionDays`. */
  runRetention(): Promise<RetentionReport>;
}

export interface AdminDeps {
  db: Db;
  authz: Pick<AuthzService, 'require'>;
  events: ModuleContext['events'];
  limiter: RateLimiter;
  settings: () => Promise<NotificationSettings>;
  /** `enqueueTemplate` of the service, in the caller's transaction. */
  enqueueTemplate: (
    tx: DbTx,
    message: {
      template: string;
      data: unknown;
      recipient: { address?: string; userId?: string };
    },
  ) => Promise<string | null>;
  addresses: readonly RecipientAddressEntry[];
}

const columns = {
  id: delivery.id,
  template: delivery.template,
  channel: delivery.channel,
  status: delivery.status,
  attempts: delivery.attempts,
  lastError: delivery.lastError,
  transport: delivery.transport,
  sensitive: delivery.sensitive,
  recipientUserId: delivery.recipientUserId,
  bodyAvailable: sql<boolean>`${delivery.textBody} is not null`,
  createdAt: delivery.createdAt,
  statusChangedAt: delivery.statusChangedAt,
  nextAttemptAt: delivery.nextAttemptAt,
  sentAt: delivery.sentAt,
};

export function createAdminService(deps: AdminDeps): AdminService {
  const { db, authz } = deps;

  function user(actor: Actor): UserActor {
    if (actor.kind !== 'user') throw new Unauthorized();
    return actor;
  }

  return {
    async list(actor, filter, page) {
      await authz.require(actor, PERMISSION_DELIVERIES_READ);
      const parsed = deliveryFilterSchema.safeParse(filter);
      if (!parsed.success) {
        throw new Invalid(
          'The filter is not valid.',
          parsed.error.issues.map((issue) => ({
            in: 'query',
            path: issue.path.map(String).join('.'),
            message: issue.message,
          })),
        );
      }
      const { status, template, channel, from, to } = parsed.data;
      if (from && to && from > to) {
        throw new Invalid('The filter is not valid.', [
          { in: 'query', path: 'from', message: 'Must not be after "to".' },
        ]);
      }
      const where: SQL | undefined = and(
        status ? eq(delivery.status, status) : undefined,
        template ? eq(delivery.template, template) : undefined,
        channel ? eq(delivery.channel, channel) : undefined,
        from ? gte(delivery.createdAt, from) : undefined,
        to ? lte(delivery.createdAt, to) : undefined,
      );
      const [counted] = await db
        .select({ n: sql<number>`count(*)::int` })
        .from(delivery)
        .where(where);
      const rows = await db
        .select(columns)
        .from(delivery)
        .where(where)
        .orderBy(desc(delivery.createdAt), desc(delivery.id))
        .limit(page.pageSize)
        .offset(page.page * page.pageSize);
      return { deliveries: rows as DeliveryView[], total: counted?.n ?? 0 };
    },

    async requeue(actor, id) {
      await authz.require(actor, PERMISSION_DELIVERIES_MANAGE);
      const { userId } = user(actor);
      if (!UUID.test(id)) throw new NotFound('There is no such delivery.');
      return db.tx(async (tx) => {
        // The row lock makes two parallel requeues one: the second finds it `queued`.
        const [row] = await tx
          .select({
            status: delivery.status,
            template: delivery.template,
            channel: delivery.channel,
            bodyAvailable: sql<boolean>`${delivery.textBody} is not null`,
          })
          .from(delivery)
          .where(eq(delivery.id, id.toLowerCase()))
          .for('update');
        if (!row) throw new NotFound('There is no such delivery.');
        if (row.status !== 'dead') {
          throw new Conflict('Only a dead delivery can be requeued.');
        }
        if (!row.bodyAvailable) {
          // A sensitive body is deleted when the delivery ends (ADR 0019): there is nothing to send.
          throw new Conflict(
            'The content of this delivery was removed when it ended, so it cannot be sent again.',
          );
        }
        // Not a move of the worker's state machine (dead has no way out there): an administrator's decision.
        await tx
          .update(delivery)
          .set({
            status: 'queued',
            attempts: 0,
            nextAttemptAt: sql`now()`,
            lockedUntil: null,
            statusChangedAt: sql`now()`,
          })
          .where(and(eq(delivery.id, id.toLowerCase()), eq(delivery.status, 'dead')));
        await tx.execute(sql`select pg_notify(${WAKE_CHANNEL}, ${id.toLowerCase()})`);
        await deps.events.emit('notifications.delivery.requeued@1', {
          deliveryId: id.toLowerCase(),
          template: row.template,
          channel: row.channel,
          requestedBy: userId,
        });
        const [after] = await tx
          .select(columns)
          .from(delivery)
          .where(eq(delivery.id, id.toLowerCase()));
        return after as DeliveryView;
      });
    },

    async sendTest(actor) {
      await authz.require(actor, PERMISSION_TEST);
      const { userId } = user(actor);
      const decision = await deps.limiter.consume(`notify.test:${userId}`, {
        capacity: TEST_MAIL_BURST,
        refillPerSecond: TEST_MAIL_PER_HOUR / 3600,
      });
      if (!decision.allowed) {
        throw new DomainError(
          429,
          'Too Many Requests',
          `Too many test mails. Try again in ${decision.retryAfterSeconds} seconds.`,
        );
      }
      let address: string | null = null;
      for (const entry of deps.addresses) {
        address = await entry.addressOf(userId);
        if (address) break;
      }
      if (!address) {
        throw new Conflict('Your account has no email address to send the test mail to.');
      }
      const settings = await deps.settings();
      const deliveryId = await db.tx(async (tx) => {
        const queued = await deps.enqueueTemplate(tx, {
          template: TEST_TEMPLATE,
          data: {},
          recipient: { address, userId },
        });
        if (!queued) throw new Conflict('The test mail could not be queued.');
        await deps.events.emit('notifications.settings.tested@1', {
          deliveryId: queued,
          template: TEST_TEMPLATE,
          requestedBy: userId,
        });
        return queued;
      });
      return { deliveryId, transportIsNone: settings.emailTransport === 'none' };
    },

    async runRetention() {
      const settings = await deps.settings();
      let removed = 0;
      for (;;) {
        const old = await db
          .select({ id: delivery.id })
          .from(delivery)
          .where(
            and(
              inArray(delivery.status, ['sent', 'dead']),
              sql`${delivery.statusChangedAt} < now() - ${settings.retentionDays}::int * interval '1 day'`,
            ),
          )
          .limit(RETENTION_BATCH);
        if (old.length === 0) break;
        await db.delete(delivery).where(
          inArray(
            delivery.id,
            old.map((row) => row.id),
          ),
        );
        removed += old.length;
        if (old.length < RETENTION_BATCH) break;
      }
      const inboxItems = await deleteReadInboxItems(db, settings.inboxRetentionDays);
      return { deliveries: removed, inboxItems };
    },
  };
}
