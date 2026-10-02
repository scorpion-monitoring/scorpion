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
