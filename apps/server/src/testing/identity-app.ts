// The HTTP app over a real core.identity kernel and Postgres, for tests that go through the whole
// pipeline: rate limit, cookie authentication, validation, authorisation and the error mapper.
// Production denies every non-public route until core.authz exists (M3), so these tests pass a
// test authoriser; it is never part of a manifest.
import { Writable } from 'node:stream';
import {
  createIdentityModule,
  settingsSchema,
  type IdentityInternals,
} from '@scorpion/core-identity/module';
import type { IdentityModuleOptions } from '@scorpion/core-identity/module';
import packageJson from '@scorpion/core-identity/package.json' with { type: 'json' };
import { createKernel, createLogger, loadConfig, type Kernel } from '@scorpion/kernel';
import { startPostgres, testAuthorizer, type StartedPostgres } from '@scorpion/testing';
import { afterAll, afterEach, beforeAll } from 'vitest';
import { createApp, SURFACE_PREFIX, type AppOptions } from '../app.ts';
import { createMetrics } from '../metrics.ts';

export { createMemoryMailer } from '@scorpion/core-identity/module';
export const API = SURFACE_PREFIX.internal;

/** Settings with some values changed, for the `settings` option. */
export const settingsWith = (values: Parameters<typeof settingsSchema.parse>[0]) => ({
  get: () => Promise.resolve(settingsSchema.parse(values)),
});
export const PASSWORD = 'correct horse battery';
const COOKIE = '__Host-session';

export interface AppOptionsForTest extends IdentityModuleOptions {
  /** Permissions the test authoriser grants to a signed-in caller. Default: all. */
  permissions?: string[];
  /** Limits per route group, with the rate limiter switched on. */
  rateLimits?: AppOptions['rateLimits'];
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
        profile: { name: 'identity-http', modules: ['core.identity'] },
        sources: [{ manifest: createIdentityModule(options), packageJson }],
        modulePackages: { 'core.identity': '@scorpion/core-identity' },
        config: loadConfig({
          DATABASE_URL: await server.createDatabase(),
          PROFILE: 'identity-http',
        }),
        log,
      });
      open.push(kernel);
      await kernel.start();
      const identity = kernel.services.get('core.identity') as IdentityInternals;

      const app = createApp({
        config: kernel.config,
        log,
        routes: kernel.routes,
        authenticator: kernel.authenticator,
        authorizer: testAuthorizer(options.permissions ?? ['*']),
        rateLimiter: options.rateLimits ? kernel.rateLimiter : undefined,
        rateLimits: options.rateLimits,
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

      /** An active account (made through the service, so no approval step) and a session for it. */
      async function signedIn(username: string, extra: { email?: string } = {}) {
        const created = await identity.users.createUser({
          username,
          email: extra.email ?? `${username}@example.org`,
          auth: { provider: 'local', password: PASSWORD },
          status: 'active',
        });
        const reply = await call('POST', '/auth/login', { body: { username, password: PASSWORD } });
        const { csrfToken } = reply.body as { csrfToken: string };
        return { user: created, cookie: reply.cookie!, csrf: csrfToken };
      }

      return {
        kernel,
        identity,
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
