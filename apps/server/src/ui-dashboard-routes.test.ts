// The dashboard of the signed-in caller (M11 sprint 1, core.ui-shell): GET and PUT /ui/dashboard through the whole
// pipeline, and the service under them, over real Postgres. The document is the user preference
// `core.ui-shell.dashboard`; a fixture module offers widgets (a trends chart with a configuration, a singleton, a
// widget behind a permission and a header widget that is no tile) so the repairs have something to repair.
import { randomUUID } from 'node:crypto';
import { Forbidden, Invalid, Unauthorized, type UserActor } from '@scorpion/contracts';
import type { AuthzService } from '@scorpion/core-authz/public';
import type { ShellService } from '@scorpion/core-ui-shell/public';
import { defineModule } from '@scorpion/kernel';
import { makePreference, makeRole } from '@scorpion/testing';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { useIdentityApp } from './testing/identity-app.ts';

const KEY = 'core.ui-shell.dashboard';
const READ = 'core.ui-shell.dashboard.read';
const WRITE = 'core.ui-shell.dashboard.write';
const ADMIN_WIDGET = 'fixture.dash.admin.read';

const TRENDS = 'fixture.dash.trends';
const SINGLE = 'fixture.dash.single';
const ADMIN = 'fixture.dash.admin';
const NOTES = 'fixture.dash.notes';
// A real card of `registry.organisations` (the full profile): since M11 sprint 2 it has a default placement, and every
// signed-in person holds its permission, so it is in everyone's default dashboard (it is pushed below the fixture's tiles).
const MEMBERSHIP = 'organisations.membership-requests';

const fixture = defineModule({
  id: 'fixture.dash',
  version: '1.0.0',
  permissions: { [ADMIN_WIDGET]: { description: 'See the fixture admin widget' } },
  contributes: {
    'ui.widget': [
      {
        id: TRENDS,
        slot: 'dashboard',
        component: 'FixtureTrends',
        order: 10,
        public: true,
        grid: {
          w: 6,
          h: 4,
          minW: 3,
          maxW: 12,
          minH: 2,
          maxH: 8,
          default: { x: 0, y: 0, w: 6, h: 4 },
        },
        label: 'fixture.trends',
        icon: 'list',
        configSchema: z.object({
          range: z.enum(['3m', '6m', '1y', '2y', 'all']).default('1y'),
          hidden: z.array(z.string().max(20)).max(5).default([]),
        }),
      },
      {
        id: SINGLE,
        slot: 'dashboard',
        component: 'FixtureSingle',
        order: 20,
        public: true,
        grid: { w: 3, h: 2, singleton: true, default: { x: 6, y: 0, w: 3, h: 2 } },
      },
      {
        id: NOTES,
        slot: 'dashboard',
        component: 'FixtureNotes',
        order: 25,
        public: true,
        grid: { w: 2, h: 1 },
        configSchema: z.object({ text: z.string().max(380).default('') }),
      },
      {
        id: ADMIN,
        slot: 'dashboard',
        component: 'FixtureAdmin',
        order: 30,
        permission: ADMIN_WIDGET,
        grid: { w: 4, h: 3 },
      },
      { id: 'fixture.dash.header', slot: 'header', component: 'FixtureHeader', public: true },
    ],
  },
});

const harness = useIdentityApp();
const start = (extra: Parameters<typeof harness.start>[0] = {}) =>
  harness.start({
    extraModules: [
      { id: 'fixture.dash', manifest: fixture, requires: ['@scorpion/core-ui-shell'] },
    ],
    ...extra,
  });
type App = Awaited<ReturnType<typeof start>>;

const unique = (prefix: string) => `${prefix}${randomUUID().replaceAll('-', '').slice(0, 10)}`;
interface Tile {
  id: string;
  widget: string;
  x: number;
  y: number;
  w: number;
  h: number;
  config: Record<string, unknown>;
}
const tile = (over: Partial<Tile> = {}): Tile => ({
  id: unique('t').slice(0, 10),
  widget: TRENDS,
  x: 0,
  y: 0,
  w: 6,
  h: 4,
  config: { range: '3m', hidden: [] },
  ...over,
});

