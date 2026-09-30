// Shared by the kernel's integration tests.
import { startPostgres, type StartedPostgres } from '@scorpion/testing';
import { afterAll, afterEach, beforeAll } from 'vitest';
import { loadConfig } from '../src/config.ts';
import { createKernel, type Kernel, type KernelOptions } from '../src/kernel.ts';
import { createLogger } from '../src/logger.ts';
import type { ModuleManifest } from '../src/manifest.ts';
import type { ModuleSource } from '../src/resolve.ts';
import { allFixtureSources, FIXTURE_MODULE_PACKAGES, fixtureProfile } from './fixtures/index.ts';

export interface TestKernels {
  server: () => StartedPostgres;
  /** A kernel over a fixture profile. `databaseUrl` reuses a database (a second "process"). */
  fixture: (profileName: string, options?: TestKernelOptions) => Promise<Kernel>;
  /** A kernel over inline manifests; `requires` lists package dependencies per module id. */
  inline: (
    manifests: ModuleManifest[],
    requires?: Record<string, string[]>,
    options?: TestKernelOptions,
  ) => Promise<Kernel>;
  newDatabase: () => Promise<string>;
}

export type TestKernelOptions = Partial<Pick<KernelOptions, 'dispatcher' | 'jobs'>> & {
  databaseUrl?: string;
};

/** Starts one Postgres container for the file and closes every kernel a test created. */
export function useKernels(): TestKernels {
  let server: StartedPostgres;
  const open: Kernel[] = [];
  let sources: ModuleSource[] | undefined;

  beforeAll(async () => {
    server = await startPostgres();
  }, 120_000);
  afterEach(async () => {
    await Promise.all(open.splice(0).map((kernel) => kernel.stop()));
  });
  afterAll(async () => {
    await server?.stop();
  });

  const databaseUrl = async (options?: TestKernelOptions) =>
    options?.databaseUrl ?? (await server.createDatabase());

  return {
    server: () => server,
    newDatabase: () => server.createDatabase(),
    async fixture(profileName, options) {
      sources ??= await allFixtureSources();
      const kernel = createKernel({
        profile: await fixtureProfile(profileName),
        sources,
        modulePackages: FIXTURE_MODULE_PACKAGES,
        config: loadConfig({ DATABASE_URL: await databaseUrl(options) }),
        log: createLogger({ level: 'silent' }),
        dispatcher: options?.dispatcher,
        jobs: options?.jobs,
      });
      open.push(kernel);
      return kernel;
    },
    async inline(manifests, requires = {}, options) {
      const modulePackages: Record<string, string> = {};
      const inlineSources: ModuleSource[] = manifests.map((manifest) => {
        const name = `@scorpion/${manifest.id.replaceAll('.', '-')}`;
        modulePackages[manifest.id] = name;
        return {
          manifest,
          packageJson: {
            name,
            dependencies: Object.fromEntries(
              (requires[manifest.id] ?? []).map((id) => [
                `@scorpion/${id.replaceAll('.', '-')}`,
                '*',
              ]),
            ),
          },
        };
      });
      const kernel = createKernel({
        profile: { name: 'inline', modules: manifests.map((m) => m.id) },
        sources: inlineSources,
        modulePackages,
        config: loadConfig({ DATABASE_URL: await databaseUrl(options) }),
        log: createLogger({ level: 'silent' }),
        dispatcher: options?.dispatcher,
        jobs: options?.jobs,
      });
      open.push(kernel);
      return kernel;
    },
  };
}
