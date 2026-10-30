// The About page of the instance (core.ui-shell, ADR-0045): GET /ui/about through the whole pipeline, and the service
// under it, over real Postgres. It tells the profile, the Scorpion version and the loaded modules, and nothing else.
import { ANONYMOUS, Forbidden, Unauthorized, type UserActor } from '@scorpion/contracts';
import type { ShellService } from '@scorpion/core-ui-shell/public';
import { describe, expect, it } from 'vitest';
import { useIdentityApp } from './testing/identity-app.ts';

const harness = useIdentityApp();

interface About {
  profile: string;
  version: string;
  modules: { id: string; displayName: string; version: string; kind: string }[];
}

describe('GET /ui/about', () => {
  it('tells a signed-in person the profile, the version and the modules, and says nothing is cached', async () => {
    const app = await harness.start();
    const { cookie } = await app.signedIn('alice');
    const reply = await app.get('/ui/about', { cookie });
    expect(reply.status).toBe(200);
    expect(reply.res.headers.get('cache-control')).toBe('no-store');
    const body = reply.body as About;
    expect(Object.keys(body).sort()).toEqual(['modules', 'profile', 'version']);
    expect(body.profile).toBe(app.kernel.profile.name);
    expect(body.modules.map((module) => module.id)).toEqual(
      app.kernel.profile.modules.map((module) => module.id),
    );
    const shell = body.modules.find((module) => module.id === 'core.ui-shell');
    expect(shell).toMatchObject({ id: 'core.ui-shell', displayName: 'Web shell', kind: 'core' });
    expect(shell?.version).toMatch(/^\d+\.\d+\.\d+/);
    for (const module of body.modules) {
      expect(Object.keys(module).sort()).toEqual(['displayName', 'id', 'kind', 'version']);
      expect(module.kind).toBe(module.id.startsWith('core.') ? 'core' : 'optional');
    }
  });

  it('refuses a visitor who is not signed in', async () => {
    const app = await harness.start();
    expect((await app.get('/ui/about')).status).toBe(401);
  });

  it('works under a base path of three segments too', async () => {
    const app = await harness.start({ basePath: '/a/b/c' });
    const { cookie } = await app.signedIn('alice');
    expect((await app.get('/ui/about', { cookie })).status).toBe(200);
  });
});

describe('ShellService.about', () => {
  const shellOf = (app: Awaited<ReturnType<typeof harness.start>>) =>
    app.kernel.services.get('core.ui-shell') as ShellService;

  it('refuses an anonymous caller and a user who does not hold the permission', async () => {
    const app = await harness.start();
    await expect(shellOf(app).about(ANONYMOUS)).rejects.toBeInstanceOf(Unauthorized);
    const session = await app.signedIn('nobody', { roles: [] });
    // No role at all: the person is signed in, but holds nothing the service asks for.
    const actor: UserActor = {
      kind: 'user',
      userId: session.user.id,
      username: 'nobody',
      roles: [],
      via: 'session',
    };
    await expect(shellOf(app).about(actor)).rejects.toBeInstanceOf(Forbidden);
  });
});