interface View {
  version: number;
  items: Tile[];
  dropped: { id: string; reason: string }[];
  reset: boolean;
  resetReason?: string;
  isDefault: boolean;
}
interface Problem {
  title?: string;
  errors?: { path: string; message: string }[];
}

async function person(app: App, name = unique('u'), extra: { roles?: string[] } = {}) {
  const session = await app.signedIn(name, extra);
  const actor: UserActor = {
    kind: 'user',
    userId: session.user.id,
    username: name,
    roles: [],
    via: 'session',
  };
  return { ...session, actor };
}
const read = (app: App, who: { cookie: string }) =>
  app.get('/ui/dashboard', { cookie: who.cookie });
const save = (app: App, who: { cookie: string; csrf: string }, items: unknown[]) =>
  app.call('PUT', '/ui/dashboard', { cookie: who.cookie, csrf: who.csrf, body: { items } });
const stored = async (app: App, userId: string) =>
  (
    await app.kernel.pool.query(
      'select value from settings_user_preference where user_id = $1 and key = $2',
      [userId, KEY],
    )
  ).rows.map((row) => (row as { value: unknown }).value);
const authzOf = (app: App) => app.kernel.services.get('core.authz') as AuthzService;
const shellOf = (app: App) => app.kernel.services.get('core.ui-shell') as ShellService;

