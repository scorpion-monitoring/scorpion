// Starts core.authz over real Postgres, as the kernel guide describes ("Testing a module"), with
// optional fixture modules that declare permissions and contribute to the authz registries.
import {
  createKernel,
  createLogger,
  defineModule,
  loadConfig,
  type Kernel,
  type ModuleManifest,
} from '@scorpion/kernel';
import { startPostgres, type StartedPostgres } from '@scorpion/testing';
import { Writable } from 'node:stream';
import { afterAll, afterEach, beforeAll } from 'vitest';
import { createAuthzModule, type AuthzInternals, type AuthzModuleOptions } from '../module.ts';
import packageJson from '../package.json' with { type: 'json' };

/** A module that depends on core.authz: the permissions and registry entries it brings. */
export interface FixtureModule {
  id: string;
  manifest: ModuleManifest;
}

/**
 * The module the tests use as "another module": it declares an ordinary permission, a
 * resource-scoped one and a reviewer-only one, and contributes defaults and (optionally) a policy.
 */
export function notesModule(
  extra: Pick<ModuleManifest, 'contributes'> = {},
  id = 'fix.notes',
): FixtureModule {
  return {
    id,
    manifest: defineModule({
      id,
      version: '1.0.0',
      permissions: {
        [`${id}.read`]: { description: 'Read notes' },
        [`${id}.approve`]: { description: 'Approve notes' },
        [`${id}.edit`]: { description: 'Edit a note', scope: 'note' },
      },
      contributes: extra.contributes,
    }),
  };
}

export interface StartOptions extends AuthzModuleOptions {
  databaseUrl?: string;
  modules?: FixtureModule[];
}

export interface Started {
  kernel: Kernel;
  authz: AuthzInternals;
  /** Everything the kernel logged, as JSON lines. */
  logs: string[];
  /** The database it runs on, to start a second kernel over the same one. */
  databaseUrl: string;
}

export interface AuthzHarness {
  server: () => StartedPostgres;
  start: (options?: StartOptions) => Promise<Started>;
}

/** One Postgres container per test file; every `start()` without a `databaseUrl` gets an empty database. */
export function useAuthz(): AuthzHarness {
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
    async start(options = {}) {
      const logs: string[] = [];
      const log = createLogger({
        level: 'warn',
        destination: new Writable({
          write(chunk: Buffer, _encoding, callback) {
            logs.push(chunk.toString());
            callback();
          },
        }),
      });
      const modules = options.modules ?? [];
      const databaseUrl = options.databaseUrl ?? (await server.createDatabase());
      const packageOf = (id: string) => `@scorpion/${id.replaceAll('.', '-')}`;
      const kernel = createKernel({
        profile: {
          name: 'authz-test',
          modules: ['core.authz', ...modules.map((m) => m.id)] as never,
        },
        sources: [
          { manifest: createAuthzModule(options), packageJson },
          ...modules.map((m) => ({
            manifest: m.manifest,
            packageJson: {
              name: packageOf(m.id),
              dependencies: { '@scorpion/core-authz': 'workspace:*' },
            },
          })),
        ],
        modulePackages: {
          'core.authz': '@scorpion/core-authz',
          ...Object.fromEntries(modules.map((m) => [m.id, packageOf(m.id)])),
        },
        config: loadConfig({ DATABASE_URL: databaseUrl, PROFILE: 'authz-test' }),
        log,
      });
      open.push(kernel);
      await kernel.start();
      return {
        kernel,
        authz: kernel.services.get('core.authz') as AuthzInternals,
        logs,
        databaseUrl,
      };
    },
  };
}
