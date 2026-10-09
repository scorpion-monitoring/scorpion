// The `full` profile with the real authoriser of core.authz in the pipeline (no test authoriser).
// A signed-in user without any role gets 403 on everything that is not public (roles carry the
// permissions), and only someone who holds a role that has the permission gets in. The whole story
// of an instance is in full-profile-journey.test.ts.
import { Forbidden, Unauthorized, type UserActor } from '@scorpion/contracts';
import { createKernel, createLogger, loadConfig, type Kernel } from '@scorpion/kernel';
import {
  makeRoleAssignment,
  makeSecretsKey,
  makeSession,
  makeUser,
  startPostgres,
  type StartedPostgres,
} from '@scorpion/testing';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createApp, SURFACE_PREFIX } from './app.ts';
import { moduleIds, profileName, sources } from './generated/profile.ts';
import { createMetrics } from './metrics.ts';

// The generated profile has core.settings, which will not start without a key (ADR 0016).
process.env.SECRETS_KEY = makeSecretsKey();

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

async function boot() {
  const log = createLogger({ level: 'silent' });
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
    authorizer: kernel.authorizer,
    probes: {
      readiness: () =>
        Promise.resolve({
          ready: true,
          checks: { database: 'ok', migrations: 'complete', kernel: 'started' } as const,
        }),
      metrics: createMetrics(),
    },
  });
  async function signedIn(username: string) {
    const user = await makeUser(kernel.pool, { username });
    const { secret } = await makeSession(kernel.pool, user);
    const actor: UserActor = { kind: 'user', userId: user.id, username, roles: [], via: 'session' };
    return { user, cookie: secret, actor };
  }
  const get = (path: string, cookie?: string) =>
    app.request(
      `${SURFACE_PREFIX.internal}${path}`,
      { headers: cookie === undefined ? {} : { cookie: `__Host-session=${cookie}` } },
      { incoming: { socket: { remoteAddress: '203.0.113.7' } } },
    );
  return { kernel, signedIn, get };
}

describe('profile full with core.authz', () => {
  it('contains core.authz before core.identity', () => {
    expect(moduleIds).toEqual([
      'core.authz',
      'core.settings',
      'core.blob',
      'core.notifications',
      'core.identity',
      'core.audit',
      'core.ui-shell',
      'registry.organisations',
    ]);
  });

  it('answers 403 to a signed-in user without roles on a non-public route', async () => {
    const { signedIn, get } = await boot();
    const { cookie } = await signedIn('noroles');
    const reply = await get('/auth/me', cookie);
    expect(reply.status).toBe(403);
    expect(await reply.json()).toMatchObject({ status: 403, title: 'Forbidden' });
  });

  it('denies a user without roles on every non-public route, and anonymous gets 401 [ASVS-8.3.1]', async () => {
    const { kernel, signedIn } = await boot();
    const { actor } = await signedIn('noroles');
    const guarded = kernel.routes.filter((entry) => !entry.route.public);
    expect(guarded.length).toBeGreaterThan(5);
    for (const entry of guarded) {
      const request = {
        actor,
        permission: entry.route.permission!,
        module: entry.module,
        method: entry.route.method,
        path: entry.route.path,
        context: {} as never,
      };
      const label = `${entry.route.method} ${entry.route.path}`;
      await expect(kernel.authorizer(request), label).rejects.toBeInstanceOf(Forbidden);
      await expect(
        kernel.authorizer({ ...request, actor: { kind: 'anonymous' } }),
        label,
      ).rejects.toBeInstanceOf(Unauthorized);
    }
  });

  it('lets a user in once they hold a role that has the permission, and Admin for everything', async () => {
    const { kernel, signedIn, get } = await boot();
    const admin = await signedIn('theadmin');
    const reader = await signedIn('thereader');
    await makeRoleAssignment(kernel.pool, admin.user, 'admin');
    expect((await get('/auth/me', admin.cookie)).status).toBe(200);
    expect((await get('/auth/me', reader.cookie)).status).toBe(403);
  });

  it('keeps public routes public', async () => {
    const { kernel, get } = await boot();
    const publicRoute = kernel.routes.find(
      (entry) => entry.route.public && entry.route.method === 'get',
    );
    expect(publicRoute).toBeDefined();
    const reply = await get(publicRoute!.route.path.replace(/\{[^}]+\}/g, 'x'));
    expect([401, 403]).not.toContain(reply.status);
  });
});
