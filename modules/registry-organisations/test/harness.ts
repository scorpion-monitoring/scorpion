// Starts registry.organisations over real Postgres with the real modules it depends on (authz,
// settings, blob, notifications, identity): permissions are decided by the real authoriser, events
// travel through the real outbox. `extra` adds fixture modules next to it (a contributor of an
// `org.type` or `org.usage` entry). `start` gives a test an empty database of its own.
import { randomUUID } from 'node:crypto';
import { Writable } from 'node:stream';
import type { UserActor } from '@scorpion/contracts';
import authzModule from '@scorpion/core-authz/module';
import authzPackage from '@scorpion/core-authz/package.json' with { type: 'json' };
import type { AuthzService } from '@scorpion/core-authz/public';
import blobModule from '@scorpion/core-blob/module';
import blobPackage from '@scorpion/core-blob/package.json' with { type: 'json' };
import { createIdentityModule } from '@scorpion/core-identity/module';
import identityPackage from '@scorpion/core-identity/package.json' with { type: 'json' };
import { createNotificationsModule } from '@scorpion/core-notifications/module';
import notificationsPackage from '@scorpion/core-notifications/package.json' with { type: 'json' };
import { createSettingsModule, type SettingsInternalsBundle } from '@scorpion/core-settings/module';
import settingsPackage from '@scorpion/core-settings/package.json' with { type: 'json' };
import {
  createKernel,
  createLogger,
  loadConfig,
  type Kernel,
  type ModuleManifest,
} from '@scorpion/kernel';
import {
  makeRoleAssignment,
  makeSecretsKey,
  makeUser,
  startPostgres,
  type StartedPostgres,
} from '@scorpion/testing';
import { afterAll, afterEach, beforeAll } from 'vitest';
import { createOrganisationsModule } from '../module.ts';
import type { MembershipsService } from '../service/memberships.ts';
import type { OrganisationsService } from '../service/organisations.ts';
import packageJson from '../package.json' with { type: 'json' };

/** A module that sits next to registry.organisations in a test profile. */
export interface FixtureModule {
  manifest: ModuleManifest<never, never>;
  /** Its `package.json`: the loader derives `dependsOn` from it, as for a real module. */
  packageJson: Record<string, unknown>;
}

export interface OrganisationsStartOptions {
  extra?: FixtureModule[];
  /** Collects every log line the kernel writes (trace level). */
  logLines?: string[];
}

export interface OrganisationsStarted {
  kernel: Kernel;
  pool: Kernel['pool'];
  organisations: OrganisationsService;
  memberships: MembershipsService;
  authz: AuthzService;
  /** A signed-in-looking actor for a new user who holds the given roles (rows in the database, so the real authoriser decides). */
  actor: (...roles: string[]) => Promise<UserActor>;
  /** The address of a user, read from the database (so a test can look for it in a mail). */
  emailOf: (actor: UserActor) => Promise<string>;
  /** Stores the language preference `notifications.locale` of a user. */
  setLocale: (actor: UserActor, locale: string) => Promise<void>;
  /** The mails queued so far, oldest first: who got which template, in which language, with its text. */
  deliveries: () => Promise<
    {
      template: string;
      recipient_address: string | null;
      recipient_user_id: string | null;
      locale: string;
      subject: string;
      text_body: string | null;
    }[]
  >;
  /** The inbox items so far, oldest first. */
  inbox: () => Promise<
    { user_id: string; template: string; title: string; text: string; link: string | null }[]
  >;
  /** Saves the settings of registry.organisations (the whole object) as an administrator would. */
  configure: (values: Record<string, unknown>) => Promise<void>;
  /** Delivers every pending outbox event. */
  dispatch: () => Promise<void>;
  /** The events in the outbox (name and payload), oldest first. */
  events: () => Promise<{ name: string; payload: Record<string, unknown> }[]>;
}

