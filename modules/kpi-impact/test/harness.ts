// Starts kpi.impact over real Postgres with the modules it depends on (authz, settings, registry.organisations, registry.services and what they
// need). The vocabularies of core.settings are the real ones; the SPDX adapter of registry.services is the stub (`NODE_ENV=test`), so no test
// reaches the network. `extra` adds fixture modules.
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
import { createKpiAnalyticsModule } from '@scorpion/kpi-analytics/module';
import kpiAnalyticsPackage from '@scorpion/kpi-analytics/package.json' with { type: 'json' };
import { createKpiFrameworkModule } from '@scorpion/kpi-framework/module';
import kpiFrameworkPackage from '@scorpion/kpi-framework/package.json' with { type: 'json' };
import type { KpiFrameworkPublic } from '@scorpion/kpi-framework/public';
import { createKpiIngestionModule, type KpiIngestionService } from '@scorpion/kpi-ingestion/module';
import ingestionPackage from '@scorpion/kpi-ingestion/package.json' with { type: 'json' };
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
import { createKpiImpactModule, type KpiImpactService } from '../module.ts';
import packageJson from '../package.json' with { type: 'json' };

/** A module that sits next to kpi.impact in a test profile. */
export interface FixtureModule {
  manifest: ModuleManifest<never, never>;
  /** Its `package.json`: the loader derives `dependsOn` from it, as for a real module. */
  packageJson: Record<string, unknown>;
}

export interface ImpactStartOptions {
  extra?: FixtureModule[];
  /** Collects every log line the kernel writes (trace level). */
  logLines?: string[];
  /** The module's "now" at start; default 2026-06-15T12:00:00Z. `s.clock.set` moves it. */
  now?: Date;
}

export interface ImpactStarted {
  kernel: Kernel;
  pool: Kernel['pool'];
  /** The service of kpi.impact. */
  impact: KpiImpactService;
  /** The framework's public surface and the measurements service, to build a KPI world. */
  kpi: KpiFrameworkPublic;
  ingestion: KpiIngestionService;
  /** The clock of kpi.impact (and of the measurements): `set` moves "now". */
  clock: { now: () => Date; set: (date: Date | string) => void };
  settings: SettingsInternalsBundle;
  /** A signed-in-looking actor for a new user who holds the given roles. */
  actor: (...roles: string[]) => Promise<UserActor>;
}

export interface ImpactHarness {
  server: () => StartedPostgres;
  start: (options?: ImpactStartOptions) => Promise<ImpactStarted>;
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
  'kpi.ingestion',
  'kpi.analytics',
  'kpi.impact',
] as const;

const DEFAULT_NOW = new Date('2026-06-15T12:00:00Z');

export function useImpact(): ImpactHarness {
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

  return {
    server: () => server,
    async start(options = {}) {
      const extra = options.extra ?? [];
      let now = options.now ?? DEFAULT_NOW;
      const clock = () => now;
      const kernel = createKernel({
        profile: {
          name: 'impact-test',
          modules: [...CORE, ...extra.map((module) => module.manifest.id)] as never,
        },
        sources: [
          { manifest: authzModule, packageJson: authzPackage },
          {
            manifest: createSettingsModule({
              env: { SECRETS_KEY: makeSecretsKey() },
              cacheTtlMs: 0,
            }),
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
          { manifest: createKpiFrameworkModule(), packageJson: kpiFrameworkPackage },
          { manifest: createKpiIngestionModule({ clock }), packageJson: ingestionPackage },
          { manifest: createKpiAnalyticsModule({ clock }), packageJson: kpiAnalyticsPackage },
          { manifest: createKpiImpactModule({ clock }), packageJson },
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
          'kpi.ingestion': '@scorpion/kpi-ingestion',
          'kpi.analytics': '@scorpion/kpi-analytics',
          'kpi.impact': '@scorpion/kpi-impact',
          ...Object.fromEntries(
            extra.map((module) => [module.manifest.id, String(module.packageJson.name)]),
          ),
        },
        config: loadConfig({
          DATABASE_URL: await server.createDatabase(),
          PROFILE: 'impact-test',
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
      await kernel.start();
      return {
        kernel,
        pool: kernel.pool,
        impact: kernel.services.get('kpi.impact') as KpiImpactService,
        kpi: kernel.services.get('kpi.framework') as KpiFrameworkPublic,
        ingestion: kernel.services.get('kpi.ingestion') as KpiIngestionService,
        clock: {
          now: clock,
          set(date) {
            now = new Date(date);
          },
        },
        settings: kernel.services.get('core.settings') as SettingsInternalsBundle,
        async actor(...roles) {
          const user = await makeUser(kernel.pool);
          for (const role of roles) await makeRoleAssignment(kernel.pool, user, role);
          return {
            kind: 'user',
            userId: user.id,
            username: user.username,
            roles: [],
            via: 'session',
          };
        },
      };
    },
  };
}
