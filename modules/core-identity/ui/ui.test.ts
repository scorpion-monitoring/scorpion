// The two halves of the pages of core.identity must agree: `routes.ts` says who may open a path (the
// server), `index.ts` says what is shown there (the web app). The pages are public or need a permission
// that the module declares, and every text exists in every shipped language.
import { MAX_UPLOAD_BYTES } from '@scorpion/core-blob/public';
import { PUBLIC_PAGES } from '@scorpion/core-ui-shell/public';
import { ApiError } from '@scorpion/contracts/client';
import { catalogueProblems } from '@scorpion/ui-kit/i18n';
import { describe, expect, it } from 'vitest';
import manifest from '../module.ts';
import { MAX_AVATAR_BYTES } from './limits.ts';
import routes, { messages, widgets } from './index.ts';
import { IDENTITY_NAV, IDENTITY_ROUTES, IDENTITY_WIDGETS } from './routes.ts';

describe('the pages of core.identity', () => {
  it('are the same paths in the server half and the browser half', () => {
    expect(routes.map((route) => route.path).sort()).toEqual(
      IDENTITY_ROUTES.map((route) => route.path).sort(),
    );
  });

  it('are contributed to the registries of the shell, as the manifest says', () => {
    expect(manifest.contributes?.['ui.routes']).toEqual(IDENTITY_ROUTES);
    expect(manifest.contributes?.['ui.nav']).toEqual(IDENTITY_NAV);
    expect(manifest.contributes?.['ui.widget']).toEqual(IDENTITY_WIDGETS);
    expect(typeof manifest.ui).toBe('function');
  });

  it('are public with a reason, or need a permission the module declares', () => {
    const declared = new Set(Object.keys(manifest.permissions ?? {}));
    for (const route of IDENTITY_ROUTES) {
      if (route.public) {
        expect(route.publicReason?.length, route.path).toBeGreaterThan(30);
      } else {
        expect(declared.has(route.permission!), route.path).toBe(true);
      }
    }
  });

  it('have a widget in the browser half for every widget entry, behind a permission the module declares', () => {
    expect(Object.keys(widgets).sort()).toEqual(IDENTITY_WIDGETS.map((w) => w.component).sort());
    const declared = new Set(Object.keys(manifest.permissions ?? {}));
    for (const widget of IDENTITY_WIDGETS)
      expect(declared.has(widget.permission!), widget.id).toBe(true);
  });

  it('make public exactly the pages that the shell lists as public for this module', () => {
    const own = IDENTITY_ROUTES.filter((route) => route.public).map((route) => route.path);
    for (const path of own) expect(PUBLIC_PAGES, path).toContain(path);
  });

  it('are the paths that the mails and the OIDC callback of the module link to', async () => {
    const { RESET_PAGE, VERIFY_PAGE, SIGN_IN_PAGE, OIDC_LINK_PAGE, FORGOT_PASSWORD_PAGE } =
      await import('../service/mail-links.ts');
    const paths = routes.map((route) => route.path);
    for (const linked of [
      RESET_PAGE,
      VERIFY_PAGE,
      SIGN_IN_PAGE,
      OIDC_LINK_PAGE,
      FORGOT_PASSWORD_PAGE,
    ]) {
      expect(paths, linked).toContain(linked);
    }
  });

  it('have a link only to a page of the module, and a text for every label and section', () => {
    const paths = new Set(IDENTITY_ROUTES.map((route) => route.path));
    for (const entry of IDENTITY_NAV) {
      expect(paths.has(entry.path), entry.id).toBe(true);
      for (const locale of ['en', 'de']) {
        expect(messages[locale]?.[entry.label], `${locale} ${entry.label}`).toBeTruthy();
        // The `admin` section is the shell's (it owns the sections of the navigation and its label); the others are this module's.
        if (entry.section !== 'admin') {
          expect(messages[locale]?.[`nav.section.${entry.section}`], entry.section).toBeTruthy();
        }
      }
    }
  });

  it('have every text in English and German, with the same placeholders', () => {
    expect(catalogueProblems(messages)).toEqual([]);
  });

  it('have a text for every key the components use', async () => {
    const { globSync, readFileSync } = await import('node:fs');
    const root = new URL('.', import.meta.url).pathname;
    const used = new Set<string>();
    for (const file of globSync('**/*.svelte', { cwd: root })) {
      const source = readFileSync(`${root}${file}`, 'utf8');
      for (const match of source.matchAll(/\bt\(\s*'([a-z][A-Za-z0-9.]*)'/g)) used.add(match[1]!);
      for (const match of source.matchAll(/\bt\(\s*\n?\s*'([a-z][A-Za-z0-9.]*)'/g))
        used.add(match[1]!);
    }
    const known = new Set(
      Object.keys(messages.en!).map((key) => key.replace(/\.(one|other)$/, '')),
    );
    const own = [...used].filter((key) =>
      /^(login|pending|register|forgot|reset|verify|link|first|profile|nav|admin|dash)\./.test(key),
    );
    // `nav.section.admin` is the shell's text (it owns the sections of the navigation).
    expect(own.filter((key) => !known.has(key) && key !== 'nav.section.admin')).toEqual([]);
    expect(own.length).toBeGreaterThan(100);
  });

  it('load their data in `load`, which a page with data must have', () => {
    const withLoad = routes.filter((route) => route.load).map((route) => route.path);
    expect(withLoad.sort()).toEqual([
      '/admin/users',
      '/admin/users/:id',
      '/admin/users/pending',
      '/login',
      '/profile',
      '/setup',
    ]);
  });
});

describe('the constants the pages share with the server', () => {
  it('check an avatar against the upload ceiling of core.blob', () => {
    expect(MAX_AVATAR_BYTES).toBe(MAX_UPLOAD_BYTES);
  });
});

describe('the loaders', () => {
  const answer = (data: unknown, status = 200) =>
    Promise.resolve(
      status < 400
        ? { data, response: new Response(null, { status }) }
        : { error: { title: 'x', status }, response: new Response(null, { status }) },
    );
  const apiOf = (answers: Record<string, object | number>) =>
    ({
      GET: (path: string) => {
        const value = answers[path];
        return typeof value === 'number' ? answer(undefined, value) : answer(value);
      },
    }) as never;
  const context = (api: never, query = '') =>
    ({
      api,
      params: {},
      url: new URL(`http://localhost/login${query}`),
      publicApi: {},
    }) as never;
  const providers = { result: [{ id: 'idp', displayName: 'My IdP' }] };

  it('give the login page its providers, a bounded returnTo and a known notice only', async () => {
    const { loadLogin } = await import('./loaders.ts');
    const api = apiOf({ '/auth/oidc/providers': providers });
    expect(await loadLogin(context(api, '?returnTo=%2Fprofile&notice=check-mail'))).toEqual({
      providers: providers.result,
      returnTo: '/profile',
      notice: 'check-mail',
      error: null,
    });
    // The code of a failed provider sign-in: only a code of the fixed list is taken (ADR-0029).
    expect((await loadLogin(context(api, '?error=provider-denied'))).error).toBe('provider-denied');
    for (const bad of [
      '?error=<script>',
      '?error=Secret+reason',
      '?error=',
      '?error=constructor',
    ]) {
      expect((await loadLogin(context(api, bad))).error, bad).toBeNull();
    }
    expect(await loadLogin(context(api, '?notice=<script>'))).toMatchObject({
      returnTo: null,
      notice: null,
    });
    const long = `?returnTo=${'a'.repeat(2001)}`;
    expect((await loadLogin(context(api, long))).returnTo).toBeNull();
  });

  it('make the first-admin form a 404 once an administrator exists', async () => {
    const { loadFirstAdmin } = await import('./loaders.ts');
    expect(
      await loadFirstAdmin(context(apiOf({ '/bootstrap/status': { needsFirstAdmin: true } }))),
    ).toBeNull();
    const gone = await loadFirstAdmin(
      context(apiOf({ '/bootstrap/status': { needsFirstAdmin: false } })),
    ).catch((error: unknown) => error);
    expect(gone).toBeInstanceOf(ApiError);
    expect(gone).toMatchObject({ status: 404 });
  });

  it('leave out a part of the profile page that the role does not allow, and fail for any other error', async () => {
    const { loadProfile } = await import('./loaders.ts');
    const profile = {
      username: 'ada',
      displayName: null,
      email: null,
      emailVerified: false,
      pendingEmail: null,
      bio: null,
      avatarHash: null,
    };
    const base = {
      '/account/profile': profile,
      '/tokens': { result: [] },
      '/account/sessions': { result: [] },
      '/auth/oidc/providers': providers,
      '/preferences': { result: [{ key: 'notifications.locale', value: 'de' }] },
      '/account/permissions': {
        result: [
          { id: 'core.identity.me.read', module: 'core.identity', description: 'See who you are' },
        ],
      },
    };
    expect(await loadProfile(context(apiOf(base)))).toMatchObject({
      locale: 'de',
      tokens: [],
      sessions: [],
      // What the token form offers as scopes: the caller's own permissions, as the API lists them.
      permissions: [
        { id: 'core.identity.me.read', module: 'core.identity', description: 'See who you are' },
      ],
    });
    const limited = await loadProfile(
      context(apiOf({ ...base, '/tokens': 403, '/preferences': 403 })),
    );
    expect(limited).toMatchObject({ tokens: null, locale: null });
    const blind = await loadProfile(context(apiOf({ ...base, '/account/permissions': 403 })));
    expect(blind.permissions).toBeNull();
    await expect(
      loadProfile(context(apiOf({ ...base, '/account/sessions': 500 }))),
    ).rejects.toMatchObject({
      status: 500,
    });
    await expect(
      loadProfile(context(apiOf({ ...base, '/account/profile': 403 }))),
    ).rejects.toMatchObject({
      status: 403,
    });
  });
});
