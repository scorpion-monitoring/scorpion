// Starts registry.services over real Postgres with the real modules it depends on (authz, settings, blob,
// notifications, identity, organisations): permissions are decided by the real authoriser, events travel
// through the real outbox. `extra` adds fixture modules next to it (a contributor of a field type, a step,
// an organisation role or a facet). `start` gives a test an empty database of its own.
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
import type { Spdx } from '@scorpion/integrations';
import {
  createKernel,
  createLogger,
  loadConfig,
  type Kernel,
  type ModuleManifest,
} from '@scorpion/kernel';
import { createOrganisationsModule } from '@scorpion/registry-organisations/module';
import organisationsPackage from '@scorpion/registry-organisations/package.json' with { type: 'json' };
import {
  makeRoleAssignment,
  makeSecretsKey,
  makeUser,
  startPostgres,
  type StartedPostgres,
} from '@scorpion/testing';
import { afterAll, afterEach, beforeAll } from 'vitest';
import type { ServicesConfig } from '../config/types.ts';
import { createServicesModule, type RegistryServicesService } from '../module.ts';
import packageJson from '../package.json' with { type: 'json' };

/** A module that sits next to registry.services in a test profile. */
export interface FixtureModule {
  manifest: ModuleManifest<never, never>;
  /** Its `package.json`: the loader derives `dependsOn` from it, as for a real module. */
  packageJson: Record<string, unknown>;
}

export interface ServicesStartOptions {
  extra?: FixtureModule[];
  /** Replaces the shipped `config/fields.ts` and `config/steps.ts`. */
  config?: ServicesConfig;
  spdx?: Spdx;
  /** Overrides whether the create schema offers the JSON console (default: not in production). */
  devConsole?: boolean;
  /** Collects every log line the kernel writes (trace level). */
  logLines?: string[];
}

export interface ServicesStarted {
  kernel: Kernel;
  pool: Kernel['pool'];
  services: RegistryServicesService;
  authz: AuthzService;
  /** A signed-in-looking actor for a new user who holds the given roles (rows in the database, so the real authoriser decides). */
  actor: (...roles: string[]) => Promise<UserActor>;
  /** Saves the settings of registry.services (the whole object) as an administrator would. */
  configure: (values: Record<string, unknown>) => Promise<void>;
  /** Delivers every pending outbox event. */
  dispatch: () => Promise<void>;
  /** The events in the outbox (name and payload), oldest first. */
  events: () => Promise<{ name: string; payload: Record<string, unknown> }[]>;
}

export interface ServicesHarness {
  server: () => StartedPostgres;
  start: (options?: ServicesStartOptions) => Promise<ServicesStarted>;
  /** The kernel that `start` would build, without starting it (for a test that expects a failure). */
  build: (options?: ServicesStartOptions) => Promise<Kernel>;
}

const CORE = [
  'core.authz',
  'core.settings',
  'core.blob',
  'core.notifications',
  'core.identity',
  'registry.organisations',
  'registry.services',
] as const;

export function useServices(): ServicesHarness {
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

  async function build(options: ServicesStartOptions = {}): Promise<Kernel> {
    const extra = options.extra ?? [];
    const kernel = createKernel({
      profile: {
        name: 'services-test',
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
        { manifest: createOrganisationsModule(), packageJson: organisationsPackage },
        {
          manifest: createServicesModule({
            ...(options.config && { config: options.config }),
            ...(options.spdx && { spdx: options.spdx }),
            ...(options.devConsole !== undefined && { devConsole: options.devConsole }),
          }),
          packageJson,
        },
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
        // An optional peer of core.identity and these modules (their pages): known, so its absence is not a mistake.
        'core.ui-shell': '@scorpion/core-ui-shell',
        // The optional peer that observes the events: absent in this profile.
        'core.audit': '@scorpion/core-audit',
        'registry.organisations': '@scorpion/registry-organisations',
        'registry.services': '@scorpion/registry-services',
        'kpi.framework': '@scorpion/kpi-framework',
        ...Object.fromEntries(
          extra.map((module) => [module.manifest.id, String(module.packageJson.name)]),
        ),
      },
      config: loadConfig({
        DATABASE_URL: await server.createDatabase(),
        PROFILE: 'services-test',
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
      const actor: ServicesStarted['actor'] = async (...roles) => {
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
      return {
        kernel,
        pool: kernel.pool,
        services: kernel.services.get('registry.services') as RegistryServicesService,
        authz: kernel.services.get('core.authz') as AuthzService,
        actor,
        async configure(values) {
          const settings = kernel.services.get('core.settings') as SettingsInternalsBundle;
          const admin = await actor('admin');
          const current = await settings.settings.get(admin, 'registry.services');
          await settings.settings.update(admin, 'registry.services', {
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
 * A fixture module that contributes entries to the registries of registry.services, the way `kpi.framework`
 * (M9) will: a field type, a wizard step, an organisation role and a facet, with an `org.type` of its own.
 */
export function fixtureContributor(options: {
  id?: string;
  /** Declare the dependency on registry.services in package.json (default true). */
  dependsOnServices?: boolean;
  contributes: Record<string, readonly unknown[]>;
}): FixtureModule {
  const id = options.id ?? 'fixture.extras';
  const name = `@scorpion/${id.replaceAll('.', '-')}`;
  return {
    manifest: { id, version: '0.1.0', contributes: options.contributes },
    packageJson: {
      name,
      version: '0.0.0',
      dependencies:
        options.dependsOnServices === false
          ? {}
          : {
              '@scorpion/registry-services': 'workspace:*',
              '@scorpion/registry-organisations': 'workspace:*',
            },
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
