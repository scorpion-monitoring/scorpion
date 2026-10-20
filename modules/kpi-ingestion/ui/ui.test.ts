// The two halves of the Data Submission page must agree: `routes.ts` says who may open a path (the server), `pages.ts` says what is shown there (the
// web app). The page needs a permission the module declares, the navigation entry has the permission of the page, every text exists in every shipped
// language, and **every code of the server's closed list of problems has a sentence in every language**.
import { globSync, readFileSync } from 'node:fs';
import { catalogueProblems } from '@scorpion/ui-kit/i18n';
import { describe, expect, it } from 'vitest';
import manifest from '../module.ts';
import { PICKER_LIMIT } from '../service/ingestion.ts';
import { PROBLEM_MESSAGES } from '../service/table.ts';
import { messages } from './messages.ts';
import routes from './pages.ts';
import { PICKER_PAGE_SIZE } from './limits.ts';
import { INGESTION_NAV, INGESTION_ROUTES, SUBMIT_PATH } from './routes.ts';

describe('the page of kpi.ingestion', () => {
  it('is the same path in the server half and the browser half', () => {
    expect(routes.map((route) => route.path)).toEqual(INGESTION_ROUTES.map((route) => route.path));
    expect(routes.map((route) => route.path)).toEqual([SUBMIT_PATH]);
  });

  it('is contributed to the registries of the shell, as the manifest says', () => {
    expect(manifest.contributes?.['ui.routes']).toEqual(INGESTION_ROUTES);
    expect(manifest.contributes?.['ui.nav']).toEqual(INGESTION_NAV);
    expect(typeof manifest.ui).toBe('function');
  });

  it('needs a permission the module declares, and is not public', () => {
    const declared = new Set(Object.keys(manifest.permissions ?? {}));
    for (const route of INGESTION_ROUTES) {
      expect(route.public, route.path).not.toBe(true);
      expect(declared.has(route.permission!), route.path).toBe(true);
    }
  });

  it('has a navigation entry with the permission of the page and a text in every language, so nobody sees a dead link', () => {
    const byPath = new Map(INGESTION_ROUTES.map((route) => [route.path, route.permission]));
    expect(INGESTION_NAV).toHaveLength(1);
    for (const entry of INGESTION_NAV) {
      expect(byPath.get(entry.path), entry.id).toBe(entry.permission);
      for (const locale of ['en', 'de'])
        expect(messages[locale]?.[entry.label], `${locale} ${entry.label}`).toBeTruthy();
    }
  });

  it('has every text in English and German, with the same placeholders', () => {
    expect(catalogueProblems(messages)).toEqual([]);
  });

  it('shares the picker size with the server', () => {
    expect(PICKER_PAGE_SIZE).toBe(PICKER_LIMIT);
  });
});

describe('the sentences for the problems of a file', () => {
  const codes = Object.keys(PROBLEM_MESSAGES);

  it.each(['en', 'de'])(
    'has one in %s for every code of the closed list, and for no code that is not on it',
    (locale) => {
      const texts = messages[locale]!;
      const missing = codes.filter((code) => !texts[`submit.problem.${code}`]);
      expect(missing, `codes with no sentence in ${locale}`).toEqual([]);
      const have = Object.keys(texts)
        .filter((key) => key.startsWith('submit.problem.') && key !== 'submit.problem.unknown')
        .map((key) => key.slice('submit.problem.'.length));
      expect(
        have.filter((code) => !codes.includes(code)),
        `sentences of ${locale} for a code the server does not have`,
      ).toEqual([]);
      expect(texts['submit.problem.unknown']).toBeTruthy();
    },
  );

  it('are not the server’s English text word for word in German', () => {
    for (const code of codes)
      expect(messages.de![`submit.problem.${code}`], code).not.toBe(
        PROBLEM_MESSAGES[code as keyof typeof PROBLEM_MESSAGES],
      );
  });
});

describe('the words of the page', () => {
  it('name no role and no instance, and no hard-coded vocabulary term', () => {
    const forbidden =
      /\b(admin|administrator|reviewer|manager|user|moderator)\b|scorpion|de\.nbi|nfdi/i;
    for (const [locale, texts] of Object.entries(messages))
      for (const [key, text] of Object.entries(texts))
        expect(forbidden.test(text), `${locale} ${key}: ${text}`).toBe(false);
  });

  it('have a text for every key the components use, in both languages', () => {
    const root = new URL('.', import.meta.url).pathname;
    const used = new Set<string>();
    for (const file of [
      ...globSync('**/*.svelte', { cwd: root }),
      ...globSync('**/*.ts', { cwd: root }),
    ]) {
      if (file.endsWith('.test.ts')) continue;
      const source = readFileSync(`${root}${file}`, 'utf8');
      for (const match of source.matchAll(/\bt\(\s*'([a-z][A-Za-z0-9.-]*)'/g)) used.add(match[1]!);
      for (const match of source.matchAll(/\bt\(\s*`([a-z][A-Za-z0-9.-]*)\.\$\{/g)) {
        const prefix = match[1]!;
        expect(
          Object.keys(messages.en!).filter((key) => key.startsWith(`${prefix}.`)).length,
          prefix,
        ).toBeGreaterThan(0);
      }
    }
    expect(used.size).toBeGreaterThan(40);
    for (const key of used) {
      if (key.startsWith('kit.')) continue;
      for (const locale of ['en', 'de'])
        expect(messages[locale]![key], `${locale} ${key}`).toBeTruthy();
    }
  });
});