describe('GET /ui/dashboard', () => {
  it('gives a person with nothing stored the default dashboard, built from the widgets they may see, and says nothing is cached', async () => {
    const app = await start();
    const alice = await person(app);
    const reply = await read(app, alice);
    expect(reply.status).toBe(200);
    expect(reply.res.headers.get('cache-control')).toBe('no-store');
    const body = reply.body as View;
    expect(body).toMatchObject({ version: 1, dropped: [], reset: false, isDefault: true });
    expect(body.items.map((item) => item.widget)).toEqual([TRENDS, SINGLE, MEMBERSHIP]);
    expect(body.items[0]).toMatchObject({
      x: 0,
      y: 0,
      w: 6,
      h: 4,
      config: { range: '1y', hidden: [] },
    });
    expect(await stored(app, alice.user.id)).toEqual([]);
  });

  it('works under a base path of three segments too', async () => {
    const app = await start({ basePath: '/a/b/c' });
    const alice = await person(app);
    const items = [tile({ id: 'abcd' })];
    expect((await save(app, alice, items)).status).toBe(200);
    expect(((await read(app, alice)).body as View).items).toEqual(items);
  });

  it('returns a stored document repaired, and rewrites nothing in the store [ASVS-8.2.3]', async () => {
    const app = await start();
    const alice = await person(app);
    const planted = {
      version: 1,
      items: [
        tile({ id: 'keep', x: 0, y: 0 }),
        // overlaps the first one: moved down
        tile({ id: 'over', x: 2, y: 1, config: { range: 'forever' } }),
        // a widget whose module left the profile
        tile({ id: 'gone', widget: 'fixture.left.the.profile' }),
        // out of the grid and too big
        tile({ id: 'bigg', widget: SINGLE, x: 11, y: 30, w: 99, h: 99, config: {} }),
        // a widget this person may not see, and a header widget that is no tile
        tile({ id: 'admn', widget: ADMIN, config: {} }),
        tile({ id: 'hder', widget: 'fixture.dash.header', config: {} }),
        // a second instance of a singleton, and a repeated id
        tile({ id: 'twoo', widget: SINGLE, y: 40, config: {} }),
        tile({ id: 'keep', y: 60 }),
      ],
    };
    await makePreference(app.kernel.pool, { id: alice.user.id }, KEY, planted);
    const body = (await read(app, alice)).body as View;
    expect(body.reset).toBe(false);
    expect(body.isDefault).toBe(false);
    expect(
      body.items.map((item) => [item.id, item.widget, item.x, item.y, item.w, item.h]),
    ).toEqual([
      ['keep', TRENDS, 0, 0, 6, 4],
      ['over', TRENDS, 2, 4, 6, 4],
      // no limits of its own: the grid's (12 columns, 50 rows), and moved back inside
      ['bigg', SINGLE, 0, 30, 12, 50],
    ]);
    expect(body.items[1]!.config).toEqual({ range: '1y', hidden: [] });
    expect(body.dropped).toEqual([
      { id: 'gone', reason: 'unknown-widget' },
      { id: 'admn', reason: 'not-permitted' },
      { id: 'hder', reason: 'unknown-widget' },
      { id: 'twoo', reason: 'singleton-repeated' },
      { id: 'keep', reason: 'duplicate-id' },
    ]);
    // A read changes nothing that is stored.
    expect(await stored(app, alice.user.id)).toEqual([planted]);
  });

  it('keeps what a read dropped until the next save, so a module that returns finds its tile', async () => {
    const app = await start();
    const alice = await person(app);
    const planted = {
      version: 1,
      items: [tile({ id: 'trnd' }), tile({ id: 'adm1', widget: ADMIN, y: 8, config: {} })],
    };
    await makePreference(app.kernel.pool, { id: alice.user.id }, KEY, planted);
    expect(((await read(app, alice)).body as View).dropped).toEqual([
      { id: 'adm1', reason: 'not-permitted' },
    ]);
    // The permission comes back (through the service, so the cache of decisions is emptied): the tile is
    // there again, unchanged, without anyone saving anything.
    const role = await makeRole(app.kernel.pool, { permissions: [ADMIN_WIDGET] });
    await authzOf(app).assignRole((await person(app, unique('u'), { roles: ['admin'] })).actor, {
      userId: alice.user.id,
      roleKey: role.key,
    });
    const again = (await read(app, alice)).body as View;
    expect(again.dropped).toEqual([]);
    expect(again.items.map((item) => item.id)).toEqual(['trnd', 'adm1']);
    expect(await stored(app, alice.user.id)).toEqual([planted]);
  });

  it('drops a tile whose permission the person lost, with a reason, and rewrites nothing [ASVS-8.3.1]', async () => {
    const app = await start();
    const boss = await person(app, unique('u'), { roles: ['admin'] });
    const alice = await person(app);
    const role = await makeRole(app.kernel.pool, { permissions: [ADMIN_WIDGET] });
    await authzOf(app).assignRole(boss.actor, { userId: alice.user.id, roleKey: role.key });
    const planted = { version: 1, items: [tile({ id: 'adm1', widget: ADMIN, config: {} })] };
    await makePreference(app.kernel.pool, { id: alice.user.id }, KEY, planted);
    expect(((await read(app, alice)).body as View).items.map((item) => item.id)).toEqual(['adm1']);
    await authzOf(app).removeRole(boss.actor, { userId: alice.user.id, roleKey: role.key });
    const body = (await read(app, alice)).body as View;
    expect(body.items).toEqual([]);
    expect(body.dropped).toEqual([{ id: 'adm1', reason: 'not-permitted' }]);
    expect(await stored(app, alice.user.id)).toEqual([planted]);
  });

  it.each([
    [
      'more than 20 tiles',
      {
        version: 1,
        items: Array.from({ length: 21 }, (_, i) => tile({ id: `tile${i}`, y: i * 4 })),
      },
      'too-many-items',
    ],
    ['a version this build does not know', { version: 2, items: [tile()] }, 'newer-version'],
  ])(
    'replaces %s planted through the generic preference route by the default [ASVS-8.2.3]',
    async (_name, planted, reason) => {
      const app = await start();
      const alice = await person(app);
      const put = await app.call('PUT', `/preferences/${KEY}`, {
        cookie: alice.cookie,
        csrf: alice.csrf,
        body: { value: planted },
      });
      expect(put.status).toBe(200);
      const body = (await read(app, alice)).body as View;
      expect(body).toMatchObject({ reset: true, resetReason: reason, isDefault: false });
      expect(body.items.map((item) => item.widget)).toEqual([TRENDS, SINGLE, MEMBERSHIP]);
      expect(await stored(app, alice.user.id)).toEqual([planted]);
    },
  );

  it('refuses at the generic route what is no dashboard at all, and reads a planted oversize document as the default', async () => {
    const app = await start();
    const alice = await person(app);
    for (const value of [
      'text',
      [1, 2],
      { version: 1 },
      { version: 1, items: 'x' },
      { items: [] },
    ]) {
      const reply = await app.call('PUT', `/preferences/${KEY}`, {
        cookie: alice.cookie,
        csrf: alice.csrf,
        body: { value },
      });
      expect(reply.status).toBe(422);
    }
    // A row that bypassed the route (an old build, a restore) with a document of 40 KiB.
    await makePreference(app.kernel.pool, { id: alice.user.id }, KEY, {
      version: 1,
      items: Array.from({ length: 20 }, (_, i) =>
        tile({ id: `big${i}`, y: i * 4, config: { range: '3m', pad: 'x'.repeat(3000) } }),
      ),
    });
    const body = (await read(app, alice)).body as View;
    expect(body.items.every((item) => item.config.pad === undefined)).toBe(true);
    expect(JSON.stringify(body).length).toBeLessThan(8 * 1024);
  });

  it('gives the default when the stored row no longer has the structure of a dashboard', async () => {
    const app = await start();
    const alice = await person(app);
    await makePreference(app.kernel.pool, { id: alice.user.id }, KEY, 'not a dashboard');
    const body = (await read(app, alice)).body as View;
    expect(body.isDefault).toBe(true);
    expect(body.items.map((item) => item.widget)).toEqual([TRENDS, SINGLE, MEMBERSHIP]);
  });

  it('keeps two people’s dashboards apart, and a route takes no user id [ASVS-8.2.3]', async () => {
    const app = await start();
    const alice = await person(app);
    const bob = await person(app);
    expect(
      (await save(app, alice, [tile({ id: 'aaaa', config: { range: 'all', hidden: [] } })])).status,
    ).toBe(200);
    expect((await save(app, bob, [tile({ id: 'bbbb', x: 3, w: 4 })])).status).toBe(200);
    const [a, b] = [(await read(app, alice)).body as View, (await read(app, bob)).body as View];
    expect(a.items.map((item) => item.id)).toEqual(['aaaa']);
    expect(a.items[0]!.config.range).toBe('all');
    expect(b.items.map((item) => item.id)).toEqual(['bbbb']);
    expect(JSON.stringify(a)).not.toContain('bbbb');
    expect(JSON.stringify(b)).not.toContain('aaaa');
    // Nothing in the path or query can name another person.
    const other = await app.get(`/ui/dashboard?userId=${bob.user.id}`, { cookie: alice.cookie });
    expect((other.body as View).items.map((item) => item.id)).toEqual(['aaaa']);
    expect((await app.get(`/ui/dashboard/${bob.user.id}`, { cookie: alice.cookie })).status).toBe(
      404,
    );
    const withUser = await app.call('PUT', '/ui/dashboard', {
      cookie: alice.cookie,
      csrf: alice.csrf,
      body: { userId: bob.user.id, items: [] },
    });
    expect(withUser.status).toBe(422);
    expect((await stored(app, bob.user.id))[0]).toMatchObject({ items: [{ id: 'bbbb' }] });
  });
});

