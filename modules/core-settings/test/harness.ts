// Starts core.settings over real Postgres, as the kernel guide describes ("Testing a module"),
// together with the real core.authz it depends on and a fixture module that has settings of its
// own and registers user preferences. Permissions are decided by the real authoriser from roles in
// the database.
import type { UserActor } from '@scorpion/contracts';
import authzModule from '@scorpion/core-authz/module';
import authzPackage from '@scorpion/core-authz/package.json' with { type: 'json' };
import type { AuthzService } from '@scorpion/core-authz/public';
import {
  createKernel,
  createLogger,
  defineModule,
  loadConfig,
  type Kernel,
  type ModuleManifest,
} from '@scorpion/kernel';
import {
  makeRoleAssignment,
  makeSecretsKey,
  startPostgres,
  type StartedPostgres,
} from '@scorpion/testing';
import { randomUUID } from 'node:crypto';
import { Writable } from 'node:stream';
import { z } from 'zod';
import { afterAll, afterEach, beforeAll } from 'vitest';
import {
  createSettingsModule,
  type SettingsInternalsBundle,
  type SettingsModuleOptions,
} from '../module.ts';
import packageJson from '../package.json' with { type: 'json' };

export const widgetSettings = z.strictObject({
  limit: z.number().int().min(1).max(10).default(3),
  label: z.string().trim().min(1).max(20).default('plain'),
  nested: z.strictObject({ on: z.boolean().default(false) }).default({ on: false }),
});

export interface Widgets {
  settings(): Promise<z.output<typeof widgetSettings>>;
}

/**
 * The module the tests use as "another module": it has settings, registers two preferences and
 * reads its own settings through `ctx.settings`.
 */
export function widgetsModule(id = 'fix.widgets'): { id: string; manifest: ModuleManifest } {
  return {
    id,
    manifest: defineModule<Widgets, never, never, z.output<typeof widgetSettings>>({
      id,
      version: '1.0.0',
      settings: widgetSettings,
      services: (ctx) => ({ settings: () => ctx.settings.get() }),
      contributes: {
        'settings.userPreference': [
          { key: `${id}.theme`, description: 'Colour scheme', schema: z.enum(['light', 'dark']) },
          {
            key: `${id}.layout`,
            description: 'Columns',
            schema: z.strictObject({ columns: z.number().int().min(1).max(6) }),
          },
          { key: `${id}.nullable`, description: 'Accepts null', schema: z.null() },
          { key: `${id}.note`, description: 'Free text', schema: z.string().max(20_000) },
        ],
      },
    }),
  };
}

export interface StartOptions extends SettingsModuleOptions {
  databaseUrl?: string;
  /** Fixture modules that depend on core.settings. Default: one `fix.widgets`. */
  modules?: { id: string; manifest: ModuleManifest }[];
  /** `SECRETS_KEY` (default: a new random key) and `SECRETS_KEY_NEXT`, as the process environment would hold them. */
  secretsKey?: string | null;
  secretsKeyNext?: string;
}

export interface Started {
  kernel: Kernel;
  settings: SettingsInternalsBundle;
  /** The public service of core.authz in this kernel. */
  authz: AuthzService;
  /** Everything the kernel logged at trace level, as JSON lines. */
  logs: string[];
  databaseUrl: string;
  /** The key the kernel was started with. */
  secretsKey: string;
  /** A user holding the given roles (rows in the database, decided by the real authoriser). */
  actorOf: (...roles: string[]) => Promise<UserActor>;
  /** The fixture module's service, when it was loaded. */
  widgets: Widgets;
}

export interface SettingsHarness {
  server: () => StartedPostgres;
  start: (options?: StartOptions) => Promise<Started>;
}

/** One Postgres container per test file; every `start()` without a `databaseUrl` gets an empty database. */
export function useSettings(): SettingsHarness {
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
        level: 'trace',
        destination: new Writable({
          write(chunk: Buffer, _encoding, callback) {
            logs.push(chunk.toString());
            callback();
          },
        }),
      });
      const modules = options.modules ?? [widgetsModule()];
      const secretsKey =
        options.secretsKey === null ? '' : (options.secretsKey ?? makeSecretsKey());
      const packageOf = (id: string) => `@scorpion/${id.replaceAll('.', '-')}`;
      const databaseUrl = options.databaseUrl ?? (await server.createDatabase());
      const kernel = createKernel({
        profile: {
          name: 'settings-test',
          modules: ['core.authz', 'core.settings', ...modules.map((m) => m.id)] as never,
        },
        sources: [
          { manifest: authzModule, packageJson: authzPackage },
          {
            manifest: createSettingsModule({
              ...options,
              env: options.env ?? {
                SECRETS_KEY: secretsKey,
                ...(options.secretsKeyNext ? { SECRETS_KEY_NEXT: options.secretsKeyNext } : {}),
              },
            }),
            packageJson,
          },
          ...modules.map((m) => ({
            manifest: m.manifest,
            packageJson: {
              name: packageOf(m.id),
              dependencies: { '@scorpion/core-settings': 'workspace:*' },
            },
          })),
        ],
        modulePackages: {
          'core.authz': '@scorpion/core-authz',
          'core.settings': '@scorpion/core-settings',
          ...Object.fromEntries(modules.map((m) => [m.id, packageOf(m.id)])),
        },
        config: loadConfig({ DATABASE_URL: databaseUrl, PROFILE: 'settings-test' }),
        log,
      });
      open.push(kernel);
      await kernel.start();
      return {
        kernel,
        settings: kernel.services.get('core.settings') as SettingsInternalsBundle,
        authz: kernel.services.get('core.authz') as AuthzService,
        logs,
        databaseUrl,
        secretsKey,
        widgets: kernel.services.get(modules[0]?.id ?? 'fix.widgets') as Widgets,
        async actorOf(...roles) {
          const user = { id: randomUUID() };
          for (const role of roles) await makeRoleAssignment(kernel.pool, user, role);
          return {
            kind: 'user',
            userId: user.id,
            username: `user-${user.id.slice(0, 8)}`,
            roles: [],
            via: 'session',
          };
        },
      };
    },
  };
}

/** Makes every insert into the outbox fail, so a write that emits an event must roll back. */
export async function breakOutbox(pool: { query(text: string): Promise<unknown> }) {
  await pool.query(`
    create or replace function test_break_outbox() returns trigger as $$
    begin raise exception 'outbox is broken for this test'; end $$ language plpgsql;
    create trigger test_break_outbox before insert on kernel_outbox
      for each row execute function test_break_outbox();`);
  return () => pool.query('drop trigger test_break_outbox on kernel_outbox');
}
