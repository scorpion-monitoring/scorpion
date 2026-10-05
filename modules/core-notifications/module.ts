import { z } from '@scorpion/contracts';
import { defineModule } from '@scorpion/kernel';
import { createSeedDevMailCommand } from './service/seed-dev-mail-command.ts';
import { templateEntrySchema, TEMPLATE_REGISTRY } from './service/templates/define.ts';
import { SUPPORTED_LOCALES } from './service/templates/locale.ts';
import { buildTemplateIndex } from './service/templates/registry.ts';
import { SHIPPED_TEMPLATES } from './templates/index.ts';
import { SYSTEM_TEMPLATES } from './templates/system.ts';
import { registerNotificationRoutes, PERMISSION_PREFERENCE_READ } from './routes.ts';
import {
  PERMISSION_DELIVERIES_MANAGE,
  PERMISSION_DELIVERIES_READ,
  PERMISSION_TEST,
} from './service/admin.ts';
import { PERMISSION_INBOX_READ, PERMISSION_INBOX_WRITE } from './service/inbox.ts';
import { PREFERENCES_KEY, preferencesSchema } from './service/preferences.ts';
import {
  RECIPIENT_ADDRESS_REGISTRY,
  recipientAddressEntrySchema,
} from './service/recipient-address.ts';
import { settingsSchema, type NotificationSettings } from './settings-schema.ts';
import {
  createNotificationsService,
  PERMISSION_STATUS_READ,
  type NotificationsInternals,
} from './service/notifications.ts';
import { createTransportCache } from './service/transport-cache.ts';
import { noneTransport } from './service/transports/none.ts';
import { smtpTransport } from './service/transports/smtp.ts';
import {
  TRANSPORT_REGISTRY,
  transportEntrySchema,
  type TransportEntry,
} from './service/transports/types.ts';
import { webhookTransportEntry, type WebhookDeps } from './service/transports/webhook.ts';
import { createWakeListener } from './service/wake.ts';

export {
  settingsSchema,
  SMTP_PASSWORD_SECRET,
  WEBHOOK_SECRET,
  type NotificationSettings,
} from './settings-schema.ts';
export type { NotificationsInternals } from './service/notifications.ts';

export const DELIVER_JOB = 'core.notifications.deliver';
/** The daily job that deletes old deliveries and read inbox items (the plan calls it `notify.retention`; a job name carries the module id). */
export const RETENTION_JOB = 'core.notifications.retention';

/** What the role `user` holds from this module: your own inbox, and the list of categories to set switches for. */
export const USER_PERMISSIONS = [
  PERMISSION_INBOX_READ,
  PERMISSION_INBOX_WRITE,
  PERMISSION_PREFERENCE_READ,
];

const deliveryEvent = z.strictObject({
  deliveryId: z.string(),
  template: z.string(),
  channel: z.enum(['email', 'webhook']),
});
/** The user preference that picks the language of a person's mail (M4 decision 5). */
export const LOCALE_PREFERENCE = 'notifications.locale';

export interface NotificationsModuleOptions {
  /** For tests: how long one process trusts a built transport. Default: 5 s, the settings port's bound. */
  transportTtlMs?: number;
  /** For tests: the clock of the transport cache. */
  now?: () => number;
  /** For tests: the resolver and clock of the webhook, to play DNS rebinding. */
  webhook?: WebhookDeps;
  /** For tests: more registry entries (a stub transport). */
  extraTransports?: TransportEntry[];
  /** For tests: false keeps the wake-up listener off, so only a direct pass or the job delivers. */
  listen?: boolean;
}

/**
 * Builds the manifest. The default export is the one a profile uses; tests build their own to
 * tune the cache and to play a resolver. The service reaches the handlers through a closure.
 */