describe('PUT /ui/dashboard', () => {
  it('stores the caller’s dashboard and answers what a read now gives', async () => {
    const app = await start();
    const alice = await person(app);
    const items = [
      tile({ id: 'aaaa', y: 0 }),
      tile({ id: 'bbbb', widget: SINGLE, x: 6, w: 3, h: 2, config: {} }),
    ];
    const reply = await save(app, alice, items);
    expect(reply.status).toBe(200);
    expect(reply.res.headers.get('cache-control')).toBe('no-store');
    const body = reply.body as View;
    expect(body).toMatchObject({ version: 1, dropped: [], reset: false, isDefault: false });
    expect(body.items).toEqual(items);
    expect((await read(app, alice)).body).toEqual(body);
    expect(await stored(app, alice.user.id)).toEqual([{ version: 1, items }]);
  });

  it('stores what the widget’s schema made of the configuration: defaults in, unknown keys out', async () => {
    const app = await start();
    const alice = await person(app);
    const reply = await save(app, alice, [
      tile({ id: 'aaaa', config: { range: '2y', stray: true } }),
    ]);
    expect((reply.body as View).items[0]!.config).toEqual({ range: '2y', hidden: [] });
    expect(JSON.stringify(await stored(app, alice.user.id))).not.toContain('stray');
  });

  it('moves an overlap down instead of storing it, and keeps the tiles by row and column', async () => {
    const app = await start();
    const alice = await person(app);
    const reply = await save(app, alice, [tile({ id: 'aaaa', y: 0 }), tile({ id: 'bbbb', y: 1 })]);
    expect((reply.body as View).items.map((item) => [item.id, item.y])).toEqual([
      ['aaaa', 0],
      ['bbbb', 4],
    ]);
  });

  it('stores an empty dashboard: a person may remove every tile, and it is not the default again', async () => {
    const app = await start();
    const alice = await person(app);
    expect((await save(app, alice, [])).status).toBe(200);
    expect((await read(app, alice)).body).toMatchObject({
      items: [],
      isDefault: false,
      reset: false,
    });
  });

  it('records the call in the audit trail, with no body', async () => {
    const app = await start();
    const alice = await person(app);
    await save(app, alice, [
      tile({ id: 'aaaa', config: { range: '3m', hidden: ['secret-looking-text'] } }),
    ]);
    const rows = (
      await app.kernel.pool.query(
        "select user_id, outcome, body, path from audit_event where path like '%/ui/dashboard' order by occurred_at, id",
      )
    ).rows as { user_id: string; outcome: string; body: unknown; path: string }[];
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ user_id: alice.user.id, outcome: 'ok', body: null });
    expect(JSON.stringify(rows)).not.toContain('secret-looking-text');
  });

  it('refuses what is not allowed with a 422 that names the field and never repeats a value [ASVS-8.2.3]', async () => {
    const app = await start();
    const alice = await person(app);
    const sentinel = 'sentinel-value-1f3a9';
    const cases: [string, Tile[], string][] = [
      ['an unknown widget', [tile({ widget: `fixture.${sentinel}` })], 'items[0].widget'],
      ['a header widget', [tile({ widget: 'fixture.dash.header', config: {} })], 'items[0].widget'],
      ['a widget the caller may not see', [tile({ widget: ADMIN, config: {} })], 'items[0].widget'],
      [
        'a configuration the schema refuses',
        [tile(), tile({ id: 'cfg2', y: 4, config: { range: sentinel } })],
        'items[1].config',
      ],
      [
        'a configuration of the wrong type',
        [tile({ config: sentinel as unknown as Tile['config'] })],
        // the structure of the body is the route's check, and its paths are the validator's
        'items.0.config',
      ],
      [
        'a configuration that is too long',
        [tile({ config: { range: '3m', pad: sentinel.repeat(30) } })],
        'items[0].config',
      ],
      ['a repeated id', [tile({ id: 'dupe' }), tile({ id: 'dupe', y: 4 })], 'items[1].id'],
      ['an id with capitals', [tile({ id: 'ABCD' })], 'items[0].id'],
      [
        'a repeated singleton',
        [
          tile({ id: 'one1', widget: SINGLE, config: {} }),
          tile({ id: 'two2', widget: SINGLE, y: 4, config: {} }),
        ],
        'items[1].widget',
      ],
      ['a width above the limit', [tile({ w: 13 })], 'items[0].w'],
      ['a width below the limit', [tile({ w: 1 })], 'items[0].w'],
      ['a fractional height', [tile({ h: 2.5 })], 'items[0].h'],
      ['a tile outside the columns', [tile({ x: 8, w: 6 })], 'items[0].x'],
      ['a negative row', [tile({ y: -1 })], 'items[0].y'],
    ];
    for (const [name, items, path] of cases) {
      const reply = await save(app, alice, items);
      expect(reply.status, name).toBe(422);
      const body = reply.body as Problem;
      expect(
        body.errors?.map((error) => error.path),
        name,
      ).toContain(path);
      expect(JSON.stringify(body), name).not.toContain(sentinel);
    }
    expect(await stored(app, alice.user.id)).toEqual([]);
  });

  it('refuses more than 20 tiles and a body that is no dashboard', async () => {
    const app = await start();
    const alice = await person(app);
    const many = Array.from({ length: 21 }, (_, i) =>
      tile({ id: `tile${i}`, y: i * 4, config: {} }),
    );
    expect((await save(app, alice, many)).status).toBe(422);
    for (const body of [{}, { items: 'x' }, { items: [null] }, { items: [], extra: 1 }, []]) {
      const reply = await app.call('PUT', '/ui/dashboard', {
        cookie: alice.cookie,
        csrf: alice.csrf,
        body,
      });
      expect(reply.status).toBe(422);
    }
    expect(await stored(app, alice.user.id)).toEqual([]);
  });

  it('stores 20 tiles with the longest configuration of the trends chart, and refuses a document over 8 KiB', async () => {
    const app = await start();
    const alice = await person(app);
    const trends = Array.from({ length: 20 }, (_, i) =>
      tile({
        id: `trnd${String(i).padStart(2, '0')}`,
        x: (i % 2) * 6,
        y: Math.floor(i / 2) * 4,
        config: { range: '2y', hidden: Array(5).fill('h'.repeat(19)) },
      }),
    );
    expect((await save(app, alice, trends)).status).toBe(200);
    const size = JSON.stringify((await stored(app, alice.user.id))[0]).length;
    expect(size).toBeLessThan(8 * 1024);

    // 20 notes of 380 characters are 20 configurations of nearly 400 bytes: more than the store holds.
    const notes = Array.from({ length: 20 }, (_, i) =>
      tile({
        id: `note${String(i).padStart(2, '0')}`,
        widget: NOTES,
        x: (i % 6) * 2,
        y: Math.floor(i / 6),
        w: 2,
        h: 1,
        config: { text: 'n'.repeat(380) },
      }),
    );
    const refused = await save(app, alice, notes);
    expect(refused.status).toBe(422);
    expect((refused.body as Problem).errors?.map((error) => error.path)).toEqual(['items']);
    expect(JSON.stringify(refused.body)).not.toContain('nnnnnnnnnn');
    // what was stored before is untouched
    expect(JSON.stringify((await stored(app, alice.user.id))[0]).length).toBe(size);
  });

  it('leaves one valid document after two saves at the same time', async () => {
    const app = await start();
    const alice = await person(app);
    const first = [tile({ id: 'aaaa', config: { range: '3m', hidden: [] } })];
    const second = [
      tile({ id: 'bbbb', x: 4, config: { range: 'all', hidden: [] } }),
      tile({ id: 'cccc', y: 4 }),
    ];
    const [one, two] = await Promise.all([save(app, alice, first), save(app, alice, second)]);
    expect([one.status, two.status]).toEqual([200, 200]);
    const rows = await stored(app, alice.user.id);
    expect(rows).toHaveLength(1);
    const body = (await read(app, alice)).body as View;
    expect([first.map((i) => i.id), second.map((i) => i.id)]).toContainEqual(
      body.items.map((item) => item.id),
    );
    expect(body).toMatchObject({ dropped: [], reset: false });
  });

  it('writes nobody else’s row, and the generic route lists the same document', async () => {
    const app = await start();
    const alice = await person(app);
    const bob = await person(app);
    await save(app, alice, [tile({ id: 'aaaa' })]);
    expect(await stored(app, bob.user.id)).toEqual([]);
    const list = (await app.get('/preferences', { cookie: alice.cookie })).body as {
      result: { key: string; value: { items: { id: string }[] } }[];
    };
    const row = list.result.find((entry) => entry.key === KEY);
    expect(row?.value.items.map((item) => item.id)).toEqual(['aaaa']);
  });
});

