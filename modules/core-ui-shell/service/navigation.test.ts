import type { Actor } from '@scorpion/contracts';
import { ANONYMOUS } from '@scorpion/contracts';
import { KernelStartupError } from '@scorpion/kernel';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { REGISTRIES } from '../registries.ts';
import { createNavigationService } from './navigation.ts';

type Entries = Partial<Record<keyof typeof REGISTRIES, unknown[]>>;

const user: Actor = { kind: 'user', userId: 'u1', via: 'session' } as never;
const holders = (...granted: string[]) => ({
  can: (actor: Actor, permission: string) =>
    Promise.resolve(actor.kind === 'user' && granted.includes(permission)),
});

function service(entries: Entries, declared: string[], authz = holders()) {
  const parsed = Object.fromEntries(
    Object.entries(REGISTRIES).map(([name, schema]) => [
      name,
      (entries[name as keyof typeof REGISTRIES] ?? []).map((entry) => schema.parse(entry)),
    ]),
  );
  return createNavigationService(
    {
      registry: (name) => parsed[name] ?? [],
      permissions: declared.map((id) => ({ id, module: 'm', description: id })),
    },
    authz,
  );
}

const pages = [
  { path: '/', public: true, publicReason: 'start page' },
  { path: '/profile', permission: 'm.profile.read' },
  { path: '/admin/users', permission: 'm.user.manage' },
  { path: '/admin/users/:id', permission: 'm.user.manage' },
];
const nav = [
  { id: 'home', label: 'nav.home', path: '/', section: 'main', order: 0, public: true },
  {
    id: 'profile',
    label: 'nav.profile',
    path: '/profile',
    section: 'account',
    permission: 'm.profile.read',
  },
  {
    id: 'users',
    label: 'nav.users',
    path: '/admin/users',
    section: 'admin',
    order: 10,
    permission: 'm.user.manage',
  },
];
const declared = ['m.profile.read', 'm.user.manage'];

describe('navigation(actor)', () => {
  const shell = service({ 'ui.routes': pages, 'ui.nav': nav }, declared, holders('m.profile.read'));

  it('lists only public pages and links for an anonymous caller', async () => {
    const result = await shell.navigation(ANONYMOUS);
    expect(result.routes).toEqual(['/']);
    expect(result.nav.map((entry) => entry.id)).toEqual(['home']);
  });

  it('lists what a role may open, and no administration for a plain user', async () => {
    const result = await shell.navigation(user);
    expect(result.routes).toEqual(['/', '/profile']);
    expect(result.nav.map((entry) => entry.id)).toEqual(['home', 'profile']);
    expect(JSON.stringify(result)).not.toContain('admin');
  });

  it('lists the administration for a caller who holds its permission, pages with parameters included', async () => {
    const admin = service({ 'ui.routes': pages, 'ui.nav': nav }, declared, holders(...declared));
    const result = await admin.navigation(user);
    expect(result.routes).toEqual(['/', '/admin/users', '/admin/users/:id', '/profile']);
    // `users` has order 10 and `profile` the default 100, so its section comes first.
    expect(result.nav.map((entry) => entry.id)).toEqual(['home', 'users', 'profile']);
  });

  it('keeps sections in the order of their first entry, then sorts by order and id', async () => {
    const many = service(
      {
        'ui.routes': [
          { path: '/', public: true, publicReason: 'r' },
          { path: '/b', public: true, publicReason: 'r' },
          { path: '/c', public: true, publicReason: 'r' },
        ],
        'ui.nav': [
          { id: 'z', label: 'z', path: '/c', section: 'two', order: 5, public: true },
          { id: 'a', label: 'a', path: '/b', section: 'one', order: 1, public: true },
          { id: 'b', label: 'b', path: '/', section: 'two', order: 1, public: true },
          { id: 'c', label: 'c', path: '/', section: 'one', order: 1, public: true },
        ],
      },
      [],
    );
    const { nav: sorted } = await many.navigation(ANONYMOUS);
    expect(sorted.map((entry) => `${entry.section}:${entry.id}`)).toEqual([
      'one:a',
      'one:c',
      'two:b',
      'two:z',
    ]);
  });

  it('hides a link whose own permission is missing even when the page is open', async () => {
    const result = await service(
      {
        'ui.routes': [{ path: '/x', public: true, publicReason: 'open page' }],
        'ui.nav': [{ id: 'x', label: 'x', path: '/x', section: 's', permission: 'm.user.manage' }],
      },
      declared,
    ).navigation(user);
    expect(result.routes).toEqual(['/x']);
    expect(result.nav).toEqual([]);
  });

  it('asks the authoriser once per permission, however many entries name it', async () => {
    let asked = 0;
    const counting = {
      can: () => {
        asked += 1;
        return Promise.resolve(true);
      },
    };
    await service({ 'ui.routes': pages, 'ui.nav': nav }, declared, counting).navigation(user);
    expect(asked).toBe(2);
  });

  it('gives the themes and the cards the caller may see', async () => {
    const result = await service(
      {
        'ui.theme': [{ id: 'scorpionlight', label: 'theme.light', colorScheme: 'light' }],
        'ui.widget': [
          { id: 'open', slot: 'dashboard', component: 'Open', public: true },
          { id: 'closed', slot: 'dashboard', component: 'Closed', permission: 'm.user.manage' },
        ],
      },
      declared,
    ).navigation(user);
    expect(result.themes).toEqual([
      { id: 'scorpionlight', label: 'theme.light', colorScheme: 'light' },
    ]);
    expect(result.widgets.map((widget) => widget.id)).toEqual(['open']);
  });

  describe('the grid fields of a widget (M11)', () => {
    const old = { id: 'old', slot: 'dashboard', component: 'Old', order: 10, public: true };
    const placed = {
      id: 'placed',
      slot: 'dashboard',
      component: 'Placed',
      order: 20,
      permission: 'm.profile.read',
      grid: { w: 6, h: 4, minW: 3, default: { x: 0, y: 0, w: 6, h: 4 } },
      label: 'widget.placed',
      description: 'widget.placed.about',
      icon: 'list',
      configSchema: z.object({ range: z.string().default('1y') }),
    };
    const shell = service({ 'ui.widget': [old, placed] }, declared, holders('m.profile.read'));

    it('answers an entry that has none exactly as before', async () => {
      const result = await shell.navigation(user);
      expect(result.widgets[0]).toStrictEqual({
        id: 'old',
        slot: 'dashboard',
        component: 'Old',
        order: 10,
      });
    });

    it('lists them for a widget the caller may see, with the JSON Schema of its configuration', async () => {
      const result = await shell.navigation(user);
      expect(result.widgets[1]).toStrictEqual({
        id: 'placed',
        slot: 'dashboard',
        component: 'Placed',
        order: 20,
        grid: { w: 6, h: 4, minW: 3, default: { x: 0, y: 0, w: 6, h: 4 } },
        label: 'widget.placed',
        description: 'widget.placed.about',
        icon: 'list',
        configSchema: {
          type: 'object',
          properties: { range: { type: 'string', default: '1y' } },
        },
      });
    });

    it('derives the schema from the input side, so a defaulted field is optional and a nullable one says so', async () => {
      const withNull = {
        ...placed,
        id: 'nullable',
        configSchema: z.object({
          service: z.uuid().nullable().default(null),
          hidden: z
            .array(z.string().regex(/^[0-9a-f]{12}$/))
            .max(5)
            .default([]),
        }),
      };
      const result = await service(
        { 'ui.widget': [withNull] },
        declared,
        holders('m.profile.read'),
      ).navigation(user);
      const schema = result.widgets[0]!.configSchema as {
        required?: string[];
        properties: Record<string, { anyOf?: unknown[]; maxItems?: number }>;
      };
      expect(schema.required ?? []).toEqual([]);
      expect(schema.properties.service!.anyOf).toHaveLength(2);
      expect(schema.properties.hidden!.maxItems).toBe(5);
      expect(JSON.stringify(result)).not.toContain('$schema');
    });

    it('says nothing about a widget the caller may not see', async () => {
      const result = await service({ 'ui.widget': [old, placed] }, declared, holders()).navigation(
        user,
      );
      expect(result.widgets.map((widget) => widget.id)).toEqual(['old']);
      expect(JSON.stringify(result)).not.toContain('widget.placed');
    });
  });
});

