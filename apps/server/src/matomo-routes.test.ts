// GET /api/internal/matomo/tracker (matomo, M13b, ADR-0054) against real Postgres: off by default, the saved settings once an
// administrator turns tracking on, the pseudonymous id only for the signed-in caller with the option on and the secret set,
// and nothing of the account itself in the answer. Under `/` and a base path of three segments (defect 11).
import { createHmac } from 'node:crypto';
import { USER_ID_KEY_SECRET } from '@scorpion/matomo/public';
import { describe, expect, it } from 'vitest';
import { useIdentityApp } from './testing/identity-app.ts';

const harness = useIdentityApp();
const session = (who: { cookie: string; csrf: string }) => ({ cookie: who.cookie, csrf: who.csrf });

const ON = {
  enabled: true,
  url: 'https://stats.example.org/matomo',
  siteId: 7,
  cookieless: true,
  respectDoNotTrack: true,
  pseudonymousUserId: false,
};
const KEY = 'matomo-test-key-0123456789';
const expectedId = (userId: string) =>
  createHmac('sha256', KEY)
    .update(`scorpion.matomo.user-id.v1\0${userId}`, 'utf8')
    .digest('hex')
    .slice(0, 32);

describe.each(['/', '/a/b/c'])('GET /matomo/tracker under BASE_PATH %s', (basePath) => {
  const start = () =>
    harness.start({
      basePath,
      matomo: true,
    });

  /** Saves the settings as an administrator, through the route the settings form uses. */
  const save = async (
    app: Awaited<ReturnType<typeof start>>,
    admin: { cookie: string; csrf: string },
    values: Record<string, unknown>,
  ) => {
    const current = (await app.get('/settings/matomo', session(admin))).body as { version: number };
    return app.call('PUT', '/settings/matomo', {
      ...session(admin),
      body: { version: current.version, values },
    });
  };

  it('answers anybody that tracking is off until an administrator turns it on, and is never cached', async () => {
    const app = await start();
    const reply = await app.get('/matomo/tracker');
    expect(reply.status).toBe(200);
    expect(reply.body).toEqual({ enabled: false });
    expect(reply.res.headers.get('cache-control')).toBe('no-store');
  });

  it('gives anybody the saved configuration at once, with nothing else, and off again when turned off', async () => {
    const app = await start();
    const admin = await app.signedIn('admin', { roles: ['admin'] });
    expect((await save(app, admin, ON)).status).toBe(200);

    const expected = {
      enabled: true,
      url: 'https://stats.example.org/matomo/',
      siteId: 7,
      cookieless: true,
      respectDoNotTrack: true,
    };
    expect((await app.get('/matomo/tracker')).body).toEqual(expected);
    const plain = await app.signedIn('plain');
    expect((await app.get('/matomo/tracker', { cookie: plain.cookie })).body).toEqual(expected);

    expect((await save(app, admin, { ...ON, enabled: false })).status).toBe(200);
    expect((await app.get('/matomo/tracker')).body).toEqual({ enabled: false });
  });

  it('refuses incomplete or unsafe settings with 422 and the field, and stores nothing', async () => {
    const app = await start();
    const admin = await app.signedIn('admin', { roles: ['admin'] });
    for (const [values, field] of [
      [{ enabled: true, siteId: 7 }, 'values.url'],
      [{ enabled: true, url: 'https://stats.example.org/' }, 'values.siteId'],
      [{ ...ON, url: 'http://stats.example.org/' }, 'values.url'],
      [{ ...ON, url: 'https://*.example.org/' }, 'values.url'],
      [{ ...ON, url: 'https://stats.example.org/?a=1' }, 'values.url'],
    ] as const) {
      const reply = await save(app, admin, values);
      expect(reply.status, JSON.stringify(values)).toBe(422);
      expect(JSON.stringify(reply.body)).toContain(field);
    }
    expect((await app.get('/matomo/tracker')).body).toEqual({ enabled: false });
  });

  it('lets only an administrator change the settings (a plain user gets 403)', async () => {
    const app = await start();
    const plain = await app.signedIn('plain');
    const reply = await app.call('PUT', '/settings/matomo', {
      ...session(plain),
      body: { version: 0, values: ON },
    });
    expect(reply.status).toBe(403);
    expect((await app.get('/matomo/tracker')).body).toEqual({ enabled: false });
  });

  it('gives a signed-in caller their own pseudonymous id with the option on and the secret set, and nobody else one', async () => {
    const app = await start();
    const admin = await app.signedIn('admin', { roles: ['admin'] });
    await save(app, admin, { ...ON, pseudonymousUserId: true });

    // Without the secret: no id, no failure, and the log names the secret, not a value.
    const plain = await app.signedIn('plain');
    const before = await app.get('/matomo/tracker', { cookie: plain.cookie });
    expect(before.status).toBe(200);
    expect(before.body).not.toHaveProperty('userId');
    expect(app.logText()).toContain('matomo.user-id-key');

    await app.settings.secrets.setAsSystem(USER_ID_KEY_SECRET, KEY);
    const mine = (await app.get('/matomo/tracker', { cookie: plain.cookie })).body as {
      userId?: string;
    };
    expect(mine.userId).toBe(expectedId(plain.user.id));
    const theirs = (await app.get('/matomo/tracker', { cookie: admin.cookie })).body as {
      userId?: string;
    };
    expect(theirs.userId).toBe(expectedId(admin.user.id));
    expect(theirs.userId).not.toBe(mine.userId);

    // An anonymous caller gets none, and no answer carries the account itself.
    expect((await app.get('/matomo/tracker')).body).not.toHaveProperty('userId');
    for (const body of [JSON.stringify(mine), JSON.stringify(theirs)]) {
      expect(body).not.toContain(plain.user.id);
      expect(body).not.toContain(admin.user.id);
      expect(body).not.toContain('plain');
      expect(body).not.toContain(KEY);
    }
  });

  it('puts the tracker widget at the end of every page, for anybody', async () => {
    const app = await start();
    const navigation = (await app.get('/ui/navigation')).body as {
      widgets: { id: string; slot: string }[];
    };
    expect(navigation.widgets).toContainEqual(
      expect.objectContaining({ id: 'matomo.tracker', slot: 'page-end' }),
    );
  });
});
