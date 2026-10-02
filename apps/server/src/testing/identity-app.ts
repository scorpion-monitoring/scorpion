// The HTTP app over a real core.identity kernel and Postgres, for tests that go through the whole
// pipeline: rate limit, cookie authentication, validation, authorisation and the error mapper.
// Authorisation is the real one: core.authz is loaded (identity depends on it) and its authoriser
// decides every route from roles in the database. There is no test authoriser here.
import { Writable } from 'node:stream';
import {
  createIdentityModule,
  settingsSchema,
  USER_PERMISSIONS,
  type IdentityInternals,
} from '@scorpion/core-identity/module';
import type { IdentityModuleOptions } from '@scorpion/core-identity/module';
import packageJson from '@scorpion/core-identity/package.json' with { type: 'json' };
import authzModule from '@scorpion/core-authz/module';
import authzPackage from '@scorpion/core-authz/package.json' with { type: 'json' };
import {
  createSettingsModule,
  type SettingsInternalsBundle,
  type SettingsModuleOptions,
} from '@scorpion/core-settings/module';
import settingsPackage from '@scorpion/core-settings/package.json' with { type: 'json' };
import {
  createKernel,
  createLogger,
  loadConfig,
  type Kernel,
  type ModuleManifest,
} from '@scorpion/kernel';
import {
  makeRole,
  makeRoleAssignment,
  makeSecretsKey,
  startPostgres,
  type StartedPostgres,
} from '@scorpion/testing';
import { afterAll, afterEach, beforeAll } from 'vitest';
import { createApp, SURFACE_PREFIX, type AppOptions } from '../app.ts';
import { createMetrics } from '../metrics.ts';
import { limitsFromSettings } from '../pipeline/rate-limit.ts';

export { createMemoryMailer } from '@scorpion/core-identity/module';
export const API = SURFACE_PREFIX.internal;
/**
 * The scopes of a test token that may do everything the role `user` may: a token is limited to
 * its scopes and to what its owner holds (ADR 0015), and the session-only routes must refuse it
 * even then.
 */
export const ALL_USER_SCOPES = [...USER_PERMISSIONS];

/** Settings with some values changed, for the `settings` option. */
export const settingsWith = (values: Parameters<typeof settingsSchema.parse>[0]) => ({
  get: () => Promise.resolve(settingsSchema.parse(values)),
});
export const PASSWORD = 'correct horse battery';
const COOKIE = '__Host-session';

export interface AppOptionsForTest extends IdentityModuleOptions {
  /**
   * Gives every `signedIn` user one role that holds exactly these permissions, instead of the
   * role `user`. For tests of what a route does when a permission is, or is not, held.
   */
  permissions?: string[];
  /** Limits per route group, with the rate limiter switched on. */
  rateLimits?: AppOptions['rateLimits'];
  /** core.settings: its cache TTL, and the keys of the secrets store (default: a new random `SECRETS_KEY`). */
  settingsModule?: Pick<SettingsModuleOptions, 'cacheTtlMs' | 'now'>;
  secretsKey?: string;
  secretsKeyNext?: string;
  /** Start over a database that another app already uses (a second server process). */
  databaseUrl?: string;
  /** Fixture modules that depend on core.settings, for example one that registers user preferences. */
  extraModules?: { id: string; manifest: ModuleManifest }[];
  /** Use the limits stored in core.settings (as the server does) instead of the constants. */
  storedRateLimits?: boolean;
}

export interface Reply {
  res: Response;
  status: number;
  body: unknown;
  /** The session cookie value this response set, `''` when it cleared it, `undefined` when it did nothing. */
  cookie: string | undefined;
  setCookie: string | undefined;
}

export interface RequestOptions {
  body?: unknown;
  /** Sent as the `__Host-session` cookie. */
  cookie?: string;
  csrf?: string;
  headers?: Record<string, string>;
  peer?: string;
}

