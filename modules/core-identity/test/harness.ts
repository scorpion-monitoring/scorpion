// Starts core.identity over real Postgres, as the kernel guide describes ("Testing a module").
import { createKernel, createLogger, loadConfig, type Kernel } from '@scorpion/kernel';
import type { ModuleManifest } from '@scorpion/kernel';
import { startPostgres, type StartedPostgres } from '@scorpion/testing';
import { afterAll, afterEach, beforeAll } from 'vitest';
import { createIdentityModule, type IdentityInternals } from '../module.ts';
import packageJson from '../package.json' with { type: 'json' };
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
  /** Where an OIDC client secret comes from (default: the environment). */
  clientSecret?: (providerId: string) => string | undefined;
  /** The HTTP client and timeouts used to talk to OIDC providers. */
  oidcHttp?: {
    fetch?: typeof fetch;
    timeoutMs?: number;
    exchangeTimeoutMs?: number;
    now?: () => number;
  };
  /** Environment variables for the kernel's config (BASE_PATH, ORIGIN, ...). */
  env?: Record<string, string>;
  /** Another module of the profile that depends on core.identity, for example a policy contributor. */
  extraModule?: { manifest: ModuleManifest; id: string };
}

export interface IdentityHarness {
  server: () => StartedPostgres;
  /** A migrated kernel on a database of its own; closed after the test. */
  start: (options?: StartOptions) => Promise<{
    kernel: Kernel;
    identity: IdentityInternals;
    /** The manifest this kernel was built from. */
    manifest: ReturnType<typeof createIdentityModule>;
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
        clientSecret: options?.clientSecret,
        oidcHttp: options?.oidcHttp,
      });
      const extra = options?.extraModule;
      const kernel = createKernel({
        profile: {
          name: 'identity-test',
          modules: ['core.identity', ...(extra ? [extra.id] : [])] as never,
        },
        sources: [
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
          'core.identity': '@scorpion/core-identity',
          ...(extra ? { [extra.id]: `@scorpion/${extra.id.replaceAll('.', '-')}` } : {}),
        },
        config: loadConfig({
          DATABASE_URL: options?.databaseUrl ?? (await server.createDatabase()),
          PROFILE: 'identity-test',
          ...options?.env,
        }),
        log: createLogger({ level: 'silent' }),
      });
      open.push(kernel);
      await kernel.start();
      return {
        kernel,
        identity: kernel.services.get('core.identity') as IdentityInternals,
        manifest,
      };
    },
  };
}
