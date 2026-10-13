// The two halves of the pages of registry.services must agree: `routes.ts` says who may open a path (the
// server), `index.ts` says what is shown there (the web app). The pages that are registered but not offered yet
// (`offered.ts`) are the only difference, and the catalogue links to them only when they are offered. The pages
// need a permission the module declares, no page is public, and every text exists in every shipped language.
import { catalogueProblems } from '@scorpion/ui-kit/i18n';
import { describe, expect, it } from 'vitest';
import { FIELDS } from '../config/fields.ts';
import { STEPS } from '../config/steps.ts';
import manifest from '../module.ts';
import routes, { messages, notOffered } from './index.ts';
import { isOffered, NOT_OFFERED } from './offered.ts';
import { SERVICE_NAV, SERVICE_ROUTES } from './routes.ts';

describe('the pages of registry.services', () => {
  it('are the same paths in the server half and the browser half, except the pages not offered yet', () => {
    const server = SERVICE_ROUTES.map((route) => route.path);
    expect(routes.map((route) => route.path).sort()).toEqual(
      server.filter((path) => !NOT_OFFERED.includes(path)).sort(),
    );
    // Every page not offered is registered on the server, and nothing offered is on the list.
    for (const path of NOT_OFFERED) expect(server, path).toContain(path);
    for (const route of routes) expect(isOffered(route.path), route.path).toBe(true);
    expect(notOffered).toEqual(NOT_OFFERED);
  });

  it('offer every page since sprint 6: the catalogue, the wizard, the service page and the public page', () => {
    expect(NOT_OFFERED).toEqual([]);
    expect(routes.map((route) => route.path).sort()).toEqual([
      '/public/services/:slug',
      '/services',
      '/services/:slug',
      '/services/new',
    ]);
    expect(isOffered('/services/new')).toBe(true);
    expect(isOffered('/services/:slug')).toBe(true);
    // The wizard needs the permission of the create route, which the API checks again.
    expect(SERVICE_ROUTES.find((route) => route.path === '/services/new')?.permission).toBe(
      'registry.services.service.create',
    );
  });

  it('are contributed to the registries of the shell, as the manifest says', () => {
    expect(manifest.contributes?.['ui.routes']).toEqual(SERVICE_ROUTES);
    expect(manifest.contributes?.['ui.nav']).toEqual(SERVICE_NAV);
    expect(typeof manifest.ui).toBe('function');
  });

  it('need a permission the module declares, except the one public page, which says why it is public', () => {
    const declared = new Set(Object.keys(manifest.permissions ?? {}));
    const open = SERVICE_ROUTES.filter((route) => route.public === true);
    expect(open.map((route) => route.path)).toEqual(['/public/services/:slug']);
    expect(open[0]!.publicReason).toMatch(/draws nothing from a session or a role/);
    for (const route of SERVICE_ROUTES.filter((entry) => entry.public !== true)) {
      expect(declared.has(route.permission!), route.path).toBe(true);
    }
  });

  it('give the catalogue and the service page the plain read, and the wizard the permission of the create route', () => {
    const permissionOf = Object.fromEntries(
      SERVICE_ROUTES.map((route) => [route.path, route.permission]),
    );
    expect(permissionOf).toEqual({
      '/services': 'registry.services.service.read',
      '/services/new': 'registry.services.service.create',
      '/services/:slug': 'registry.services.service.read',
      '/public/services/:slug': undefined,
    });
  });

  it('offer the catalogue in the main section of the navigation, with the permission of its page and a text', () => {
    const byPath = new Map(SERVICE_ROUTES.map((route) => [route.path, route.permission]));
    expect(SERVICE_NAV.map((entry) => [entry.path, entry.section])).toEqual([
      ['/services', 'main'],
    ]);
    for (const entry of SERVICE_NAV) {
      expect(byPath.get(entry.path), entry.id).toBe(entry.permission);
      // Only a page that is offered has a link.
      expect(isOffered(entry.path), entry.id).toBe(true);
      for (const locale of ['en', 'de']) {
        expect(messages[locale]?.[entry.label], `${locale} ${entry.label}`).toBeTruthy();
      }
    }
  });

  it('have every text in English and German, with the same placeholders', () => {
    expect(catalogueProblems(messages)).toEqual([]);
  });

  it('have a real text, in English and German, for every message key the configuration names', () => {
    const keys = [
      ...STEPS.flatMap((step) => [step.title, ...(step.intro ?? [])]),
      ...FIELDS.flatMap((field) => [field.label, ...(field.help ? [field.help] : [])]),
    ];
    expect(keys.length).toBeGreaterThan(20);
    for (const key of keys) {
      for (const locale of ['en', 'de']) {
        const text = messages[locale]?.[key];
        expect(text, `${locale} ${key}`).toBeTruthy();
        // A real sentence, not the key or a placeholder.
        expect(text, `${locale} ${key}`).not.toBe(key);
        expect(text!.length, `${locale} ${key}`).toBeGreaterThan(3);
      }
    }
  });

  it('have a text for every message key the check of a rule can ask for', () => {
    for (const locale of ['en', 'de']) {
      for (const key of [
        'required',
        'maxLength',
        'maxItems',
        'pattern',
        'pattern.slug',
        'pattern.url',
        'pattern.email',
        'uniqueItems',
        'dependentRequired',
        'unknown',
        'enum',
        'unsupported',
        'invalid',
      ]) {
        expect(messages[locale]?.[`services.check.${key}`], `${locale} ${key}`).toBeTruthy();
      }
    }
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
      // A key chosen at run time from a fixed list: `t(`services.check.pattern.${format}`)`.
      for (const match of source.matchAll(/\bt\(\s*`([a-z][A-Za-z0-9.]*)\.\$\{/g)) {
        for (const key of Object.keys(messages.en!)) {
          if (key.startsWith(`${match[1]}.`)) used.add(key);
        }
      }
    }
    expect(used.size).toBeGreaterThan(8);
    for (const key of used) {
      for (const locale of ['en', 'de']) {
        if (key.startsWith('kit.')) continue;
        expect(key in messages[locale]!, `${locale} ${key}`).toBe(true);
      }
    }
  });

  it('use no label of a role: the texts do not name "provider" or "consortium"', () => {
    for (const locale of ['en', 'de']) {
      for (const [key, text] of Object.entries(messages[locale]!)) {
        expect(text, `${locale} ${key}`).not.toMatch(
          /\b(provider|consortium|consortia|Provider|Anbieter|Konsortium|Konsortien)\b/,
        );
      }
    }
  });

  it('name no stage term and no facet in a page (the sort key of a column is an API name, not a label)', async () => {
    const { globSync, readFileSync } = await import('node:fs');
    const root = new URL('.', import.meta.url).pathname;
    for (const file of globSync('**/*.svelte', { cwd: root })) {
      const source = readFileSync(`${root}${file}`, 'utf8');
      expect(source, file).not.toMatch(/['"`](PROD|DEV|BETA|TERM|consortium)['"`]/);
      // No raw HTML anywhere.
      expect(source, file).not.toContain('{@html');
    }
  });
});
