// Starts core.notifications over real Postgres, as the kernel guide describes ("Testing a module"),
// with the real core.authz and core.settings it depends on and a fixture module `fix.mailer` that
// plays "another module": it enqueues messages inside its own transaction, as core.identity will.
// Settings and secrets can be stored before the kernel starts, so a test begins configured.
import type { UserActor } from '@scorpion/contracts';
import authzModule from '@scorpion/core-authz/module';
import authzPackage from '@scorpion/core-authz/package.json' with { type: 'json' };
import type { AuthzService } from '@scorpion/core-authz/public';
import { createSettingsModule, type SettingsModuleOptions } from '@scorpion/core-settings/module';
import settingsPackage from '@scorpion/core-settings/package.json' with { type: 'json' };
import {
  createKernel,
  createLogger,
  defineModule,
  loadConfig,
  type Kernel,
} from '@scorpion/kernel';
import {
  makeRoleAssignment,
  makeSecret,
  makeSecretsKey,
  makeSetting,
  startPostgres,
  type DeliveryRow,
  type StartedPostgres,
} from '@scorpion/testing';
import { randomUUID } from 'node:crypto';
import { Writable } from 'node:stream';
import { afterAll, afterEach, beforeAll } from 'vitest';
import { z } from '@scorpion/contracts';
import {
  createNotificationsModule,
  type NotificationsInternals,
  type NotificationsModuleOptions,
} from '../module.ts';
import packageJson from '../package.json' with { type: 'json' };
import { defineTemplate, type NotificationMessage, type TemplateMessage } from '../public.ts';

export interface Mailer {
  /** Enqueues in its own `ctx.db.tx()`; `failAfter` throws after the insert, so the transaction rolls back. */
  send(message: NotificationMessage, options?: { failAfter?: boolean }): Promise<string | null>;
  /** Several messages in one transaction. */
  sendAll(
    messages: NotificationMessage[],
    options?: { failAfter?: boolean },
  ): Promise<(string | null)[]>;
  /** `enqueueTemplate` in its own `ctx.db.tx()`; `failAfter` throws after the insert. */
  sendTemplate(message: TemplateMessage, options?: { failAfter?: boolean }): Promise<string>;
  /** `enqueueTemplate` in a plain Drizzle transaction that is not `ctx.db.tx()`: must be refused. */
  templateOutsideTx(message: TemplateMessage): Promise<unknown>;
  /** Enqueues in a plain Drizzle transaction that is not `ctx.db.tx()`: must be refused. */
  outsideTx(message: NotificationMessage): Promise<unknown>;
}

/** A template with free text in it, and one that holds a credential. */
export const FIXTURE_HELLO = defineTemplate({
  key: 'fix.hello',
  schema: z.strictObject({ name: z.string().min(1).max(100) }),
  category: 'test',
  catalogue: {
    en: { subject: 'Hello {name}', body: 'Welcome, {name}.' },
    de: { subject: 'Hallo {name}', body: 'Willkommen, {name}.' },
  },
  content: (data, { t }) => ({
    subject: t('subject', { name: data.name }),
    blocks: [{ kind: 'text', text: t('body', { name: data.name }) }],
  }),
});

export const FIXTURE_SECRET_LINK = defineTemplate({
  key: 'fix.secret-link',
  schema: z.strictObject({ link: z.url() }),
  sensitive: true,
  mandatory: true,
  category: 'security',
  catalogue: {
    en: { subject: 'Your link', body: 'Open it:' },
    de: { subject: 'Ihr Link', body: 'Öffnen:' },
  },
  content: (data, { t }) => ({
    subject: t('subject'),
    blocks: [
      { kind: 'text', text: t('body') },
      { kind: 'action', label: t('body'), url: data.link },
    ],
  }),
});

/** A template whose German catalogue lacks `extra`: the English text is used and the gap is logged. */
export const FIXTURE_PARTIAL = defineTemplate({
  key: 'fix.partial',
  schema: z.strictObject({ name: z.string().min(1).max(100) }),
  category: 'test',
  catalogue: {
    en: { subject: 'Partial', extra: 'Only in English for {name}' },
    de: { subject: 'Teilweise' },
  },
  content: (data, { t }) => ({
    subject: t('subject'),
    blocks: [{ kind: 'text', text: t('extra', { name: data.name }) }],
  }),
});

