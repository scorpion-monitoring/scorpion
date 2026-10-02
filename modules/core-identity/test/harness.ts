// Starts core.identity over real Postgres, as the kernel guide describes ("Testing a module").
import { createKernel, createLogger, loadConfig, type Kernel } from '@scorpion/kernel';
import { startPostgres, type StartedPostgres } from '@scorpion/testing';
import { afterAll, afterEach, beforeAll } from 'vitest';
import manifest from '../module.ts';
import packageJson from '../package.json' with { type: 'json' };
import type { IdentityService } from '../public.ts';

export interface IdentityHarness {
  server: () => StartedPostgres;
  /** A migrated kernel on a database of its own; closed after the test. */
  start: (options?: {
    databaseUrl?: string;
  }) => Promise<{ kernel: Kernel; identity: IdentityService }>;
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
      return { kernel, identity: kernel.services.get('core.identity') as IdentityService };
    },
  };
}
