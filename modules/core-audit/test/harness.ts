// Starts core.audit over real Postgres with the real modules it depends on (authz, settings, blob,
// notifications, identity): permissions are decided by the real authoriser, events travel through the
// real outbox. `startShared` boots one kernel per test file (CI is slow; give each test its own users
// and keys), `start` gives a test an empty database of its own.
import { randomUUID } from 'node:crypto';
import { Writable } from 'node:stream';
import type { UserActor } from '@scorpion/contracts';
import authzModule from '@scorpion/core-authz/module';
import authzPackage from '@scorpion/core-authz/package.json' with { type: 'json' };
import type { AuthzService } from '@scorpion/core-authz/public';
import blobModule from '@scorpion/core-blob/module';
import blobPackage from '@scorpion/core-blob/package.json' with { type: 'json' };
import type { IdentityInternals } from '@scorpion/core-identity/module';
import { createIdentityModule } from '@scorpion/core-identity/module';
import identityPackage from '@scorpion/core-identity/package.json' with { type: 'json' };
import { createNotificationsModule } from '@scorpion/core-notifications/module';
import notificationsPackage from '@scorpion/core-notifications/package.json' with { type: 'json' };
import orgModule from '@scorpion/registry-organisations/module';
import orgPackage from '@scorpion/registry-organisations/package.json' with { type: 'json' };
import { createSettingsModule, type SettingsInternalsBundle } from '@scorpion/core-settings/module';
import settingsPackage from '@scorpion/core-settings/package.json' with { type: 'json' };
import { createKernel, createLogger, loadConfig, type Kernel } from '@scorpion/kernel';
import {
  makeRoleAssignment,
  makeSecretsKey,
  makeSetting,
  makeUser,
  startPostgres,
  type AuditEventRow,
  type StartedPostgres,
} from '@scorpion/testing';
import { afterAll, afterEach, beforeAll } from 'vitest';
import { createAuditModule, type AuditInternals } from '../module.ts';
import packageJson from '../package.json' with { type: 'json' };

export interface AuditStartOptions {
  /** Stored settings of core.audit before start, as an administrator would have saved them. */
  auditSettings?: Record<string, unknown>;
  /** Collects every log line the kernel writes (trace level). */
  logLines?: string[];
  /** Leave core.audit out of the profile: the sink is a no-op. */
  withoutAudit?: boolean;
  /** How long core.settings trusts what it has read. Default 0 so a changed setting applies at once. */
  settingsCacheTtlMs?: number;
  /** Job tuning, for a test that starts the workers (`kernel.startWorkers()`). */
  jobs?: { pollingIntervalSeconds?: number; cronIntervalSeconds?: number };
}

export interface AuditStarted {
  kernel: Kernel;
  pool: Kernel['pool'];
  audit: AuditInternals;
  /** The manifest this kernel was built from (to call a job handler directly). */
  manifest: ReturnType<typeof createAuditModule>;
  authz: AuthzService;
  settingsStore: SettingsInternalsBundle;
  identity: IdentityInternals;
  /** A signed-in-looking actor for a new user who holds the given roles (rows in the database, so the real authoriser decides). */
  actor(...roles: string[]): Promise<UserActor>;
  /** Delivers every pending outbox event, so subscribers (the trail) have run. */
  dispatch(): Promise<void>;
  /** All rows, oldest first. */
  rows(where?: string, params?: unknown[]): Promise<AuditEventRow[]>;
}

export interface AuditHarness {
  server: () => StartedPostgres;
  start(options?: AuditStartOptions): Promise<AuditStarted>;
  /** One kernel for the whole file (settings cache off); closed after the last test. */
  startShared(options?: AuditStartOptions): Promise<AuditStarted>;
}

export function useAudit(): AuditHarness {
  let server: StartedPostgres;
  const open: Kernel[] = [];
  const perTest: Kernel[] = [];
  let shared: Promise<AuditStarted> | undefined;
  beforeAll(async () => {
    server = await startPostgres();
  }, 120_000);
  afterEach(async () => {
    await Promise.all(perTest.splice(0).map((kernel) => kernel.stop()));
  });
  afterAll(async () => {
    await Promise.all(open.splice(0).map((kernel) => kernel.stop()));
    await server?.stop();
  });

  async function start(options: AuditStartOptions = {}, owned = perTest): Promise<AuditStarted> {
    const withAudit = options.withoutAudit !== true;
    const manifest = createAuditModule();
    const kernel = createKernel({
      profile: {
        name: 'audit-test',
        modules: [
          'core.authz',
          'core.settings',
          'core.blob',
          'core.notifications',
          'core.identity',
          'registry.organisations',
          ...(withAudit ? ['core.audit'] : []),
        ] as never,
      },
      sources: [
        { manifest: authzModule, packageJson: authzPackage },
        {
          manifest: createSettingsModule({
            env: { SECRETS_KEY: makeSecretsKey() },
            cacheTtlMs: options.settingsCacheTtlMs ?? 0,
          }),
          packageJson: settingsPackage,
        },
        { manifest: blobModule, packageJson: blobPackage },
        {
          manifest: createNotificationsModule({ listen: false }),
          packageJson: notificationsPackage,
        },
        { manifest: createIdentityModule(), packageJson: identityPackage },
        // An optional peer of core.audit: its three events need a decision (decisions.test.ts).
        { manifest: orgModule, packageJson: orgPackage },
        ...(withAudit ? [{ manifest, packageJson }] : []),
      ],
      modulePackages: {
        'core.authz': '@scorpion/core-authz',
        'core.settings': '@scorpion/core-settings',
        'core.blob': '@scorpion/core-blob',
        'core.notifications': '@scorpion/core-notifications',
        'core.identity': '@scorpion/core-identity',
        // An optional peer of core.identity and core.audit (their pages): known, so that its absence is not a mistake.
        'core.ui-shell': '@scorpion/core-ui-shell',
        'registry.organisations': '@scorpion/registry-organisations',
        'core.audit': '@scorpion/core-audit',
      },
      config: loadConfig({
        DATABASE_URL: await server.createDatabase(),
        PROFILE: 'audit-test',
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
      jobs: options.jobs,
    });
    owned.push(kernel);
    if (options.auditSettings) {
      await kernel.migrate();
      await makeSetting(kernel.pool, 'core.audit', options.auditSettings);
    }
    await kernel.start();

    return {
      kernel,
      pool: kernel.pool,
      audit: kernel.services.get('core.audit') as AuditInternals,
      manifest,
      authz: kernel.services.get('core.authz') as AuthzService,
      settingsStore: kernel.services.get('core.settings') as SettingsInternalsBundle,
      identity: kernel.services.get('core.identity') as IdentityInternals,
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
      async dispatch() {
        while ((await kernel.dispatcher.dispatchOnce()) > 0) {
          // Handlers may emit more events; run until the outbox is quiet.
        }
      },
      async rows(where, params = []) {
        const { rows } = await kernel.pool.query<AuditEventRow>(
          `select * from audit_event ${where ? `where ${where}` : ''} order by occurred_at, id`,
          params,
        );
        return rows;
      },
    };
  }

  return {
    server: () => server,
    start: (options) => start(options),
    startShared(options) {
      shared ??= start(options, open);
      return shared;
    },
  };
}

/** A UUID that no user has: an actor id "kept as written". */
export const unknownId = () => randomUUID();
