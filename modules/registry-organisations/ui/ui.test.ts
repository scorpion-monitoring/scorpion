// The two halves of the pages of registry.organisations must agree: `routes.ts` says who may open a path (the
// server), `index.ts` says what is shown there (the web app). The pages need a permission the module
// declares, no page is public, and every text exists in every shipped language.
import { catalogueProblems } from '@scorpion/ui-kit/i18n';
import { describe, expect, it } from 'vitest';
import manifest from '../module.ts';
import routes, { messages, widgets } from './index.ts';
import { ORGANISATION_NAV, ORGANISATION_ROUTES, ORGANISATION_WIDGETS } from './routes.ts';
import { rowNote } from './membership-rows.ts';

describe('the pages of registry.organisations', () => {
  it('are the same paths in the server half and the browser half', () => {
    expect(routes.map((route) => route.path).sort()).toEqual(
      ORGANISATION_ROUTES.map((route) => route.path).sort(),
    );
  });

  it('are contributed to the registries of the shell, as the manifest says', () => {
    expect(manifest.contributes?.['ui.routes']).toEqual(ORGANISATION_ROUTES);
    expect(manifest.contributes?.['ui.nav']).toEqual(ORGANISATION_NAV);
    expect(manifest.contributes?.['ui.widget']).toEqual(ORGANISATION_WIDGETS);
    expect(typeof manifest.ui).toBe('function');
  });

  it('need a permission the module declares, and none is public', () => {
    const declared = new Set(Object.keys(manifest.permissions ?? {}));
    for (const route of ORGANISATION_ROUTES) {
      expect(route.public, route.path).toBeFalsy();
      expect(declared.has(route.permission!), route.path).toBe(true);
    }
  });

  it('give the administrator’s pages the permission of the routes they call, and the detail page the plain read', () => {
    const permissionOf = Object.fromEntries(
      ORGANISATION_ROUTES.map((route) => [route.path, route.permission]),
    );
    expect(permissionOf['/organisations/:id']).toBe('registry.organisations.organisation.read');
    for (const path of [
      '/admin/organisations',
      '/admin/organisations/new',
      '/admin/organisations/:id',
    ]) {
      expect(permissionOf[path], path).toBe('registry.organisations.organisation.manage');
    }
  });

  it('have a navigation entry only for a page of the module, with the permission of that page and a text', () => {
    const byPath = new Map(ORGANISATION_ROUTES.map((route) => [route.path, route.permission]));
    for (const entry of ORGANISATION_NAV) {
      expect(byPath.get(entry.path), entry.id).toBe(entry.permission);
      for (const locale of ['en', 'de']) {
        expect(messages[locale]?.[entry.label], `${locale} ${entry.label}`).toBeTruthy();
      }
    }
    // The administration lists what only an administrator may open; the profile section lists the member screen,
    // which every signed-in person may open (the manager part draws itself from the API, not from the menu).
    const sectionOf = Object.fromEntries(
      ORGANISATION_NAV.map((entry) => [entry.path, entry.section]),
    );
    expect(sectionOf).toEqual({
      '/account/organisations': 'account',
      '/admin/organisations': 'admin',
      '/admin/memberships': 'admin',
    });
    for (const entry of ORGANISATION_NAV.filter((entry) => entry.section === 'admin')) {
      expect(entry.permission, entry.id).toBe('registry.organisations.organisation.manage');
    }
  });

  it('have a widget in the browser half for every widget entry, in the dashboard, with a permission the module declares', () => {
    expect(Object.keys(widgets).sort()).toEqual(
      ORGANISATION_WIDGETS.map((widget) => widget.component).sort(),
    );
    const declared = new Set(Object.keys(manifest.permissions ?? {}));
    for (const widget of ORGANISATION_WIDGETS) {
      expect(widget.slot, widget.id).toBe('dashboard');
      expect(declared.has(widget.permission!), widget.id).toBe(true);
    }
  });

  it('give the member screen the plain read and the membership requests the permission of the administration', () => {
    const permissionOf = Object.fromEntries(
      ORGANISATION_ROUTES.map((route) => [route.path, route.permission]),
    );
    expect(permissionOf['/account/organisations']).toBe('registry.organisations.organisation.read');
    expect(permissionOf['/admin/memberships']).toBe('registry.organisations.organisation.manage');
  });

  it('have a text for every sentence that explains a missing button', () => {
    const keys = new Set<string>();
    for (const state of ['requested', 'approved', 'rejected', 'left'] as const) {
      for (const role of ['member', 'manager'] as const) {
        for (const own of [true, false]) {
          for (const allowedActions of [[], ['remove']] as const) {
            const key = rowNote(
              { userId: own ? 'me' : 'other', state, role, allowedActions: [...allowedActions] },
              'me',
            );
            if (key) keys.add(key);
          }
        }
      }
    }
    expect(keys.size).toBe(4);
    for (const key of keys) {
      for (const locale of ['en', 'de'])
        expect(messages[locale]?.[key], `${locale} ${key}`).toBeTruthy();
    }
  });

  it('have every text in English and German, with the same placeholders', () => {
    expect(catalogueProblems(messages)).toEqual([]);
  });

  it('have a text for every key the components use', async () => {
    const { globSync, readFileSync } = await import('node:fs');
    const root = new URL('.', import.meta.url).pathname;
    const used = new Set<string>();
    for (const file of [
      ...globSync('**/*.svelte', { cwd: root }),
      ...globSync('**/*.ts', { cwd: root }),
    ]) {
      if (file.endsWith('.test.ts')) continue;
      const source = readFileSync(`${root}${file}`, 'utf8');
      for (const match of source.matchAll(/\bt\(\s*'([a-z][A-Za-z0-9.]*)'/g)) used.add(match[1]!);
      // A key built from a template string: every value the page can put in it must have a text.
      for (const match of source.matchAll(/\bt\(\s*`([a-z][A-Za-z0-9.]*)\.\$\{/g)) {
        const prefix = match[1]!;
        expect(
          Object.keys(messages.en!).filter((key) => key.startsWith(`${prefix}.`)).length,
          prefix,
        ).toBeGreaterThan(0);
      }
    }
    expect(used.size).toBeGreaterThan(40);
    const plural = (key: string) => [`${key}.one`, `${key}.other`];
    for (const key of used) {
      for (const locale of ['en', 'de']) {
        const texts = messages[locale]!;
        const found = key in texts || plural(key).every((form) => form in texts);
        // `nav.section.admin` and the `kit.` texts are the shell's and ui-kit's.
        if (key.startsWith('nav.section.') || key.startsWith('kit.')) continue;
        expect(found, `${locale} ${key}`).toBe(true);
      }
    }
  });

  it('use no label of a type: the texts of the catalogue do not name "provider" or "consortium"', () => {
    for (const locale of ['en', 'de']) {
      for (const [key, text] of Object.entries(messages[locale]!)) {
        expect(text, `${locale} ${key}`).not.toMatch(
          /\b(provider|consortium|Provider|Konsortium)\b/,
        );
      }
    }
  });
});