describe('who may call it [ASVS-8.3.1]', () => {
  it('turns an anonymous caller away from both routes with a 401', async () => {
    const app = await start();
    expect((await app.get('/ui/dashboard')).status).toBe(401);
    expect((await app.call('PUT', '/ui/dashboard', { body: { items: [] } })).status).toBe(401);
  });

  it('turns away a signed-in caller who lacks the permission with a 403, for each of the two', async () => {
    const readOnly = await start({ permissions: [READ] });
    const reader = await person(readOnly);
    expect((await read(readOnly, reader)).status).toBe(200);
    expect((await save(readOnly, reader, [])).status).toBe(403);

    // Saving stores through the preference service as the caller, so it needs `core.settings.preference.write` too.
    const writeOnly = await start({ permissions: [WRITE] });
    const writer = await person(writeOnly);
    expect((await read(writeOnly, writer)).status).toBe(403);
    expect((await save(writeOnly, writer, [tile()])).status).toBe(403);
    expect(await stored(writeOnly, writer.user.id)).toEqual([]);

    const both = await start({ permissions: [WRITE, 'core.settings.preference.write'] });
    const holder = await person(both);
    expect((await save(both, holder, [tile()])).status).toBe(200);

    const neither = await start({ permissions: ['core.identity.me.read'] });
    const nobody = await person(neither);
    expect((await read(neither, nobody)).status).toBe(403);
    expect((await save(neither, nobody, [])).status).toBe(403);
    expect(await stored(neither, nobody.user.id)).toEqual([]);
  });

  it('is held by the role user and by Admin', async () => {
    const app = await start();
    const plain = await person(app);
    const boss = await person(app, unique('u'), { roles: ['admin'] });
    for (const who of [plain, boss]) {
      const own = (await app.get('/account/permissions', { cookie: who.cookie })).body as {
        permissions?: string[];
      };
      expect(JSON.stringify(own)).toContain(READ);
      expect(JSON.stringify(own)).toContain(WRITE);
      expect((await read(app, who)).status).toBe(200);
    }
  });

  it('checks the permission again in the service, and acts only for a signed-in user', async () => {
    const app = await start({ permissions: ['core.identity.me.read'] });
    const nobody = await person(app);
    const shell = shellOf(app).dashboard;
    await expect(shell.get(nobody.actor)).rejects.toThrow(Forbidden);
    await expect(shell.save(nobody.actor, [])).rejects.toThrow(Forbidden);
    await expect(shell.get({ kind: 'anonymous' })).rejects.toThrow(Unauthorized);
    await expect(shell.save({ kind: 'anonymous' }, [])).rejects.toThrow(Unauthorized);
    expect(await stored(app, nobody.user.id)).toEqual([]);
  });

  it('validates in the service as well: a caller who bypasses the route still gets an Invalid naming the field', async () => {
    const app = await start();
    const alice = await person(app);
    const shell = shellOf(app).dashboard;
    await expect(
      shell.save(alice.actor, [tile({ widget: 'fixture.nope' })] as never),
    ).rejects.toMatchObject({ errors: [{ path: 'items[0].widget' }] });
    await expect(
      shell.save(alice.actor, [tile({ config: { range: 'x' } })] as never),
    ).rejects.toThrow(Invalid);
    const saved = await shell.save(alice.actor, [tile({ id: 'svc1' })] as never);
    expect(saved.items.map((item) => item.id)).toEqual(['svc1']);
    expect((await shell.get(alice.actor)).items.map((item) => item.id)).toEqual(['svc1']);
    expect(await stored(app, alice.user.id)).toHaveLength(1);
  });
});

