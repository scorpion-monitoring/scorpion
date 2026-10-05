// The notifications service: `enqueue` for trusted callers, `status` for administrators, and the
// delivery pass that the job `core.notifications.deliver` runs (ADR 0019, 0020).
import type { Actor } from '@scorpion/contracts';
import type { AuthzService } from '@scorpion/core-authz/public';
import type { SettingsService } from '@scorpion/core-settings/public';
import { activeTransaction, ids, type DbTx, type ModuleContext } from '@scorpion/kernel';
import { desc, max, sql } from 'drizzle-orm';
import { delivery } from '../db/schema.ts';
import type { NotificationStatus, NotificationsService } from '../public.ts';
import type { NotificationSettings } from '../settings-schema.ts';
import { backoffSeconds } from './backoff.ts';
import { claimDue, markDead, markRetry, markSent, type ClaimedDelivery } from './delivery.ts';
import { parseMessage, type NotificationMessage } from './message.ts';
import type { TransportCache } from './transport-cache.ts';
import { failureCode, TransportError, type OutgoingMessage } from './transports/types.ts';
import { WAKE_CHANNEL } from './wake.ts';

export const PERMISSION_STATUS_READ = 'core.notifications.status.read';

/** Rows claimed in one statement. */
const CLAIM_BATCH = 10;
/** A pass stops claiming after this long, so it ends inside the job's own timeout. */
const PASS_BUDGET_MS = 240_000;

/** Raised when `enqueue` is called outside `ctx.db.tx()`: a programming error, never a user's. */
export class NotificationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NotificationError';
  }
}

export interface DeliveryPassReport {
  claimed: number;
  sent: number;
  retried: number;
  dead: number;
  /** Rows another worker took over while this one was sending: nothing was written for them. */
  lost: number;
}

export interface NotificationsInternals extends NotificationsService {
  /** One pass of the delivery job: claims due rows and sends them until nothing is due. */
  deliverDue(options?: { signal?: AbortSignal; budgetMs?: number }): Promise<DeliveryPassReport>;
  /** Forget the built transports (a setting or a notification secret changed). */
  invalidateTransports(): void;
  /** Stops the wake-up listener and releases the transports (tests; the process ends them otherwise). */
  close(): Promise<void>;
}

export interface NotificationsDeps {
  authz: AuthzService;
  settingsService: Pick<SettingsService, 'getBranding'>;
  transports: TransportCache;
}