function mailerModule() {
  return {
    id: 'fix.mailer',
    manifest: defineModule<Mailer, 'core.notifications'>({
      id: 'fix.mailer',
      version: '1.0.0',
      contributes: { 'notify.template': [FIXTURE_HELLO, FIXTURE_SECRET_LINK, FIXTURE_PARTIAL] },
      services: (ctx) => {
        const notifications = ctx.deps['core.notifications'];
        return {
          send: (message, options) =>
            ctx.db.tx(async (tx) => {
              const id = await notifications.enqueue(tx, message);
              if (options?.failAfter)
                throw new Error('the work failed after the message was queued');
              return id;
            }),
          sendAll: (messages, options) =>
            ctx.db.tx(async (tx) => {
              const out: (string | null)[] = [];
              for (const message of messages) out.push(await notifications.enqueue(tx, message));
              if (options?.failAfter)
                throw new Error('the work failed after the messages were queued');
              return out;
            }),
          sendTemplate: (message, options) =>
            ctx.db.tx(async (tx) => {
              const id = await notifications.enqueueTemplate(tx, message);
              if (options?.failAfter) throw new Error('the work failed after the mail was queued');
              return id;
            }),
          templateOutsideTx: (message) =>
            ctx.db.transaction((tx) => notifications.enqueueTemplate(tx as never, message)),
          outsideTx: (message) =>
            ctx.db.transaction((tx) => notifications.enqueue(tx as never, message)),
        };
      },
    }),
  };
}

export interface StartOptions {
  databaseUrl?: string;
  /** Stored settings of `core.notifications`, as an administrator would have saved them. */
  settings?: Record<string, unknown>;
  /** Environment variables for the kernel's config (BASE_PATH, ORIGIN). */
  env?: Record<string, string>;
  /** Stored `branding` settings of core.settings, as an administrator would have saved them. */
  branding?: Record<string, unknown>;
  /** Secrets stored under these names before start. */
  secrets?: Record<string, string>;
  /** The key the secrets are stored under; default: a new random one. Pass the first kernel's to share a database. */
  secretsKey?: string;
  notifications?: NotificationsModuleOptions;
  settingsModule?: SettingsModuleOptions;
  /** Also run the job workers, so the job path (wake-up, cron) is live. */
  startWorkers?: boolean;
}

export interface Started {
  kernel: Kernel;
  notifications: NotificationsInternals;
  mail: Mailer;
  authz: AuthzService;
  /** Everything the kernel logged at trace level, as JSON lines. */
  logs: string[];
  databaseUrl: string;
  secretsKey: string;
  /** A user holding the given roles (rows in the database, decided by the real authoriser). */
  actorOf: (...roles: string[]) => Promise<UserActor>;
  deliveries: () => Promise<DeliveryRow[]>;
  delivery: (id: string) => Promise<DeliveryRow>;
  /** Makes every queued row due now, as if its backoff had passed. */
  makeDue: () => Promise<void>;
}

export interface NotificationsHarness {
  server: () => StartedPostgres;
  start: (options?: StartOptions) => Promise<Started>;
}