export interface OrganisationsHarness {
  server: () => StartedPostgres;
  start: (options?: OrganisationsStartOptions) => Promise<OrganisationsStarted>;
  /** The kernel that `start` would build, without starting it (for a test that expects a failure). */
  build: (options?: OrganisationsStartOptions) => Promise<Kernel>;
}

const CORE = [
  'core.authz',
  'core.settings',
  'core.blob',
  'core.notifications',
  'core.identity',
  'registry.organisations',
] as const;

export function useOrganisations(): OrganisationsHarness {
  let server: StartedPostgres;
  const perTest: Kernel[] = [];
  beforeAll(async () => {
    server = await startPostgres();
  }, 120_000);
  afterEach(async () => {
    await Promise.all(perTest.splice(0).map((kernel) => kernel.stop()));
  });
  afterAll(async () => {
    await server?.stop();
  });

  async function build(options: OrganisationsStartOptions = {}): Promise<Kernel> {
    const extra = options.extra ?? [];
    const kernel = createKernel({
      profile: {
        name: 'organisations-test',
        modules: [...CORE, ...extra.map((module) => module.manifest.id)] as never,
      },
      sources: [
        { manifest: authzModule, packageJson: authzPackage },
        {
          manifest: createSettingsModule({ env: { SECRETS_KEY: makeSecretsKey() }, cacheTtlMs: 0 }),
          packageJson: settingsPackage,
        },
        { manifest: blobModule, packageJson: blobPackage },
        {
          manifest: createNotificationsModule({ listen: false }),
          packageJson: notificationsPackage,
        },
        { manifest: createIdentityModule(), packageJson: identityPackage },
        { manifest: createOrganisationsModule(), packageJson },
        ...extra.map((module) => ({
          manifest: module.manifest as never,
          packageJson: module.packageJson as never,
        })),
      ],
      modulePackages: {
        'core.authz': '@scorpion/core-authz',
        'core.settings': '@scorpion/core-settings',
        'core.blob': '@scorpion/core-blob',
        'core.notifications': '@scorpion/core-notifications',
        'core.identity': '@scorpion/core-identity',
        // An optional peer of core.identity and this module (their pages): known, so its absence is not a mistake.
        'core.ui-shell': '@scorpion/core-ui-shell',
        'registry.organisations': '@scorpion/registry-organisations',
        ...Object.fromEntries(
          extra.map((module) => [module.manifest.id, String(module.packageJson.name)]),
        ),
      },
      config: loadConfig({
        DATABASE_URL: await server.createDatabase(),
        PROFILE: 'organisations-test',
      }),
      log: options.logLines
        ? createLogger({
            level: 'trace',
            destination: new Writable({
              write(chunk: Buffer, _encoding, callback) {
                options.logLines!.push(chunk.toString());
                callback();
              },
            }),
          })
        : createLogger({ level: 'silent' }),
    });
    perTest.push(kernel);
    return kernel;
  }

  return {
    server: () => server,
    build,
    async start(options) {
      const kernel = await build(options);
      await kernel.start();
      const actor: OrganisationsStarted['actor'] = async (...roles) => {
        const user = await makeUser(kernel.pool);
        for (const role of roles) await makeRoleAssignment(kernel.pool, user, role);
        return {
          kind: 'user',
          userId: user.id,
          username: user.username,
          roles: [],
          via: 'session',
        };
      };
      const service = kernel.services.get('registry.organisations') as OrganisationsService &
        MembershipsService;
      return {
        kernel,
        pool: kernel.pool,
        organisations: service,
        memberships: service,
        authz: kernel.services.get('core.authz') as AuthzService,
        actor,
        async emailOf(who) {
          const { rows } = await kernel.pool.query<{ email: string }>(
            'select email from identity_user where id = $1',
            [who.userId],
          );
          return rows[0]!.email;
        },
        async setLocale(who, locale) {
          await kernel.pool.query(
            `insert into settings_user_preference (id, user_id, key, value, updated_at)
             values ($1, $2, 'notifications.locale', $3, now())`,
            [randomUUID(), who.userId, JSON.stringify(locale)],
          );
        },
        async deliveries() {
          const { rows } = await kernel.pool.query<
            Awaited<ReturnType<OrganisationsStarted['deliveries']>>[number]
          >(
            `select template, recipient_address, recipient_user_id, locale, subject, text_body
               from notify_delivery order by created_at, id`,
          );
          return rows;
        },
        async inbox() {
          const { rows } = await kernel.pool.query<
            Awaited<ReturnType<OrganisationsStarted['inbox']>>[number]
          >(
            'select user_id, template, title, text, link from notify_inbox_item order by created_at, id',
          );
          return rows;
        },
        async configure(values) {
          const settings = kernel.services.get('core.settings') as SettingsInternalsBundle;
          const admin = await actor('admin');
          const current = await settings.settings.get(admin, 'registry.organisations');
          await settings.settings.update(admin, 'registry.organisations', {
            version: current.version,
            values,
          });
        },
        async dispatch() {
          while ((await kernel.dispatcher.dispatchOnce()) > 0) {
            // Handlers may emit more events; run until the outbox is quiet.
          }
        },
        async events() {
          const { rows } = await kernel.pool.query<{
            name: string;
            payload: Record<string, unknown>;
          }>('select name, payload from kernel_outbox order by occurred_at, id');
          return rows;
        },
      };
    },
  };
}