describe('the start-up checks', () => {
  const fails = (entries: Entries, declaredPermissions: string[] = declared) =>
    expect(() => service(entries, declaredPermissions)).toThrow(KernelStartupError);

  it('refuses a permission no module declares', () => {
    fails({ 'ui.routes': [{ path: '/x', permission: 'm.typo.read' }] });
    fails({
      'ui.routes': [{ path: '/', public: true, publicReason: 'r' }],
      'ui.nav': [{ id: 'x', label: 'x', path: '/', section: 's', permission: 'm.typo.read' }],
    });
    fails({ 'ui.widget': [{ id: 'w', slot: 's', component: 'W', permission: 'm.typo.read' }] });
  });

  it('refuses a page, a link or a card registered twice', () => {
    fails({ 'ui.routes': [pages[0], pages[0]] });
    fails({
      'ui.routes': [pages[0]],
      'ui.nav': [nav[0], nav[0]],
    });
    fails({
      'ui.widget': [
        { id: 'w', slot: 's', component: 'W', public: true },
        { id: 'w', slot: 's', component: 'W', public: true },
      ],
    });
  });

  it('refuses a widget whose configSchema JSON Schema cannot express, naming the widget', () => {
    const entry = {
      id: 'unfit.widget',
      slot: 'dashboard',
      component: 'Unfit',
      public: true,
    };
    fails({
      'ui.widget': [{ ...entry, configSchema: z.object({ n: z.bigint() }) }],
    });
    fails({
      'ui.widget': [{ ...entry, configSchema: z.object({ f: z.custom<() => void>(() => true) }) }],
    });
    try {
      service({ 'ui.widget': [{ ...entry, configSchema: z.object({ d: z.date() }) }] }, declared);
    } catch (error) {
      expect((error as KernelStartupError).message).toContain('"unfit.widget"');
      return;
    }
    throw new Error('expected a start-up error');
  });

  it('refuses a link to a page nobody registered', () => {
    fails({ 'ui.routes': [], 'ui.nav': [nav[0]] });
  });

  it('names every problem at once', () => {
    try {
      service(
        { 'ui.routes': [{ path: '/x', permission: 'm.typo.read' }], 'ui.nav': [nav[0]] },
        declared,
      );
    } catch (error) {
      expect((error as KernelStartupError).message).toContain('m.typo.read');
      expect((error as KernelStartupError).message).toContain('"home"');
      return;
    }
    throw new Error('expected a start-up error');
  });
});