export function createNotificationsModule(options: NotificationsModuleOptions = {}) {
  let current: NotificationsInternals | undefined;
  const serviceOrThrow = (): NotificationsInternals => {
    if (!current) throw new Error('core.notifications: the service is not ready');
    return current;
  };
  let startListener: (() => Promise<void>) | undefined;
  let stopListener: (() => Promise<void>) | undefined;

  return defineModule<
    NotificationsInternals,
    'core.authz' | 'core.settings',
    never,
    NotificationSettings
  >({
    id: 'core.notifications',
    version: '0.1.0',
    // Short on purpose: the table is `notify_delivery`, not `core_notifications_delivery` (ADR 0004).
    tablePrefix: 'notify_',

    permissions: {
      [PERMISSION_STATUS_READ]: {
        description: 'See the state of mail delivery: counts, recent error codes, the transport',
      },
      [PERMISSION_DELIVERIES_READ]: {
        description: 'List deliveries (metadata only, never the content or the address)',
      },
      [PERMISSION_DELIVERIES_MANAGE]: {
        description: 'Put a dead delivery back in the queue',
      },
      [PERMISSION_TEST]: { description: 'Send a test mail to your own address' },
      [PERMISSION_INBOX_READ]: { description: 'Read your own notifications' },
      [PERMISSION_INBOX_WRITE]: {
        description: 'Mark your own notifications read, and delete them',
      },
      [PERMISSION_PREFERENCE_READ]: {
        description: 'List the notification categories you can switch on and off',
      },
    },
    settings: settingsSchema,

    schema: () => import('./db/schema.ts'),
    migrations: new URL('./migrations', import.meta.url),

    commands: [createSeedDevMailCommand()],

    jobs: [
      {
        // Woken by the wake-up listener and `ctx.jobs.enqueue`, and a sweep every minute for
        // retries that came due and for wake-ups that were lost (ADR 0020).
        name: DELIVER_JOB,
        schedule: '* * * * *',
        retry: { limit: 2, delaySeconds: 30 },
        timeoutSeconds: 300,
        handler: async (job, ctx) => {
          const report = await serviceOrThrow().deliverDue({ signal: job.signal });
          // Counts only: no id, address or subject.
          if (report.claimed > 0) ctx.log.info(report, 'deliveries processed');
        },
      },
      {
        // Once a day: delivered and dead rows past `retentionDays`, read inbox items past `inboxRetentionDays`.
        name: RETENTION_JOB,
        schedule: '17 3 * * *', // daily, UTC
        retry: { limit: 2, delaySeconds: 300 },
        timeoutSeconds: 600,
        handler: async (_job, ctx) => {
          const report = await serviceOrThrow().admin.runRetention();
          // Counts only.
          ctx.log.info(report, 'notification retention finished');
        },
      },
    ],

    events: {
      emits: {
        // Ids, the template key and an error code. Never an address, a subject or a body.
        'notifications.delivery.dead@1': deliveryEvent.extend({
          attempts: z.number().int(),
          code: z.string(),
        }),
        'notifications.delivery.requeued@1': deliveryEvent.extend({ requestedBy: z.string() }),
        'notifications.settings.tested@1': z.strictObject({
          deliveryId: z.string(),
          template: z.string(),
          requestedBy: z.string(),
        }),
      },
      on: {
        'settings.changed@1': (event) => {
          if ((event.payload as { module?: string }).module === 'core.notifications') {
            serviceOrThrow().invalidateTransports();
          }
          return Promise.resolve();
        },
        'settings.secret.changed@1': (event) => {
          if (String((event.payload as { name?: string }).name).startsWith('notifications.')) {
            serviceOrThrow().invalidateTransports();
          }
          return Promise.resolve();
        },
        'system.ready': async (_event, ctx) => {
          // One line instead of a warning per message: with no relay, mail is recorded and dropped.
          // The counter is `status().sentWithoutTransport` and the `dropped` of the job's log line.
          if ((await ctx.settings.get()).emailTransport === 'none') {
            ctx.log.warn(
              'emailTransport is "none": mail is recorded as sent and dropped. Set emailTransport and smtp.* in the settings of core.notifications to deliver it',
            );
          }
          if (options.listen === false) return;
          await startListener?.();
          ctx.log.info('notification delivery is listening for new messages');
        },
      },
    },

    registries: {
      [TRANSPORT_REGISTRY]: transportEntrySchema,
      [TEMPLATE_REGISTRY]: templateEntrySchema,
      // A module that knows people (core.identity) contributes how to find a user's address, so
      // this one can mail the caller's own address without importing it (ADR 0023).
      [RECIPIENT_ADDRESS_REGISTRY]: recipientAddressEntrySchema,
    },
    contributes: {
      // The templates of modules that do not exist yet ship here, registered and tested.
      [TEMPLATE_REGISTRY]: [...SHIPPED_TEMPLATES, ...SYSTEM_TEMPLATES],
      'authz.defaultRole': [{ role: 'user', permissions: USER_PERMISSIONS }],
      // The language of a person's mail. Registered here because this module is what reads it.
      'settings.userPreference': [
        {
          key: LOCALE_PREFERENCE,
          description: 'The language of the mail and notifications you receive',
          schema: z.enum(SUPPORTED_LOCALES),
        },
        {
          key: PREFERENCES_KEY,
          description:
            'Which kinds of notification you want by mail and in the app, per category (see GET /notifications/preferences/categories)',
          schema: preferencesSchema,
        },
      ],
      [TRANSPORT_REGISTRY]: [
        smtpTransport,
        webhookTransportEntry(options.webhook),
        noneTransport,
        ...(options.extraTransports ?? []),
      ],
    },

    services: (ctx) => {
      const settingsService = ctx.deps['core.settings'];
      const entries = new Map<string, TransportEntry>();
      for (const entry of ctx.registry(TRANSPORT_REGISTRY) as TransportEntry[]) {
        entries.set(entry.id, entry);
      }
      const transports = createTransportCache({
        entries,
        settings: () => ctx.settings.get(),
        secret: (name) => settingsService.getSecret(name),
        log: ctx.log,
        ttlMs: options.transportTtlMs,
        now: options.now,
      });
      const service = createNotificationsService(ctx, {
        authz: ctx.deps['core.authz'],
        settingsService,
        transports,
        templates: buildTemplateIndex(ctx.registry(TEMPLATE_REGISTRY)),
      });
      const listener = createWakeListener({
        connectionString: ctx.config.DATABASE_URL,
        log: ctx.log,
        onWake: async () => {
          await ctx.jobs.enqueue(DELIVER_JOB);
        },
      });
      startListener = () => listener.start();
      stopListener = () => listener.stop();
      const original = () => service.close();
      current = {
        ...service,
        close: async () => {
          await stopListener?.();
          await original();
        },
      };
      return current;
    },

    routes: (r) => {
      registerNotificationRoutes(r, r.service<NotificationsInternals>());
    },
  });
}

export default createNotificationsModule();