/**
 * A fixture module that contributes entries to the registries of registry.organisations, the way
 * M7 contributes `org.usage` and a module that needs a `funder` contributes `org.type`.
 */
export function fixtureContributor(options: {
  id?: string;
  /** Declare the dependency on registry.organisations in package.json (default true). */
  dependsOnOrganisations?: boolean;
  types?: readonly unknown[];
  usages?: readonly unknown[];
}): FixtureModule {
  const id = options.id ?? 'fixture.funders';
  const name = `@scorpion/${id.replaceAll('.', '-')}`;
  return {
    manifest: {
      id,
      version: '0.1.0',
      contributes: {
        ...(options.types && { 'org.type': options.types }),
        ...(options.usages && { 'org.usage': options.usages }),
      },
    },
    packageJson: {
      name,
      version: '0.0.0',
      dependencies:
        options.dependsOnOrganisations === false
          ? {}
          : { '@scorpion/registry-organisations': 'workspace:*' },
    },
  };
}

/** Makes the outbox refuse an insert, so the event of a write cannot be stored. Returns the undo. */
export async function breakOutbox(pool: { query(text: string): Promise<unknown> }) {
  await pool.query(`
    create or replace function test_break_outbox() returns trigger as $$
    begin raise exception 'outbox is broken for this test'; end $$ language plpgsql;
    create trigger test_break_outbox before insert on kernel_outbox
      for each row execute function test_break_outbox();`);
  return () => pool.query('drop trigger test_break_outbox on kernel_outbox');
}

/** Makes the mail queue refuse an insert, so a mail cannot be stored. Returns the undo. */
export async function breakDeliveries(pool: { query(text: string): Promise<unknown> }) {
  await pool.query(`
    create or replace function test_break_deliveries() returns trigger as $$
    begin raise exception 'the mail queue is broken for this test'; end $$ language plpgsql;
    create trigger test_break_deliveries before insert on notify_delivery
      for each row execute function test_break_deliveries();`);
  return () => pool.query('drop trigger test_break_deliveries on notify_delivery');
}

/** Makes the inbox refuse an insert (an inbox item is a second write after the mail). Returns the undo. */
export async function breakInbox(pool: { query(text: string): Promise<unknown> }) {
  await pool.query(`
    create or replace function test_break_inbox() returns trigger as $$
    begin raise exception 'the inbox is broken for this test'; end $$ language plpgsql;
    create trigger test_break_inbox before insert on notify_inbox_item
      for each row execute function test_break_inbox();`);
  return () => pool.query('drop trigger test_break_inbox on notify_inbox_item');
}
