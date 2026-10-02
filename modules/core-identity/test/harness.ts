// Starts core.identity over real Postgres, as the kernel guide describes ("Testing a module"),
// together with the real core.authz it depends on: permissions are decided by the real authoriser,
// from roles in the database, never by a stand-in.
import type { UserActor } from '@scorpion/contracts';
import authzModule from '@scorpion/core-authz/module';
import authzPackage from '@scorpion/core-authz/package.json' with { type: 'json' };
import type { AuthzService } from '@scorpion/core-authz/public';
import { createSettingsModule, type SettingsInternalsBundle } from '@scorpion/core-settings/module';
import settingsPackage from '@scorpion/core-settings/package.json' with { type: 'json' };
import { createKernel, createLogger, loadConfig, type Kernel } from '@scorpion/kernel';
import type { ModuleManifest } from '@scorpion/kernel';
import {
  makeRoleAssignment,
  makeSecretsKey,
  makeUser,
  startPostgres,
  type StartedPostgres,
} from '@scorpion/testing';
import { Writable } from 'node:stream';
import { afterAll, afterEach, beforeAll } from 'vitest';
import { createIdentityModule, type IdentityInternals } from '../module.ts';
import packageJson from '../package.json' with { type: 'json' };
import type { Mailer } from '../service/mailer.ts';
import type { IdentitySettings } from '../service/settings.ts';

export interface StartOptions {
  databaseUrl?: string;
  /** Replaces the default settings (the defaults of the schema). */
  settings?: IdentitySettings;
  /** How long a verified session is trusted without asking the database. */
  sessionCacheTtlMs?: number;
  /** How long a verified access token is trusted without verifying it again. */
  tokenCacheTtlMs?: number;
  /** Where the first-run token is shown; the default shows nothing under test. */
  announce?: (text: string) => void;
  firstRunTtlMs?: number;
  /** Where mail goes (default: nowhere; the module refuses to send without SMTP_URL). */
  mailer?: Mailer;
  /** Where an OIDC client secret comes from (default: the environment). */
  clientSecret?: (providerId: string) => string | undefined;
  /** The HTTP client and timeouts used to talk to OIDC providers. */
  oidcHttp?: {
    fetch?: typeof fetch;
    timeoutMs?: number;
    exchangeTimeoutMs?: number;
    now?: () => number;
  };
  /** Job tuning: how often workers poll and the cron schedule is checked. */
  jobs?: { pollingIntervalSeconds?: number; cronIntervalSeconds?: number };
  /** Environment variables for the kernel's config (BASE_PATH, ORIGIN, ...). */
  env?: Record<string, string>;
  /** Collects every log line the kernel writes (trace level), to check what the log holds. */
  logLines?: string[];
  /** `SECRETS_KEY` of the core.settings in the profile (default: a new random key). */
  secretsKey?: string;
  /** How long core.settings trusts the settings it has read (default: its own, 5 s). */
  settingsCacheTtlMs?: number;
  /** Another module of the profile that depends on core.identity, for example a policy contributor. */
  extraModule?: { manifest: ModuleManifest; id: string };
}

export interface IdentityHarness {
  server: () => StartedPostgres;
  /** A migrated kernel on a database of its own; closed after the test. */
  start: (options?: StartOptions) => Promise<{
    kernel: Kernel;
    identity: IdentityInternals;
    /** The public service of core.authz in this kernel. */
    authz: AuthzService;
    /** core.settings in this kernel: the settings, secrets and preferences services. */
    settingsStore: SettingsInternalsBundle;
    /** The manifest this kernel was built from. */
    manifest: ReturnType<typeof createIdentityModule>;
    /**
     * A session actor for `user` who holds the given roles (default `user`, the role an approved
     * account gets). The roles are rows in the database, so the real authoriser decides.
     */
    actorOf: (user: { id: string; username: string }, ...roles: string[]) => Promise<UserActor>;
  }>;
}

/** One Postgres container per test file; every `start()` gets an empty database. */
export function useIdentity(): IdentityHarness {
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
    async start(options) {
      const manifest = createIdentityModule({
        settings: options?.settings,
        sessionCacheTtlMs: options?.sessionCacheTtlMs,
        tokenCacheTtlMs: options?.tokenCacheTtlMs,
        announce: options?.announce,
        firstRunTtlMs: options?.firstRunTtlMs,
        mailer: options?.mailer,
        clientSecret: options?.clientSecret,
        oidcHttp: options?.oidcHttp,
      });
      const extra = options?.extraModule;
      const kernel = createKernel({
        profile: {
          name: 'identity-test',
          modules: [
            'core.authz',
            'core.settings',
            'core.identity',
            ...(extra ? [extra.id] : []),
          ] as never,
        },
        sources: [
          { manifest: authzModule, packageJson: authzPackage },
          {
            manifest: createSettingsModule({
              env: { SECRETS_KEY: options?.secretsKey ?? makeSecretsKey() },
              cacheTtlMs: options?.settingsCacheTtlMs,
            }),
            packageJson: settingsPackage,
          },
          { manifest, packageJson },
          ...(extra
            ? [
                {
                  manifest: extra.manifest,
                  packageJson: {
                    name: `@scorpion/${extra.id.replaceAll('.', '-')}`,
                    dependencies: { '@scorpion/core-identity': 'workspace:*' },
                  },
                },
              ]
            : []),
        ],
        modulePackages: {
          'core.authz': '@scorpion/core-authz',
          'core.settings': '@scorpion/core-settings',
          'core.identity': '@scorpion/core-identity',
          ...(extra ? { [extra.id]: `@scorpion/${extra.id.replaceAll('.', '-')}` } : {}),
        },
        config: loadConfig({
          DATABASE_URL: options?.databaseUrl ?? (await server.createDatabase()),
          PROFILE: 'identity-test',
          ...options?.env,
        }),
        log: options?.logLines
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
        jobs: options?.jobs,
      });
      open.push(kernel);
      await kernel.start();
      return {
        kernel,
        identity: kernel.services.get('core.identity') as IdentityInternals,
        authz: kernel.services.get('core.authz') as AuthzService,
        settingsStore: kernel.services.get('core.settings') as SettingsInternalsBundle,
        manifest,
        async actorOf(user, ...roles) {
          for (const role of roles.length > 0 ? roles : ['user']) {
            await makeRoleAssignment(kernel.pool, user, role);
          }
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

/**
 * A user who holds the role `user`, as an approved account does: the one the self-service routes
 * need. Call it after `start()`, which seeds the roles. `makeUser` makes one with no role at all.
 */
export async function makeMember(
  pool: Parameters<typeof makeUser>[0],
  overrides?: Parameters<typeof makeUser>[1],
) {
  const made = await makeUser(pool, overrides);
  await makeRoleAssignment(pool, made, 'user');
  return made;
}