export function createNotificationsService(
  ctx: ModuleContext<'core.authz' | 'core.settings', never, NotificationSettings>,
  deps: NotificationsDeps,
): NotificationsInternals {
  const { authz, transports } = deps;
  const { db, log } = ctx;

  async function process(
    row: ClaimedDelivery,
    settings: NotificationSettings,
    from: string,
    signal: AbortSignal | undefined,
    report: DeliveryPassReport,
  ): Promise<void> {
    // Which transport carries the message: the email transport of the settings, or the webhook.
    const transportId = row.channel === 'webhook' ? 'webhook' : settings.emailTransport;
    let outcome: { ok: true } | { ok: false; code: string };
    if (row.attempts > settings.maxAttempts) {
      // Only reachable when workers died with the row (the attempt is counted at claim) or the
      // limit was lowered: do not send again.
      outcome = { ok: false, code: 'attempts-exhausted' };
    } else {
      try {
        const transport = await transports.get(transportId);
        const message: OutgoingMessage = {
          id: row.id,
          template: row.template,
          channel: row.channel,
          to: row.recipientAddress,
          from,
          subject: row.subject,
          text: row.textBody ?? '',
          html: row.htmlBody,
          locale: row.locale,
          createdAt: row.createdAt,
        };
        await transport.send(message, { signal });
        outcome = { ok: true };
      } catch (error) {
        outcome = { ok: false, code: failureCode(error) };
        if (error instanceof TransportError && error.code === 'unknown-transport') {
          log.error({ transport: transportId }, 'no transport is registered under this id');
        }
      }
    }

    // Everything below writes to the table; a failure here leaves the row `sending` and its lease
    // runs out, which is the recovery for a crash too.
    const base = { deliveryId: row.id, channel: row.channel, attempt: row.attempts };
    if (outcome.ok) {
      if (await markSent(db, row, transportId)) {
        report.sent += 1;
      } else {
        report.lost += 1;
        log.warn(base, 'a delivery was taken over by another worker while it was being sent');
      }
      return;
    }
    const exhausted = row.attempts >= settings.maxAttempts;
    const written = exhausted
      ? await markDead(db, row, { code: outcome.code, transport: transportId })
      : await markRetry(db, row, {
          code: outcome.code,
          delaySeconds: backoffSeconds(row.attempts),
          transport: transportId,
        });
    if (!written) {
      report.lost += 1;
      log.warn(base, 'a delivery was taken over by another worker while it was being sent');
    } else if (exhausted) {
      report.dead += 1;
      log.warn({ ...base, code: outcome.code }, 'a delivery failed for the last time and is dead');
    } else {
      report.retried += 1;
      log.info({ ...base, code: outcome.code }, 'a delivery failed and will be tried again');
    }
  }

  return {
    async enqueue(tx: DbTx, input: NotificationMessage): Promise<string | null> {
      // Like `ctx.events.emit` (ADR 0003): the row commits with the change, or not at all.
      if (!activeTransaction()) {
        throw new NotificationError(
          'core.notifications: enqueue() must be called inside ctx.db.tx(), so the message commits with the change',
        );
      }
      const message = parseMessage(input);
      const settings = await ctx.settings.get();
      // The webhook is an optional mirror: with it off there is nothing to deliver and nothing to fail.
      if (message.channel === 'webhook' && !settings.webhook.enabled) return null;
      const id = ids.uuidv7();
      await tx.insert(delivery).values({
        id,
        template: message.template,
        channel: message.channel,
        recipientAddress: message.channel === 'email' ? (message.recipientAddress ?? null) : null,
        recipientUserId: message.recipientUserId ?? null,
        locale: message.locale ?? settings.defaultLocale,
        subject: message.subject,
        textBody: message.text,
        htmlBody: message.html ?? null,
        sensitive: message.sensitive,
      });
      // Delivered on commit and never on rollback; the payload is the id only.
      await tx.execute(sql`select pg_notify(${WAKE_CHANNEL}, ${id})`);
      return id;
    },

    async status(actor: Actor): Promise<NotificationStatus> {
      await authz.require(actor, PERMISSION_STATUS_READ);
      const settings = await ctx.settings.get();
      const counted = await db
        .select({ status: delivery.status, n: sql<number>`count(*)::int` })
        .from(delivery)
        .groupBy(delivery.status);
      const counts = { queued: 0, sending: 0, sent: 0, dead: 0 };
      for (const row of counted) counts[row.status as keyof typeof counts] = row.n;
      const errors = await db
        .select({
          code: delivery.lastError,
          count: sql<number>`count(*)::int`,
          lastAt: max(delivery.statusChangedAt),
        })
        .from(delivery)
        .where(
          sql`${delivery.lastError} is not null and ${delivery.statusChangedAt} > now() - interval '7 days'`,
        )
        .groupBy(delivery.lastError)
        .orderBy(desc(max(delivery.statusChangedAt)))
        .limit(10);
      return {
        emailTransport: settings.emailTransport,
        transportIsNone: settings.emailTransport === 'none',
        webhookEnabled: settings.webhook.enabled,
        counts,
        lastErrors: errors.map((row) => ({
          code: row.code ?? 'unknown',
          count: row.count,
          lastAt: row.lastAt ?? new Date(0),
        })),
      };
    },

    async deliverDue(options = {}) {
      const report: DeliveryPassReport = { claimed: 0, sent: 0, retried: 0, dead: 0, lost: 0 };
      const deadline = Date.now() + (options.budgetMs ?? PASS_BUDGET_MS);
      const settings = await ctx.settings.get();
      const from = (await deps.settingsService.getBranding()).mailFrom;
      while (!options.signal?.aborted && Date.now() < deadline) {
        const rows = await claimDue(db, CLAIM_BATCH);
        if (rows.length === 0) break;
        report.claimed += rows.length;
        // Each row is sent and finished on its own: a failing relay or one bad row blocks no other.
        await Promise.all(
          rows.map((row) =>
            process(row, settings, from, options.signal, report).catch((err: unknown) => {
              log.error(
                { deliveryId: row.id, err },
                'could not finish a delivery; its lease will expire',
              );
            }),
          ),
        );
      }
      return report;
    },

    invalidateTransports: () => transports.invalidate(),
    close: () => Promise.resolve(transports.close()),
  };
}
