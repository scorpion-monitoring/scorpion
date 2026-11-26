// Starts bibliometrics over real Postgres with the modules it depends on (core.authz, registry.services, kpi.framework,
// kpi.ingestion and what they need) and core.audit, so the audit entries of the service are real rows. The DOI resolver is a stub given per start; the
// network is never reached. `world()` builds a service of one provider and the people the policy has to tell apart.
import type { UserActor } from '@scorpion/contracts';
import { createAuditModule } from '@scorpion/core-audit/module';
import auditPackage from '@scorpion/core-audit/package.json' with { type: 'json' };
import authzModule from '@scorpion/core-authz/module';
import authzPackage from '@scorpion/core-authz/package.json' with { type: 'json' };
import blobModule from '@scorpion/core-blob/module';
import blobPackage from '@scorpion/core-blob/package.json' with { type: 'json' };
import { createIdentityModule } from '@scorpion/core-identity/module';
import identityPackage from '@scorpion/core-identity/package.json' with { type: 'json' };
import { createNotificationsModule } from '@scorpion/core-notifications/module';
import notificationsPackage from '@scorpion/core-notifications/package.json' with { type: 'json' };
import { createSettingsModule } from '@scorpion/core-settings/module';
import settingsPackage from '@scorpion/core-settings/package.json' with { type: 'json' };
import { Writable } from 'node:stream';
import {
  createStubDoiResolver,
  createStubOpenAlex,
  type DoiResolver,
  type OpenAlex,
} from '@scorpion/integrations';
import {
  createKernel,
  createLogger,
  loadConfig,
  type Kernel,
  type ModuleManifest,
} from '@scorpion/kernel';
import { createKpiFrameworkModule } from '@scorpion/kpi-framework/module';
import kpiFrameworkPackage from '@scorpion/kpi-framework/package.json' with { type: 'json' };
import { createKpiIngestionModule } from '@scorpion/kpi-ingestion/module';
import kpiIngestionPackage from '@scorpion/kpi-ingestion/package.json' with { type: 'json' };
import { createOrganisationsModule } from '@scorpion/registry-organisations/module';
import organisationsPackage from '@scorpion/registry-organisations/package.json' with { type: 'json' };
import servicesModule from '@scorpion/registry-services/module';
import servicesPackage from '@scorpion/registry-services/package.json' with { type: 'json' };
import {
  makeMembership,
  makeOrganisation,
  makeRoleAssignment,
  makeSecret,
  makeSecretsKey,
  makeService,
  makeSetting,
  makeUser,
  startPostgres,
  type MakeMembership,
  type StartedPostgres,
} from '@scorpion/testing';
import { afterAll, afterEach, beforeAll } from 'vitest';
import { createBibliometricsModule, type BibliometricsService } from '../module.ts';
import packageJson from '../package.json' with { type: 'json' };

/** A module that sits next to bibliometrics in a test profile (a second citation source). */
export interface FixtureModule {
  manifest: ModuleManifest<never, never>;
  /** Its `package.json`: the loader derives `dependsOn` from it, as for a real module. */
  packageJson: Record<string, unknown>;
}

export interface BiblioStartOptions {
  /** Default: a stub that knows no DOI (every lookup is `not-found`). */
  resolver?: DoiResolver;
  /** The OpenAlex adapter for a key. Default: a stub that knows no DOI. */
  openAlex?: (apiKey: string | undefined) => OpenAlex;
  /** "Now" of the module, and of kpi.ingestion (the month a value may not pass). Default: the system clock. */
  clock?: () => Date;
  /** Stored settings of the module, written before it starts. */
  settings?: Record<string, unknown>;
  /** Secrets (name → value), stored encrypted before the module starts. */
  secrets?: Record<string, string>;
  extra?: FixtureModule[];
  /** Collects every log line the kernel writes (trace level). */
  logLines?: string[];
}

export interface BiblioStarted {
  kernel: Kernel;
  pool: Kernel['pool'];
  biblio: BibliometricsService;
  /** The manifest the kernel runs, for its `demoSeed`. */
  manifest: ReturnType<typeof createBibliometricsModule>;
  /** A signed-in-looking actor for a new user who holds the given roles. */
  actor: (...roles: string[]) => Promise<UserActor>;
}

const MODULES = [
  'core.authz',
  'core.settings',
  'core.blob',
  'core.notifications',
  'core.identity',
  'core.audit',
  'registry.organisations',
  'registry.services',
  'kpi.framework',
  'kpi.ingestion',
  'bibliometrics',
] as const;

