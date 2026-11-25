// Starts bibliometrics over real Postgres with the modules it depends on (core.authz, registry.services and what they need)
// and core.audit, so the audit entries of the service are real rows. The DOI resolver is a stub given per start; the
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
import { createStubDoiResolver, type DoiResolver } from '@scorpion/integrations';
import { createKernel, createLogger, loadConfig, type Kernel } from '@scorpion/kernel';
import { createOrganisationsModule } from '@scorpion/registry-organisations/module';
import organisationsPackage from '@scorpion/registry-organisations/package.json' with { type: 'json' };
import servicesModule from '@scorpion/registry-services/module';
import servicesPackage from '@scorpion/registry-services/package.json' with { type: 'json' };
import {
  makeMembership,
  makeOrganisation,
  makeRoleAssignment,
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

export interface BiblioStartOptions {
  /** Default: a stub that knows no DOI (every lookup is `not-found`). */
  resolver?: DoiResolver;
  /** Stored settings of the module, written before it starts. */
  settings?: Record<string, unknown>;
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
      });
      const kernel = createKernel({
        profile: { name: 'biblio-test', modules: [...MODULES] as never },
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
          { manifest: createAuditModule(), packageJson: auditPackage },
          { manifest: createOrganisationsModule(), packageJson: organisationsPackage },
          { manifest: servicesModule, packageJson: servicesPackage },
          { manifest, packageJson },
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
          'registry.organisations': '@scorpion/registry-organisations',
          'registry.services': '@scorpion/registry-services',
          bibliometrics: '@scorpion/bibliometrics',
        },
        config: loadConfig({ DATABASE_URL: await server.createDatabase(), PROFILE: 'biblio-test' }),
        log: createLogger({ level: 'silent' }),
      });
      open.push(kernel);
      if (options.settings) {
        await kernel.migrate();
        await makeSetting(kernel.pool, 'bibliometrics', options.settings);
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
  table: 'biblio_publication' | 'biblio_doi_metadata' | 'audit_event',
  where = 'true',
  values: unknown[] = [],
): Promise<number> {
  const { rows } = await pool.query<{ n: number }>(
    `select count(*)::int as n from ${table} where ${where}`,
    values,
  );
  return rows[0]!.n;
}
