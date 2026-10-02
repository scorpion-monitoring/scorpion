// Starts core.identity over real Postgres, as the kernel guide describes ("Testing a module").
import { createKernel, createLogger, loadConfig, type Kernel } from '@scorpion/kernel';
import { startPostgres, type StartedPostgres } from '@scorpion/testing';
import { afterAll, afterEach, beforeAll } from 'vitest';
import { createIdentityModule, type IdentityInternals } from '../module.ts';
import packageJson from '../package.json' with { type: 'json' };

export interface StartOptions {
  databaseUrl?: string;
  /** How long a verified session is trusted without asking the database. */
  sessionCacheTtlMs?: number;
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
      const manifest = createIdentityModule({ sessionCacheTtlMs: options?.sessionCacheTtlMs });
      const kernel = createKernel({
        profile: { name: 'identity-test', modules: ['core.identity'] },
        sources: [{ manifest, packageJson }],
        modulePackages: { 'core.identity': '@scorpion/core-identity' },
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