export function useBibliometrics() {
  let server: StartedPostgres;
  const open: Kernel[] = [];
  beforeAll(async () => {
    server = await startPostgres();
  }, 120_000);
  afterEach(async () => {
    await Promise.all(open.splice(0).map((kernel) => kernel.stop()));
  });
  afterAll(async () => {
    await server?.stop();
  });

  return {
    server: () => server,
    async start(options: BiblioStartOptions = {}): Promise<BiblioStarted> {
      const manifest = createBibliometricsModule({
        resolver: options.resolver ?? createStubDoiResolver(),
        openAlex: options.openAlex ?? (() => createStubOpenAlex()),
        ...(options.clock ? { clock: options.clock } : {}),
      });
      const extra = options.extra ?? [];
      const secretsKey = makeSecretsKey();
      const kernel = createKernel({
        profile: {
          name: 'biblio-test',
          modules: [...MODULES, ...extra.map((module) => module.manifest.id)] as never,
        },
        sources: [
          { manifest: authzModule, packageJson: authzPackage },
          {
            manifest: createSettingsModule({
              env: { SECRETS_KEY: secretsKey },
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
          { manifest: createAuditModule(), packageJson: auditPackage },
          { manifest: createOrganisationsModule(), packageJson: organisationsPackage },
          { manifest: servicesModule, packageJson: servicesPackage },
          { manifest: createKpiFrameworkModule(), packageJson: kpiFrameworkPackage },
          {
            manifest: createKpiIngestionModule(options.clock ? { clock: options.clock } : {}),
            packageJson: kpiIngestionPackage,
          },
          { manifest, packageJson },
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
          'core.audit': '@scorpion/core-audit',
          // Optional peers of modules in this profile: known, so their absence is not a mistake.
          'core.ui-shell': '@scorpion/core-ui-shell',
          'kpi.framework': '@scorpion/kpi-framework',
          'kpi.ingestion': '@scorpion/kpi-ingestion',
          'registry.organisations': '@scorpion/registry-organisations',
          'registry.services': '@scorpion/registry-services',
          bibliometrics: '@scorpion/bibliometrics',
          ...Object.fromEntries(
            extra.map((module) => [module.manifest.id, String(module.packageJson.name)]),
          ),
        },
        config: loadConfig({ DATABASE_URL: await server.createDatabase(), PROFILE: 'biblio-test' }),
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
      open.push(kernel);
      if (options.settings || options.secrets) {
        await kernel.migrate();
        if (options.settings) await makeSetting(kernel.pool, 'bibliometrics', options.settings);
        for (const [name, value] of Object.entries(options.secrets ?? {}))
          await makeSecret(kernel.pool, { name, value, key: secretsKey });
      }
      await kernel.start();
      return {
        kernel,
        pool: kernel.pool,
        biblio: kernel.services.get('bibliometrics') as BibliometricsService,
        manifest,
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

/** A service of one provider, a service of another, and the people the write policy has to tell apart. */
export async function world(s: BiblioStarted) {
  const provider = await makeOrganisation(s.pool, { type: 'provider' });
  const other = await makeOrganisation(s.pool, { type: 'provider' });
  const svc = await makeService(s.pool, { provider: provider.id });
  const elsewhereSvc = await makeService(s.pool, { provider: other.id });
  const people = {
    admin: await s.actor('admin'),
    manager: await s.actor('user'),
    member: await s.actor('user'),
    requested: await s.actor('user'),
    left: await s.actor('user'),
    elsewhere: await s.actor('user'),
    plain: await s.actor('user'),
  };
  const join = (
    who: UserActor,
    organisationId: string,
    state: MakeMembership['state'],
    role: MakeMembership['role'] = 'member',
  ) => makeMembership(s.pool, { organisationId, userId: who.userId, state, role });
  await join(people.manager, provider.id, 'approved', 'manager');
  await join(people.member, provider.id, 'approved');
  await join(people.requested, provider.id, 'requested');
  await join(people.left, provider.id, 'left');
  await join(people.elsewhere, other.id, 'approved');
  return { ...s, svc, elsewhereSvc, people };
}

let counter = 0;
/** A DOI no other test uses (specs may share a database). */
export const uniqueDoi = (label = 't') =>
  `10.5555/${label}-${++counter}-${Math.random().toString(36).slice(2, 8)}`;

interface Queryable {
  query<R = unknown>(text: string, values?: unknown[]): Promise<{ rows: R[] }>;
}

/** The number of rows of a table that match `where` (a fixed SQL text with `$n` parameters). */
export async function countRows(
  pool: Queryable,
  table:
    | 'biblio_publication'
    | 'biblio_doi_metadata'
    | 'biblio_citation_run'
    | 'biblio_citation_snapshot',
  where = 'true',
  values: unknown[] = [],
): Promise<number> {
  const { rows } = await pool.query<{ n: number }>(
    `select count(*)::int as n from ${table} where ${where}`,
    values,
  );
  return rows[0]!.n;
}
