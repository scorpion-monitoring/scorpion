// GET /ui/navigation (core.ui-shell, ADR-0027): the links and pages a caller may use, decided on the
// server from the registries and the caller's permissions. A fixture module contributes one page and
// one link behind a permission and one open page; the same checks run under `/` and under a base path
// of three segments (defect 11).
import { defineModule } from '@scorpion/kernel';
import { describe, expect, it } from 'vitest';
import { useIdentityApp } from './testing/identity-app.ts';

const MANAGE = 'fixture.pages.manage';
const pages = defineModule({
  id: 'fixture.pages',
  version: '1.0.0',
  permissions: { [MANAGE]: { description: 'Open the fixture admin page' } },
  contributes: {
    'ui.routes': [
      { path: '/fixture/open', public: true, publicReason: 'A page anyone may read.' },
      { path: '/fixture/admin', permission: MANAGE },
      { path: '/fixture/admin/:id', permission: MANAGE },
    ],
    'ui.nav': [
      {
        id: 'fixture.open',
        label: 'fixture.open',
        path: '/fixture/open',
        section: 'fixture',
        public: true,
      },
      {
        id: 'fixture.admin',
        label: 'fixture.admin',
        path: '/fixture/admin',
        section: 'fixture',
        permission: MANAGE,
      },
    ],
  },
});

// What core.ui-shell, core.identity and the registry modules open to anybody (their public pages), and what a signed-in user
// holds on top. The fixture module's own pages are added by each test.
const PUBLIC_PAGES = [
  '/',
  '/docs',
  '/forgot-password',
  '/legal/:page',
  '/link-sign-in',
  '/login',
  // M7 sprint 6: what a Reviewer made public (registry.services, registry.organisations); anyone may open them.
  '/public/organisations/:id',
  '/public/services/:slug',
  '/register',
  '/reset-password',
  '/setup',
  '/verify-email',
];
const sorted = (...paths: string[]) => paths.sort();

interface Navigation {
  nav: { id: string; path: string }[];
  routes: string[];
  themes: { id: string }[];
}

const harness = useIdentityApp();