export function useIdentityApp() {
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
    async start(options: AppOptionsForTest = {}) {
      const lines: string[] = [];
      const secretsKey = options.secretsKey ?? makeSecretsKey();
      const databaseUrl = options.databaseUrl ?? (await server.createDatabase());
      const log = createLogger({
        level: 'trace',
        destination: new Writable({
          write(chunk: Buffer, _encoding, callback) {
            lines.push(chunk.toString());
            callback();
          },
        }),
      });
      const kernel = createKernel({
        profile: {
          name: 'identity-http',
          modules: [
            'core.authz',
            'core.settings',
            'core.identity',
            ...(options.extraModules ?? []).map((extra) => extra.id),
          ] as never,
        },
        sources: [
          { manifest: authzModule, packageJson: authzPackage },
          {
            manifest: createSettingsModule({
              ...options.settingsModule,
              env: {
                SECRETS_KEY: secretsKey,
                ...(options.secretsKeyNext ? { SECRETS_KEY_NEXT: options.secretsKeyNext } : {}),
              },
            }),
            packageJson: settingsPackage,
          },
          { manifest: createIdentityModule(options), packageJson },
          ...(options.extraModules ?? []).map((extra) => ({
            manifest: extra.manifest,
            packageJson: {
              name: `@scorpion/${extra.id.replaceAll('.', '-')}`,
              dependencies: { '@scorpion/core-settings': 'workspace:*' },
            },
          })),
        ],
        modulePackages: {
          'core.authz': '@scorpion/core-authz',
          'core.settings': '@scorpion/core-settings',
          'core.identity': '@scorpion/core-identity',
          ...Object.fromEntries(
            (options.extraModules ?? []).map((extra) => [
              extra.id,
              `@scorpion/${extra.id.replaceAll('.', '-')}`,
            ]),
          ),
        },
        config: loadConfig({
          DATABASE_URL: databaseUrl,
          PROFILE: 'identity-http',
        }),
        log,
      });
      open.push(kernel);
      await kernel.start();
      const identity = kernel.services.get('core.identity') as IdentityInternals;
      const settings = kernel.services.get('core.settings') as SettingsInternalsBundle;

      const app = createApp({
        config: kernel.config,
        log,
        routes: kernel.routes,
        authenticator: kernel.authenticator,
        authorizer: kernel.authorizer,
        rateLimiter:
          options.rateLimits || options.storedRateLimits ? kernel.rateLimiter : undefined,
        rateLimits: options.rateLimits,
        storedRateLimits: options.storedRateLimits
          ? async () => limitsFromSettings(await kernel.settingsOf('core.settings').get())
          : undefined,
        probes: {
          readiness: () =>
            Promise.resolve({
              ready: true,
              checks: { database: 'ok', migrations: 'complete', kernel: 'started' } as const,
            }),
          metrics: createMetrics(),
        },
      });

      async function call(
        method: string,
        path: string,
        options: RequestOptions = {},
      ): Promise<Reply> {
        const headers: Record<string, string> = { ...options.headers };
        if (options.body !== undefined && !headers['content-type']) {
          headers['content-type'] = 'application/json';
        }
        if (options.cookie !== undefined) headers.cookie = `${COOKIE}=${options.cookie}`;
        if (options.csrf !== undefined) headers['x-csrf-token'] = options.csrf;
        const res = await app.request(
          `${API}${path}`,
          {
            method,
            headers,
            body:
              options.body === undefined
                ? undefined
                : typeof options.body === 'string'
                  ? options.body
                  : JSON.stringify(options.body),
          },
          { incoming: { socket: { remoteAddress: options.peer ?? '203.0.113.7' } } },
        );
        const text = await res.text();
        const setCookie = res.headers
          .getSetCookie()
          .find((value) => value.startsWith(`${COOKIE}=`));
        return {
          res,
          status: res.status,
          body: text ? (JSON.parse(text) as unknown) : undefined,
          cookie: setCookie ? setCookie.slice(COOKIE.length + 1).split(';')[0] : undefined,
          setCookie,
        };
      }

      /**
       * An active account (made through the service, so no approval step), the roles it holds
       * (default: `user`, as an approved account has) and a session for it.
       */
      async function signedIn(username: string, extra: { email?: string; roles?: string[] } = {}) {
        const created = await identity.users.createUser({
          username,
          email: extra.email ?? `${username}@example.org`,
          auth: { provider: 'local', password: PASSWORD },
          status: 'active',
        });
        const roles = extra.roles ?? (options.permissions ? [] : ['user']);
        for (const role of roles) await makeRoleAssignment(kernel.pool, created, role);
        if (extra.roles === undefined && options.permissions) {
          await makeRoleAssignment(
            kernel.pool,
            created,
            await makeRole(kernel.pool, { permissions: options.permissions }),
          );
        }
        const reply = await call('POST', '/auth/login', { body: { username, password: PASSWORD } });
        const { csrfToken } = reply.body as { csrfToken: string };
        return { user: created, cookie: reply.cookie!, csrf: csrfToken };
      }

      return {
        kernel,
        identity,
        settings,
        databaseUrl,
        secretsKey,
        lines,
        call,
        signedIn,
        get: (path: string, options?: RequestOptions) => call('GET', path, options),
        post: (path: string, options?: RequestOptions) => call('POST', path, options),
        /** Everything written to the log so far, as one string. */
        logText: () => lines.join(''),
      };
    },
  };
}
