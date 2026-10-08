// The settings of core.notifications. Nothing secret lives here: the SMTP password and the
// webhook signing secret are in the secrets store (ADR 0016) under `SMTP_PASSWORD_SECRET` and
// `WEBHOOK_SECRET`, set with `scorpion set-secret`.
import { z } from '@scorpion/contracts';

export const SMTP_PASSWORD_SECRET = 'notifications.smtp.password';
export const WEBHOOK_SECRET = 'notifications.webhook.secret';

export const DEFAULT_MAX_ATTEMPTS = 8;
export const DEFAULT_RETENTION_DAYS = 90;
export const DEFAULT_INBOX_RETENTION_DAYS = 90;
export const DEFAULT_STREAMS_PER_USER = 3;
export const DEFAULT_STREAMS_GLOBAL = 200;

/** `en`, `de`, `pt-BR`: a language tag as the templates (sprint 2) and the user preference use it. */
export const LOCALE = /^[a-z]{2,3}(-[A-Za-z0-9]{2,8}){0,2}$/;

const smtpSettings = z.strictObject({
  host: z.string().trim().max(253).default(''),
  port: z.number().int().min(1).max(65535).default(587),
  /** `starttls` upgrades a plain connection (587), `tls` is implicit TLS (465), `none` is plain text (a local relay). */
  tls: z.enum(['starttls', 'tls', 'none']).default('starttls'),
  /** Empty: the relay needs no sign-in. The password is the secret `notifications.smtp.password`. */
  user: z.string().trim().max(254).default(''),
  /** One timeout for the connection, the greeting and each stall of the socket. */
  timeoutSeconds: z.number().int().min(1).max(120).default(10),
});

const webhookSettings = z.strictObject({
  enabled: z.boolean().default(false),
  url: z.string().trim().max(2048).default(''),
  /** Lifts the check for private and loopback targets (an internal relay), and allows `http://`. */
  allowPrivateTargets: z.boolean().default(false),
});

const inboxStreamSettings = z.strictObject({
  /** Open streams one person may have (one per browser tab). */
  perUser: z.number().int().min(1).max(20).default(DEFAULT_STREAMS_PER_USER).meta({
    title: 'Live inbox streams per person',
    description: 'One is open for each browser tab. More are refused until one closes.',
  }),
  /** Open streams one server process holds. Each is an open connection. */
  global: z.number().int().min(1).max(10_000).default(DEFAULT_STREAMS_GLOBAL).meta({
    title: 'Live inbox streams per server process',
    description:
      'Each is an open connection. More are refused (the page then checks every minute instead).',
  }),
});

export const settingsSchema = z
  .strictObject({
    /** The id of an entry of the registry `notify.transport` with channel `email`: `smtp` or `none`. */
    emailTransport: z.enum(['smtp', 'none']).default('none').meta({
      title: 'Mail transport',
      description:
        '"smtp" sends through the relay below; "none" sends nothing (mail is recorded and marked sent).',
    }),
    smtp: smtpSettings
      .default(() => smtpSettings.parse({}))
      .meta({
        title: 'Mail relay (SMTP)',
        description:
          'The password of the relay is the secret notifications.smtp.password (see Secrets).',
      }),
    webhook: webhookSettings
      .default(() => webhookSettings.parse({}))
      .meta({
        title: 'Webhook',
        description: 'The signing secret is the secret notifications.webhook.secret (see Secrets).',
      }),
    /** For a message that names no locale. */
    defaultLocale: z.string().regex(LOCALE).default('en').meta({
      title: 'Default language',
      description: 'For a message that names no language.',
    }),
    /** Attempts before a delivery is `dead`. */
    maxAttempts: z.number().int().min(1).max(20).default(DEFAULT_MAX_ATTEMPTS).meta({
      title: 'Delivery attempts',
      description: 'Attempts before a delivery is marked dead.',
    }),
    /** How long `sent` and `dead` delivery rows are kept; the daily job `core.notifications.retention` deletes the older ones. */
    retentionDays: z.number().int().min(1).max(3650).default(DEFAULT_RETENTION_DAYS).meta({
      title: 'Keep deliveries for (days)',
      description: 'How long sent and dead deliveries are kept.',
    }),
    /** How long a read inbox item is kept, counted from the moment it was read. Unread items are kept. */
    inboxRetentionDays: z
      .number()
      .int()
      .min(1)
      .max(3650)
      .default(DEFAULT_INBOX_RETENTION_DAYS)
      .meta({
        title: 'Keep read inbox items for (days)',
        description: 'Counted from the moment an item was read. Unread items are kept.',
      }),
    /** The limits of the live count of the inbox (`GET /inbox/stream`, ADR-0028). */
    inboxStream: inboxStreamSettings
      .default(() => inboxStreamSettings.parse({}))
      .meta({
        title: 'Live inbox count',
        description:
          'Limits for the open connections that keep the unread count in the header up to date.',
      }),
  })
  .superRefine((value, ctx) => {
    if (value.emailTransport === 'smtp' && value.smtp.host === '') {
      ctx.addIssue({
        code: 'custom',
        path: ['smtp', 'host'],
        message: 'Set the host of the relay, or use the transport "none".',
      });
    }
    const { enabled, url, allowPrivateTargets } = value.webhook;
    if (enabled || url !== '') {
      let parsed: URL | undefined;
      try {
        parsed = new URL(url);
      } catch {
        parsed = undefined;
      }
      const reason = !parsed
        ? 'Must be an absolute URL.'
        : parsed.username || parsed.password
          ? 'Must not contain a user name or password.'
          : parsed.protocol === 'https:' || (parsed.protocol === 'http:' && allowPrivateTargets)
            ? undefined
            : 'Must start with https:// ("http://" only together with allowPrivateTargets).';
      if (reason) ctx.addIssue({ code: 'custom', path: ['webhook', 'url'], message: reason });
    }
  });

export type NotificationSettings = z.output<typeof settingsSchema>;
