// The two halves of the shell's pages must agree: `routes.ts` says who may open a path (the server),
// `index.ts` says what is shown there (the web app). A module that adds pages gets the same test.
import { describe, expect, it } from 'vitest';
import { SHELL_NAV, SHELL_ROUTES } from './routes.ts';
import routes, { messages } from './index.ts';

describe('the pages of the shell', () => {
  it('are the same paths in the server half and the browser half', () => {
    expect(routes.map((route) => route.path).sort()).toEqual(
      SHELL_ROUTES.map((route) => route.path).sort(),
    );
  });

  it('are public with a reason, or need a permission (the administration pages)', () => {
    for (const route of SHELL_ROUTES) {
      if (route.public) {
        expect(route.publicReason?.length, route.path).toBeGreaterThan(10);
      } else {
        expect(route.permission, route.path).toMatch(/^core\.(authz|settings)\./);
        expect(route.path, route.path).toMatch(/^\/admin\//);
      }
    }
  });

  it('keep every administration page behind a permission, so a plain User gets none of them', () => {
    const admin = SHELL_ROUTES.filter((route) => route.path.startsWith('/admin'));
    expect(admin.length).toBeGreaterThan(4);
    expect(admin.every((route) => route.public !== true)).toBe(true);
    // Reading the terms of a vocabulary is self-service, so a page that needs only that would open to everyone.
    expect(admin.map((route) => route.permission)).not.toContain('core.settings.vocabulary.read');
  });

  it('have a link only to a page of the module, and a text for every label and section', () => {
    const paths = new Set(SHELL_ROUTES.map((route) => route.path));
    for (const entry of SHELL_NAV) {
      expect(paths.has(entry.path), entry.id).toBe(true);
      expect(messages.en?.[entry.label], entry.label).toBeTruthy();
      expect(messages.en?.[`nav.section.${entry.section}`], entry.section).toBeTruthy();
    }
  });

  it('load their data in `load`, which a page with data must have', () => {
    const withLoad = routes.filter((route) => route.load).map((route) => route.path);
    expect(withLoad.sort()).toEqual([
      '/admin/roles',
      '/admin/settings',
      '/admin/settings/:module',
      '/admin/settings/branding',
      '/admin/settings/secrets',
      '/admin/settings/vocabularies',
      '/docs',
      '/legal/:page',
    ]);
  });
});