/** One Postgres container per test file; every `start()` without a `databaseUrl` gets an empty database. */
export function useNotifications(): NotificationsHarness {
  let server: StartedPostgres;
  const open: { kernel: Kernel; notifications: NotificationsInternals }[] = [];
  beforeAll(async () => {
    server = await startPostgres();
  }, 120_000);
  afterEach(async () => {
    for (const { kernel, notifications } of open.splice(0)) {
      await notifications.close();
      await kernel.stop();
    }
  });
  afterAll(async () => {
    await server?.stop();
  });
  return {
    server: () => server,
    async start(options = {}) {
      const logs: string[] = [];
      const log = createLogger({
        level: 'trace',
        destination: new Writable({
          write(chunk: Buffer, _encoding, callback) {
            logs.push(chunk.toString());
            callback();
          },
        }),
      });
      const secretsKey = options.secretsKey ?? makeSecretsKey();
      const databaseUrl = options.databaseUrl ?? (await server.createDatabase());
      const mailer = mailerModule();
      const kernel = createKernel({
        profile: {
          name: 'notifications-test',
          modules: ['core.authz', 'core.settings', 'core.notifications', mailer.id] as never,
        },
        sources: [
          { manifest: authzModule, packageJson: authzPackage },
          {
            manifest: createSettingsModule({
              ...options.settingsModule,
              env: { SECRETS_KEY: secretsKey },
            }),
            packageJson: settingsPackage,
          },
          {
            manifest: createNotificationsModule(options.notifications),
            packageJson,
          },
          {
            manifest: mailer.manifest,
            packageJson: {
              name: '@scorpion/fix-mailer',
              dependencies: { '@scorpion/core-notifications': 'workspace:*' },
            },
          },
        ],
        modulePackages: {
          'core.authz': '@scorpion/core-authz',
          'core.settings': '@scorpion/core-settings',
          'core.notifications': '@scorpion/core-notifications',
          'fix.mailer': '@scorpion/fix-mailer',
        },
        config: loadConfig({
          DATABASE_URL: databaseUrl,
          PROFILE: 'notifications-test',
          ...options.env,
        }),
        log,
      });
      if (options.settings || options.secrets || options.branding) {
        await kernel.migrate();
        if (options.settings)
          await makeSetting(kernel.pool, 'core.notifications', options.settings);
        if (options.branding)
          await makeSetting(kernel.pool, 'core.settings', { branding: options.branding });
        for (const [name, value] of Object.entries(options.secrets ?? {})) {
          await makeSecret(kernel.pool, { name, value, key: secretsKey });
        }
      }
      await kernel.start();
      if (options.startWorkers) await kernel.startWorkers();
      const notifications = kernel.services.get('core.notifications') as NotificationsInternals;
      open.push({ kernel, notifications });
      const pool = kernel.pool;
      return {
        kernel,
        notifications,
        mail: kernel.services.get('fix.mailer') as Mailer,
        authz: kernel.services.get('core.authz') as AuthzService,
        logs,
        databaseUrl,
        secretsKey,
        async actorOf(...roles) {
          const user = { id: randomUUID() };
          for (const role of roles) await makeRoleAssignment(pool, user, role);
          return {
            kind: 'user',
            userId: user.id,
            username: `user-${user.id.slice(0, 8)}`,
            roles: [],
            via: 'session',
          };
        },
        deliveries: async () =>
          (await pool.query<DeliveryRow>('select * from notify_delivery order by created_at, id'))
            .rows,
        delivery: async (id) =>
          (await pool.query<DeliveryRow>('select * from notify_delivery where id = $1', [id]))
            .rows[0]!,
        makeDue: async () => {
          await pool.query(
            `update notify_delivery set next_attempt_at = now() where status = 'queued'`,
          );
        },
      };
    },
  };
}

/** A valid email message; every field can be overridden. */
export function mail(overrides: Partial<NotificationMessage> = {}): NotificationMessage {
  const n = randomUUID().slice(0, 8);
  return {
    template: 'test.message',
    recipientAddress: `person-${n}@example.org`,
    subject: `Subject ${n}`,
    text: `Body ${n}`,
    ...overrides,
  };
}

/**
 * Starts a kernel whose only extra module contributes the given entries to `notify.template`, and stops
 * it again. Resolves when the kernel started, and rejects with the start error when the registry
 * refuses an entry: this is how a test sees what the start-up checks.
 */
export async function startKernelWithTemplates(
  server: StartedPostgres,
  entries: unknown[],
): Promise<void> {
  const fixture = defineModule({
    id: 'fix.templates',
    version: '1.0.0',
    contributes: { 'notify.template': entries },
  });
  const kernel = createKernel({
    profile: {
      name: 'templates-test',
      modules: ['core.authz', 'core.settings', 'core.notifications', 'fix.templates'] as never,
    },
    sources: [
      { manifest: authzModule, packageJson: authzPackage },
      {
        manifest: createSettingsModule({ env: { SECRETS_KEY: makeSecretsKey() } }),
        packageJson: settingsPackage,
      },
      { manifest: createNotificationsModule({ listen: false }), packageJson },
      {
        manifest: fixture,
        packageJson: {
          name: '@scorpion/fix-templates',
          dependencies: { '@scorpion/core-notifications': 'workspace:*' },
        },
      },
    ],
    modulePackages: {
      'core.authz': '@scorpion/core-authz',
      'core.settings': '@scorpion/core-settings',
      'core.notifications': '@scorpion/core-notifications',
      'fix.templates': '@scorpion/fix-templates',
    },
    config: loadConfig({
      DATABASE_URL: await server.createDatabase(),
      PROFILE: 'templates-test',
    }),
    log: createLogger({ level: 'silent' }),
  });
  try {
    await kernel.start();
  } finally {
    await kernel.stop().catch(() => undefined);
  }
}
