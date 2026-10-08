// The notifications service: `enqueue` for trusted callers, `status` for administrators, and the
// delivery pass that the job `core.notifications.deliver` runs (ADR 0019, 0020).
import type { Actor } from '@scorpion/contracts';
import type { AuthzService } from '@scorpion/core-authz/public';
import type { SettingsService } from '@scorpion/core-settings/public';
import { Invalid } from '@scorpion/contracts';
import {
  activeTransaction,
  createRateLimiter,
  ids,
  mountPath,
  type DbTx,
  type ModuleContext,
} from '@scorpion/kernel';
import { desc, max, sql } from 'drizzle-orm';
import { delivery } from '../db/schema.ts';
import type { NotificationStatus, NotificationsService, TemplateMessage } from '../public.ts';
import {
  createAdminService,
  PERMISSION_DELIVERIES_MANAGE,
  PERMISSION_DELIVERIES_READ,
  PERMISSION_TEST,
  type AdminService,
} from './admin.ts';
import {
  createInboxService,
  deleteInboxOfUser,
  insertInboxItem,
  PERMISSION_INBOX_READ,
  PERMISSION_INBOX_WRITE,
  type InboxService,
} from './inbox.ts';
import { createInboxStreamHub, type InboxStreamHub } from './inbox-stream.ts';
import { PREFERENCES_KEY, resolveChannels } from './preferences.ts';
import { RECIPIENT_ADDRESS_REGISTRY, recipientAddressEntrySchema } from './recipient-address.ts';
import type { NotificationSettings } from '../settings-schema.ts';
import { backoffSeconds } from './backoff.ts';
import { claimDue, markDead, markRetry, markSent, type ClaimedDelivery } from './delivery.ts';
import { parseMessage, type NotificationMessage, type ParsedMessage } from './message.ts';
import { INAPP_TEXT_MAX, INAPP_TITLE_MAX, type TemplateBranding } from './templates/layout.ts';
import { multiLine, oneLine, safeUrl } from './templates/text.ts';
import { resolveLocale } from './templates/locale.ts';
import type { TemplateIndex } from './templates/registry.ts';
import type { TransportCache } from './transport-cache.ts';
import { failureCode, TransportError, type OutgoingMessage } from './transports/types.ts';
import { WAKE_CHANNEL } from './wake.ts';

export const PERMISSION_STATUS_READ = 'core.notifications.status.read';
export {
  PERMISSION_DELIVERIES_MANAGE,
  PERMISSION_DELIVERIES_READ,
  PERMISSION_INBOX_READ,
  PERMISSION_INBOX_WRITE,
  PERMISSION_TEST,
};

/** Where core.blob serves a stored file below the internal API (`GET /files/{hash}`), for a logo in a mail. */
const FILES_PATH = '/api/internal/files';

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
  /** Rows the transport `none` accepted and dropped (nobody configured a relay). */
  dropped: number;
}

export interface NotificationsInternals extends NotificationsService {
  /** The caller's own inbox (routes call these). */
  inbox: InboxService;
  /** The live unread count of the caller's inbox (`GET /inbox/stream`, ADR-0028). */
  inboxStream: InboxStreamHub;
  /** Delivery list, requeue, test mail and the retention pass (routes and the job call these). */
  admin: AdminService;
  /** The template index, for the category list of the preferences. */
  templates: TemplateIndex;
  /** One pass of the delivery job: claims due rows and sends them until nothing is due. */
  deliverDue(options?: { signal?: AbortSignal; budgetMs?: number }): Promise<DeliveryPassReport>;
  /** Forget the built transports (a setting or a notification secret changed). */
  invalidateTransports(): void;
  /** Stops the wake-up listener and releases the transports (tests; the process ends them otherwise). */
  close(): Promise<void>;
}

export interface NotificationsDeps {
  authz: AuthzService;
  settingsService: Pick<SettingsService, 'getBranding' | 'getUserPreference'>;
  transports: TransportCache;
  templates: TemplateIndex;
  /** Tuning of the live inbox count, for tests. */
  inboxStream?: { heartbeatMs?: number; coalesceMs?: number };
}

