// Starts kpi.framework over real Postgres with the modules it depends on (settings, the registry modules). The
// vocabularies of core.settings are the real ones, so a `usage` check and a `validateTerm` run as in production.
// `extra` adds fixture modules next to it (a contributor of a value type, a table with the wrong prefix).
import { Writable } from 'node:stream';
import type { UserActor } from '@scorpion/contracts';
import authzModule from '@scorpion/core-authz/module';
import authzPackage from '@scorpion/core-authz/package.json' with { type: 'json' };
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
import { createOrganisationsModule } from '@scorpion/registry-organisations/module';
import organisationsPackage from '@scorpion/registry-organisations/package.json' with { type: 'json' };
import servicesModule from '@scorpion/registry-services/module';
import servicesPackage from '@scorpion/registry-services/package.json' with { type: 'json' };
import {
  makeRoleAssignment,
  makeSecretsKey,
  makeUser,
  startPostgres,
  type StartedPostgres,
} from '@scorpion/testing';
import { afterAll, afterEach, beforeAll } from 'vitest';
import { createKpiFrameworkModule, type KpiFrameworkService } from '../module.ts';
import packageJson from '../package.json' with { type: 'json' };

/** A module that sits next to kpi.framework in a test profile. */
export interface FixtureModule {
  manifest: ModuleManifest<never, never>;
  /** Its `package.json`: the loader derives `dependsOn` from it, as for a real module. */
  packageJson: Record<string, unknown>;
}

export interface KpiStartOptions {
  extra?: FixtureModule[];
  /** Collects every log line the kernel writes (trace level). */
  logLines?: string[];
}

export interface KpiStarted {
  kernel: Kernel;
  pool: Kernel['pool'];
  kpi: KpiFrameworkService;
  settings: SettingsInternalsBundle;
  /** A signed-in-looking actor for a new user who holds the given roles. */
  actor: (...roles: string[]) => Promise<UserActor>;
  /** Saves the settings of kpi.framework (the whole object) as an administrator would. */
  configure: (values: Record<string, unknown>) => Promise<void>;
  /** Delivers every pending outbox event. */
  dispatch: () => Promise<void>;
}

export interface KpiHarness {
  server: () => StartedPostgres;
  start: (options?: KpiStartOptions) => Promise<KpiStarted>;
  /** The kernel that `start` would build, without starting it (for a test that expects a failure). */
  build: (options?: KpiStartOptions) => Promise<Kernel>;
}

const CORE = [
  'core.authz',
  'core.settings',
  'core.blob',
  'core.notifications',
  'core.identity',
  'registry.organisations',
  'registry.services',
  'kpi.framework',
] as const;

export function useKpi(): KpiHarness {
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

  async function build(options: KpiStartOptions = {}): Promise<Kernel> {
    const extra = options.extra ?? [];
    const kernel = createKernel({
      profile: {
        name: 'kpi-test',
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
        { manifest: servicesModule, packageJson: servicesPackage },
        { manifest: createKpiFrameworkModule(), packageJson },
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
        // Optional peers of modules in this profile: known, so their absence is not a mistake.
        'core.ui-shell': '@scorpion/core-ui-shell',
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
        PROFILE: 'kpi-test',
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
      const actor: KpiStarted['actor'] = async (...roles) => {
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
      const settings = kernel.services.get('core.settings') as SettingsInternalsBundle;
      return {
        kernel,
        pool: kernel.pool,
        kpi: kernel.services.get('kpi.framework') as KpiFrameworkService,
        settings,
        actor,
        async configure(values) {
          const admin = await actor('admin');
          const current = await settings.settings.get(admin, 'kpi.framework');
          await settings.settings.update(admin, 'kpi.framework', {
            version: current.version,
            values,
          });
        },
        async dispatch() {
          while ((await kernel.dispatcher.dispatchOnce()) > 0) {
            // Handlers may emit more events; run until the outbox is quiet.
          }
        },
      };
    },
  };
}

/** A fixture module that contributes entries to registries of kpi.framework, the way `kpi.ingestion` will. */
export function fixtureContributor(options: {
  id?: string;
  contributes: Record<string, readonly unknown[]>;
}): FixtureModule {
  const id = options.id ?? 'fixture.kpi-extras';
  return {
    manifest: { id, version: '0.1.0', contributes: options.contributes },
    packageJson: {
      name: `@scorpion/${id.replaceAll('.', '-')}`,
      version: '0.0.0',
      dependencies: { '@scorpion/kpi-framework': 'workspace:*' },
    },
  };
}