describe.each(['/', '/a/b/c'])('GET /ui/navigation under BASE_PATH %s', (basePath) => {
  const start = (extra: { permissions?: string[] } = {}) =>
    harness.start({
      basePath,
      extraModules: [
        { id: 'fixture.pages', manifest: pages, requires: ['@scorpion/core-ui-shell'] },
      ],
      ...extra,
    });

  it('lists only the public pages for an anonymous caller, and says nothing is cached', async () => {
    const app = await start();
    const reply = await app.get('/ui/navigation');
    expect(reply.status).toBe(200);
    expect(reply.res.headers.get('cache-control')).toBe('no-store');
    const body = reply.body as Navigation;
    expect(body.routes).toEqual(sorted(...PUBLIC_PAGES, '/fixture/open'));
    expect(body.nav.map((entry) => entry.id)).toEqual(['home', 'docs', 'fixture.open']);
    expect(body.themes.map((theme) => theme.id)).toEqual(['scorpionlight', 'scorpiondark']);
    expect(JSON.stringify(body)).not.toMatch(/admin/i);
  });

  it('shows a plain user no page or link behind a permission they lack', async () => {
    const app = await start();
    const { cookie } = await app.signedIn('plain');
    const body = (await app.get('/ui/navigation', { cookie })).body as Navigation;
    // A plain user also has the profile page and its link (core.identity.profile.read), and the inbox and
    // the notification settings (core.notifications, M5 sprint 4).
    expect(body.routes).toEqual(
      sorted(
        ...PUBLIC_PAGES,
        '/fixture/open',
        '/profile',
        '/inbox',
        '/profile/notifications',
        // The page of one organisation (registry.organisations, M6): every signed-in person reads organisations.
        '/organisations/:id',
        // M6 sprint 5: the member and manager screen (the manager part draws itself from the API).
        '/account/organisations',
        // M7 sprint 4: the catalogue, and the two pages registered ahead of their screens (every User may read and create).
        '/services',
        '/services/new',
        '/services/:slug',
      ),
    );
    expect(body.nav.map((entry) => entry.id)).toContain('account.profile');
    expect(body.nav.map((entry) => entry.id)).not.toContain('fixture.admin');
    expect(JSON.stringify(body)).not.toContain('/fixture/admin');
  });

  it('shows a caller the page and the link when they hold the permission, and not the others', async () => {
    const holder = await start({ permissions: [MANAGE] });
    const { cookie } = await holder.signedIn('holder');
    const body = (await holder.get('/ui/navigation', { cookie })).body as Navigation;
    expect(body.routes).toContain('/fixture/admin');
    expect(body.routes).toContain('/fixture/admin/:id');
    expect(body.nav.map((entry) => entry.id)).toContain('fixture.admin');

    const other = await start({ permissions: ['core.identity.me.read'] });
    const { cookie: otherCookie } = await other.signedIn('other');
    const denied = (await other.get('/ui/navigation', { cookie: otherCookie })).body as Navigation;
    expect(denied.routes).not.toContain('/fixture/admin');
    expect(denied.nav.map((entry) => entry.id)).not.toContain('fixture.admin');
  });

  it('shows the Admin role every page, as it holds every declared permission', async () => {
    const app = await start();
    const { cookie } = await app.signedIn('boss', { roles: ['admin'] });
    const body = (await app.get('/ui/navigation', { cookie })).body as Navigation;
    expect(body.routes).toEqual(
      sorted(
        ...PUBLIC_PAGES,
        '/fixture/admin',
        '/fixture/admin/:id',
        '/fixture/open',
        '/profile',
        '/inbox',
        '/profile/notifications',
        // M7 sprint 4: the catalogue, and the two pages registered ahead of their screens (every User may read and create).
        '/services',
        '/services/new',
        '/services/:slug',
        // The administration of M5 sprint 3: users and pending approvals (core.identity), roles and settings (the shell).
        '/admin/users',
        '/admin/users/:id',
        '/admin/users/pending',
        '/admin/roles',
        '/admin/settings',
        '/admin/settings/:module',
        '/admin/settings/branding',
        '/admin/settings/secrets',
        '/admin/settings/vocabularies',
        // M5 sprint 4: the logs, the system page (core.audit) and the notification status (core.notifications).
        '/admin/logs',
        '/admin/logs/:id',
        '/admin/system',
        '/admin/notifications',
        // M6 sprint 4: the page of an organisation (every signed-in person) and the administrator's editor.
        '/organisations/:id',
        '/admin/organisations',
        '/admin/organisations/new',
        '/admin/organisations/:id',
        // M6 sprint 5: the member screen and the administrator's membership requests.
        '/account/organisations',
        '/admin/memberships',
      ),
    );
    expect(body.nav.map((entry) => entry.id)).toEqual([
      'home',
      'services',
      'docs',
      'account.profile',
      'account.inbox',
      'account.organisations',
      'account.notifications',
      'admin.users',
      'admin.users.pending',
      'admin.roles',
      'admin.settings',
      'admin.organisations',
      'admin.memberships',
      'admin.logs',
      'admin.notifications',
      'admin.system',
      'fixture.admin',
      'fixture.open',
    ]);
  });

  it('treats a cookie that is no longer valid as no caller', async () => {
    const app = await start();
    const { cookie, csrf } = await app.signedIn('leaver', { roles: ['admin'] });
    expect(((await app.get('/ui/navigation', { cookie })).body as Navigation).routes).toContain(
      '/fixture/admin',
    );
    expect((await app.post('/auth/logout', { cookie, csrf })).status).toBe(204);
    const after = (await app.get('/ui/navigation', { cookie })).body as Navigation;
    expect(after.routes).not.toContain('/fixture/admin');
  });
});

describe('a profile without core.ui-shell', () => {
  it('still starts and serves the API: the route is not there, sign-in works', async () => {
    const app = await harness.start({ uiShell: false });
    expect(app.kernel.profile.modules.map((module) => module.id)).not.toContain('core.ui-shell');
    expect((await app.get('/ui/navigation')).status).toBe(404);
    const { cookie } = await app.signedIn('headless');
    expect((await app.get('/auth/me', { cookie })).status).toBe(200);
  });
});
