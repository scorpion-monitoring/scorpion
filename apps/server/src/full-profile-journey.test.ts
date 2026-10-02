// The first end-to-end release candidate (M3 sprint 2): a fresh instance of the generated `full`
// profile, with the real authoriser of core.authz and no test authoriser anywhere. The first
// administrator comes from the bootstrap service (what `scorpion create-admin` calls), a second
// person registers, is approved with a role, uses the account, and a personal access token with a
// limited scope works through the real pipeline, limited to its scopes and its owner's permissions.
/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-explicit-any --
   the bodies of the responses are read as plain JSON */
import { createKernel, createLogger, loadConfig, type Kernel } from '@scorpion/kernel';
import { startPostgres, type StartedPostgres } from '@scorpion/testing';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createApp, SURFACE_PREFIX } from './app.ts';
import { moduleIds, profileName, sources } from './generated/profile.ts';
import { createMetrics } from './metrics.ts';

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

const PASSWORD = 'correct horse battery';
const COOKIE = '__Host-session';

async function boot() {
  const lines: string[] = [];
  const log = createLogger({
    level: 'trace',
    destination: new (await import('node:stream')).Writable({
      write(chunk: Buffer, _encoding, callback) {
        lines.push(chunk.toString());
        callback();
      },
    }),
  });
  const kernel = createKernel({
    profile: { name: profileName, modules: [...moduleIds] },
    sources,
    modulePackages: Object.fromEntries(
      sources.map((source, index) => [moduleIds[index]!, source.packageJson.name]),
    ),
    config: loadConfig({ DATABASE_URL: await server.createDatabase(), PROFILE: profileName }),
    log,
  });
  open.push(kernel);
  await kernel.start();
  const app = createApp({
    config: kernel.config,
    log,
    routes: kernel.routes,
    authenticator: kernel.authenticator,
    authorizer: kernel.authorizer, // the real one: there is no other in this file
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
    options: { body?: unknown; cookie?: string; csrf?: string; token?: string } = {},
  ) {
    const headers: Record<string, string> = {};
    if (options.body !== undefined) headers['content-type'] = 'application/json';
    if (options.cookie) headers.cookie = `${COOKIE}=${options.cookie}`;
    if (options.csrf) headers['x-csrf-token'] = options.csrf;
    if (options.token) headers.authorization = `Bearer ${options.token}`;
    const res = await app.request(
      `${SURFACE_PREFIX.internal}${path}`,
      {
        method,
        headers,
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
      },
      { incoming: { socket: { remoteAddress: '203.0.113.7' } } },
    );
    const text = await res.text();
    const setCookie = res.headers.getSetCookie().find((value) => value.startsWith(`${COOKIE}=`));
    return {
      status: res.status,
      body: (text ? JSON.parse(text) : undefined) as Record<string, any> | undefined,
      cookie: setCookie?.slice(COOKIE.length + 1).split(';')[0],
    };
  }
  async function login(username: string) {
    const reply = await call('POST', '/auth/login', { body: { username, password: PASSWORD } });
    expect(reply.status).toBe(200);
    return { cookie: reply.cookie!, csrf: reply.body!.csrfToken as string };
  }
  const bootstrap = (
    kernel.services.get('core.identity') as {
      bootstrap: { createAdmin(input: unknown): Promise<{ id: string }> };
    }
  ).bootstrap;
  return { kernel, call, login, bootstrap, logs: () => lines.join('') };
}

describe('a fresh full-profile instance, end to end, on the real authoriser', () => {
  it('goes from create-admin to a limited personal access token', async () => {
    const { kernel, call, login, bootstrap, logs } = await boot();
    expect(moduleIds).toEqual(['core.authz', 'core.identity']);

    // 1. The first administrator, as `scorpion create-admin` makes it: Admin, given by the system.
    const created = await bootstrap.createAdmin({
      username: 'root',
      email: 'root@example.org',
      password: PASSWORD,
    });
    const root = await login('root');
    const me = await call('GET', '/auth/me', root);
    expect(me.status).toBe(200);
    expect(me.body).toMatchObject({ user: { id: created.id, username: 'root' }, roles: ['admin'] });
    const roleRows = await kernel.pool.query(
      `select a.assigned_by, r.key from authz_role_assignment a join authz_role r on r.id = a.role_id`,
    );
    expect(roleRows.rows).toEqual([{ assigned_by: null, key: 'admin' }]);

    // 2. A second person registers; they wait, and cannot do anything yet.
    const registered = await call('POST', '/auth/register', {
      body: { username: 'alice', email: 'alice@example.org', password: PASSWORD },
    });
    expect(registered.status).toBe(201);
    const aliceId = registered.body!.user.id as string;
    expect(
      (await call('POST', '/auth/login', { body: { username: 'alice', password: PASSWORD } }))
        .status,
    ).toBe(403);
    const pending = await call('GET', '/users/pending', root);
    expect(pending.body).toMatchObject({ metadata: { totalCount: 1 } });

    // 3. The administrator approves them with a role, in one step.
    const approved = await call('POST', `/users/${aliceId}/approve`, {
      ...root,
      body: { role: 'user' },
    });
    expect(approved.status).toBe(200);
    expect(approved.body).toEqual({ id: aliceId, status: 'active' });

    // 4. They use the account, and only the account.
    const alice = await login('alice');
    expect((await call('GET', '/auth/me', alice)).body).toMatchObject({ roles: ['user'] });
    expect((await call('GET', '/account/profile', alice)).status).toBe(200);
    expect(
      (await call('PATCH', '/account/profile', { ...alice, body: { bio: 'Hello' } })).status,
    ).toBe(200);
    for (const [method, path] of [
      ['GET', '/users/pending'],
      ['GET', '/roles'],
      ['POST', `/users/${aliceId}/roles`],
    ] as const) {
      const reply = await call(method, path, {
        ...alice,
        body: method === 'POST' ? { role: 'admin' } : undefined,
      });
      expect(reply.status, `${method} ${path}`).toBe(403);
    }

    // 5. A personal access token with a limited scope: it works, and only for what it names.
    const made = await call('POST', '/tokens', {
      ...alice,
      body: { name: 'script', scopes: ['core.identity.me.read'] },
    });
    expect(made.status).toBe(201);
    const token = made.body!.token as string;
    expect((await call('GET', '/auth/me', { token })).body).toMatchObject({
      user: { username: 'alice' },
      csrfToken: null,
    });
    expect((await call('GET', '/account/profile', { token })).status).toBe(403); // not in its scopes
    expect((await call('GET', '/tokens', { token })).status).toBe(403); // never for a token
    expect((await call('GET', '/users/pending', { token })).status).toBe(403);

    // 6. Even a scope wider than alice's permissions grants nothing she does not hold.
    const wide = await call('POST', '/tokens', {
      ...alice,
      body: {
        name: 'wide',
        scopes: [
          'core.identity.me.read',
          'core.identity.user.list-pending',
          'core.identity.role.assign',
        ],
      },
    });
    const wideToken = wide.body!.token as string;
    expect((await call('GET', '/auth/me', { token: wideToken })).status).toBe(200);
    expect((await call('GET', '/users/pending', { token: wideToken })).status).toBe(403);

    // 7. The administrator's token, limited to listing, lists and does nothing else.
    const rootToken = (
      await call('POST', '/tokens', {
        ...root,
        body: { name: 'lister', scopes: ['core.identity.user.list-pending'] },
      })
    ).body!.token as string;
    expect((await call('GET', '/users/pending', { token: rootToken })).status).toBe(200);
    expect((await call('GET', '/roles', { token: rootToken })).status).toBe(403);
    expect((await call('POST', `/users/${aliceId}/reject`, { token: rootToken })).status).toBe(403);

    // 8. The log holds no password and no token.
    for (const secret of [PASSWORD, token, wideToken, rootToken]) {
      expect(logs()).not.toContain(secret);
    }
  });

  it('shows the first-run token only while nobody holds the Admin role', async () => {
    const { kernel, bootstrap } = await boot();
    expect((await kernel.pool.query('select 1 from identity_first_run_token')).rows).toHaveLength(
      1,
    );
    await bootstrap.createAdmin({
      username: 'root',
      email: 'root@example.org',
      password: PASSWORD,
    });
    expect(
      (await kernel.pool.query('select redeemed_at from identity_first_run_token')).rows,
    ).toEqual([{ redeemed_at: expect.any(Date) as unknown }]);
  });
});