describe('the start-up check of a widget entry', () => {
  it.each([
    ['a minW above maxW', { w: 4, h: 3, minW: 6, maxW: 5 }, 'minW must not exceed maxW'],
    [
      'a default outside the 12 columns',
      { w: 4, h: 3, default: { x: 10, y: 0, w: 4, h: 3 } },
      'default must fit',
    ],
    ['a size outside its own limits', { w: 2, h: 3, minW: 3 }, 'w must not be below minW'],
  ])('stops the start for %s, and names the entry’s field', async (_name, grid, message) => {
    const broken = defineModule({
      id: 'fixture.broken',
      version: '1.0.0',
      contributes: {
        'ui.widget': [
          {
            id: 'fixture.broken.w',
            slot: 'dashboard',
            component: 'FixtureBroken',
            public: true,
            grid,
          },
        ],
      },
    });
    await expect(
      start({
        extraModules: [
          { id: 'fixture.broken', manifest: broken, requires: ['@scorpion/core-ui-shell'] },
        ],
      }),
    ).rejects.toThrow(message);
  });

  it('stops the start for an icon that is not in the table', async () => {
    const broken = defineModule({
      id: 'fixture.broken',
      version: '1.0.0',
      contributes: {
        'ui.widget': [
          {
            id: 'fixture.broken.w',
            slot: 'dashboard',
            component: 'FixtureBroken',
            public: true,
            icon: 'rocket',
          },
        ],
      },
    });
    await expect(
      start({
        extraModules: [
          { id: 'fixture.broken', manifest: broken, requires: ['@scorpion/core-ui-shell'] },
        ],
      }),
    ).rejects.toThrow('icon table');
  });
});
