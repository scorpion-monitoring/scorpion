// The two halves of the pages of kpi.framework must agree: `routes.ts` says who may open a path (the server),
// `index.ts` says what is shown there (the web app). The pages need a permission the module declares, no page is
// public, and every text exists in every shipped language.
import { catalogueProblems } from '@scorpion/ui-kit/i18n';
import { describe, expect, it } from 'vitest';
import manifest from '../module.ts';
import routes, { messages } from './index.ts';
import { KPI_NAV, KPI_ROUTES } from './routes.ts';

describe('the pages of kpi.framework', () => {
  it('are the same paths in the server half and the browser half', () => {
    expect(routes.map((route) => route.path).sort()).toEqual(
      KPI_ROUTES.map((route) => route.path).sort(),
    );
  });

  it('are contributed to the registries of the shell, as the manifest says', () => {
    expect(manifest.contributes?.['ui.routes']).toEqual(KPI_ROUTES);
    expect(manifest.contributes?.['ui.nav']).toEqual(KPI_NAV);
    expect(typeof manifest.ui).toBe('function');
  });

  it('need a permission the module declares, and none is public', () => {
    const declared = new Set(Object.keys(manifest.permissions ?? {}));
    for (const route of KPI_ROUTES) {
      expect(route.public, route.path).not.toBe(true);
      expect(declared.has(route.permission!), route.path).toBe(true);
    }
  });

  it('give the indicator pages the indicator permission and the set pages the set permission', () => {
    for (const route of KPI_ROUTES) {
      const family = route.path.startsWith('/kpi/indicators') ? 'indicator' : 'set';
      expect(route.permission, route.path).toBe(`kpi.framework.${family}.manage`);
    }
  });

  it('have a navigation entry only for a page of the module, with the permission of that page and a text', () => {
    const byPath = new Map(KPI_ROUTES.map((route) => [route.path, route.permission]));
    for (const entry of KPI_NAV) {
      expect(byPath.get(entry.path), entry.id).toBe(entry.permission);
      for (const locale of ['en', 'de'])
        expect(messages[locale]?.[entry.label], `${locale} ${entry.label}`).toBeTruthy();
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
      if (key.startsWith('nav.section.') || key.startsWith('kit.')) continue;
      for (const locale of ['en', 'de']) {
        const texts = messages[locale]!;
        expect(key in texts || plural(key).every((form) => form in texts), `${locale} ${key}`).toBe(
          true,
        );
      }
    }
  });

  it('name no instance, product or role in any text', () => {
    for (const locale of ['en', 'de']) {
      for (const [key, text] of Object.entries(messages[locale]!)) {
        expect(text, `${locale} ${key}`).not.toMatch(
          /\b(Scorpion|de\.NBI|NFDI|Admin|Administrator)\b/i,
        );
      }
    }
  });
});