export function createNotificationsService(
  ctx: ModuleContext<'core.authz' | 'core.settings', never, NotificationSettings>,
  deps: NotificationsDeps,
): NotificationsInternals {
  const { authz, transports, templates } = deps;
  const { db, log } = ctx;

  /** `<ORIGIN><BASE_PATH>`: where the instance is reached, whatever the number of path segments. */
  const baseUrl = `${ctx.config.ORIGIN}${mountPath(ctx.config)}`;

  /** The branding settings in the form the layout prints. */
  async function templateBranding(): Promise<TemplateBranding> {
    const branding = await deps.settingsService.getBranding();
    return {
      productName: branding.productName,
      instanceName: branding.instanceName,
      contactEmail: branding.contactEmail,
      imprintUrl: branding.imprintUrl,
      logoUrl: branding.logos.light ? `${baseUrl}${FILES_PATH}/${branding.logos.light}` : null,
      baseUrl,
    };
  }

  /** `enqueue` and `enqueueTemplate` call this: the one place a row is inserted. */
  async function insert(
    tx: DbTx,
    message: ParsedMessage,
    settings: NotificationSettings,
  ): Promise<string> {
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
    if (message.inApp && message.recipientUserId) {
      // Same transaction: the mail and its inbox item commit together or not at all.
      await insertInboxItem(tx, {
        userId: message.recipientUserId,
        template: message.template,
        title: oneLine(message.inApp.title, INAPP_TITLE_MAX) || 'Notification',
        text: multiLine(message.inApp.text, INAPP_TEXT_MAX).trim(),
        link: message.inApp.link && safeUrl(message.inApp.link) ? message.inApp.link : null,
      });
    }
    return id;
  }

  function requireTransaction(): void {
    // Like `ctx.events.emit` (ADR 0003): the row commits with the change, or not at all.
    if (!activeTransaction()) {
      throw new NotificationError(
        'core.notifications: enqueue() must be called inside ctx.db.tx(), so the message commits with the change',
      );
    }
  }

  /**
   * `sending → dead` and the event, in one transaction: the event exists exactly when the row became
   * dead here. Ids, the template key and the error code; no address, subject or body.
   */
  function markDeadAndAnnounce(
    row: ClaimedDelivery,
    failure: { code: string; transport: string | null },
  ): Promise<boolean> {
    return db.tx(async (tx) => {
      const became = await markDead(tx, row, failure);
      if (became) {
        await ctx.events.emit('notifications.delivery.dead@1', {
          deliveryId: row.id,
          template: row.template,
          channel: row.channel,
          attempts: row.attempts,
          code: failure.code,
        });
      }
      return became;
    });
  }

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
        if (transportId === 'none') report.dropped += 1;
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
      ? await markDeadAndAnnounce(row, { code: outcome.code, transport: transportId })
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

  const inbox = createInboxService({ db, authz });
  const inboxStream = createInboxStreamHub({
    db,
    authz,
    log,
    limits: async () => (await ctx.settings.get()).inboxStream,
    ...deps.inboxStream,
  });
  const admin = createAdminService({
    db,
    authz,
    events: ctx.events,
    limiter: createRateLimiter(db),
    settings: () => ctx.settings.get(),
    enqueueTemplate: (tx, message) => internals.enqueueTemplate(tx, message),
    addresses: ctx
      .registry(RECIPIENT_ADDRESS_REGISTRY)
      .map((entry) => recipientAddressEntrySchema.parse(entry)),
  });

  const internals: NotificationsInternals = {
    inbox,
    inboxStream,
    admin,
    templates,

    async removeInboxOfUser(tx: DbTx, userId: string): Promise<number> {
      return deleteInboxOfUser(tx, userId);
    },

    async enqueue(tx: DbTx, input: NotificationMessage): Promise<string | null> {
      requireTransaction();
      const message = parseMessage(input);
      const settings = await ctx.settings.get();
      // The webhook is an optional mirror: with it off there is nothing to deliver and nothing to fail.
      if (message.channel === 'webhook' && !settings.webhook.enabled) return null;
      return insert(tx, message, settings);
    },

    async enqueueTemplate(tx: DbTx, input: TemplateMessage): Promise<string | null> {
      requireTransaction();
      const entry = templates.get(String(input.template));
      if (!entry) {
        // A programming error: the caller names a key no loaded module contributes.
        throw new NotificationError(
          `core.notifications: there is no template "${String(input.template).slice(0, 100)}"`,
        );
      }
      const data = entry.schema.safeParse(input.data);
      if (!data.success) {
        // Field names and the schema's own messages; the offending value is never repeated.
        throw new Invalid(
          'The notification data is not valid.',
          data.error.issues.map((issue) => ({
            path: ['data', ...issue.path.map(String)].join('.'),
            message: issue.message,
          })),
        );
      }
      const { address, userId } = input.recipient;
      if (!address && !userId) {
        // Nobody to reach: a bug in the caller, not a choice of the recipient.
        throw new NotificationError(
          `core.notifications: the recipient of "${entry.key}" has neither an address nor a user id`,
        );
      }
      // Which channels the person wants (ADR 0023). A mandatory template does not ask; neither does a
      // recipient with no user id (nothing to look up).
      const wanted =
        entry.mandatory || !userId
          ? { email: true, inApp: true }
          : resolveChannels(
              entry,
              await deps.settingsService.getUserPreference(userId, PREFERENCES_KEY),
            );
      const wantMail = Boolean(address) && wanted.email;
      // A sensitive template never writes an inbox item: its link is a credential (ADR 0023).
      const wantInbox = input.inApp === true && Boolean(userId) && !entry.sensitive && wanted.inApp;
      if (!wantMail && !wantInbox) {
        // Switched off, or no address and no inbox: nothing is stored. The key only, no id, no address.
        log.debug({ template: entry.key }, 'a notification was not stored: no channel wanted');
        return null;
      }

      const settings = await ctx.settings.get();
      const locale = resolveLocale(input.locale, settings.defaultLocale);
      const branding = await templateBranding();
      const options = {
        // The key and language only: the text of a message may hold a name.
        onFallback: (key: string, missingIn: string) =>
          log.warn(
            { template: entry.key, key, locale: missingIn },
            'a template message is missing in this language; English was used',
          ),
      };
      let deliveryId: string | null = null;
      if (wantMail) {
        const rendered = entry.render(data.data, locale, branding, options);
        // The size limits and the one-line subject are checked on what was rendered, too.
        const message = parseMessage({
          template: entry.key,
          channel: 'email',
          recipientAddress: address,
          recipientUserId: userId,
          locale,
          subject: rendered.subject,
          text: rendered.text,
          html: rendered.html,
          // The template decides, not the caller: a reset link is always a sensitive body.
          sensitive: entry.sensitive,
        });
        deliveryId = await insert(tx, message, settings);
      }
      if (wantInbox && userId) {
        // The same content blocks as the mail, rendered once more as plain text.
        const item = entry.renderInApp?.(data.data, locale, branding, options);
        if (!item) {
          throw new NotificationError(
            `core.notifications: "${entry.key}" cannot render an inbox item`,
          );
        }
        await insertInboxItem(tx, { userId, template: entry.key, ...item });
      }
      return deliveryId;
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
      const [dropped] = await db
        .select({ n: sql<number>`count(*)::int` })
        .from(delivery)
        .where(sql`${delivery.status} = 'sent' and ${delivery.transport} = 'none'`);
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
        sentWithoutTransport: dropped?.n ?? 0,
        lastErrors: errors.map((row) => ({
          code: row.code ?? 'unknown',
          count: row.count,
          lastAt: row.lastAt ?? new Date(0),
        })),
      };
    },

    async deliverDue(options = {}) {
      const report: DeliveryPassReport = {
        claimed: 0,
        sent: 0,
        retried: 0,
        dead: 0,
        lost: 0,
        dropped: 0,
      };
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
    close: () => {
      inboxStream.closeAll();
      return Promise.resolve(transports.close());
    },
  };
  return internals;
}
