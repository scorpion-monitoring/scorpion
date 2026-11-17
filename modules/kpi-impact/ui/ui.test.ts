// The two halves of the impact page must agree: `routes.ts` says who may open the path (the server), `pages.ts` says what is shown there (the web app).
// The page needs the permission the module declares, the navigation entry has the permission of the page, every text exists in every shipped language,
// every reason code the table route gives a row has a sentence in every language, and the page's source keeps the rules (no `{@html}`, no hand-written
// request, no motion, no stage literal).
import { globSync, readFileSync } from 'node:fs';
import { catalogueProblems } from '@scorpion/ui-kit/i18n';
import { describe, expect, it } from 'vitest';
import manifest from '../module.ts';
import { YEARS_OFFERED } from '../service/impact.ts';
import { ROW_REASONS } from '../service/rows.ts';
import { YEARS_SHOWN } from './loaders.ts';
import { messages } from './messages.ts';
import routes from './pages.ts';
import { evaluateQueryString, parseEvaluateQuery } from './query.ts';
import { EVALUATE_PATH, IMPACT_NAV, IMPACT_ROUTES } from './routes.ts';
import { labelOf } from './terms.ts';

const ID = '0198f9c0-1234-7abc-8def-0123456789ab';
const root = new URL('.', import.meta.url).pathname;
const sources = () =>
  globSync('**/*.{svelte,ts}', { cwd: root })
    .filter((file) => !file.endsWith('.test.ts'))
    .map((file) => ({ file, text: readFileSync(`${root}${file}`, 'utf8') }));

describe('the page of kpi.impact', () => {
  it('is the same path in the server half and the browser half, the path of the legacy page', () => {
    expect(routes.map((route) => route.path)).toEqual(IMPACT_ROUTES.map((route) => route.path));
    expect(routes.map((route) => route.path)).toEqual(['/services/evaluate']);
    expect(EVALUATE_PATH).toBe('/services/evaluate');
  });

  it('is contributed to the registries of the shell, as the manifest says', () => {
    expect(manifest.contributes?.['ui.routes']).toEqual(IMPACT_ROUTES);
    expect(manifest.contributes?.['ui.nav']).toEqual(IMPACT_NAV);
    expect(typeof manifest.ui).toBe('function');
  });

  it('needs the permission of the figures, which the module declares, and is not public [ASVS-8.2.1]', () => {
    const declared = new Set(Object.keys(manifest.permissions ?? {}));
    expect(declared.has('kpi.impact.read')).toBe(true);
    for (const route of IMPACT_ROUTES) {
      expect(route.public, route.path).not.toBe(true);
      expect(route.permission, route.path).toBe('kpi.impact.read');
    }
  });

  it('has a navigation entry with the permission of the page and a text in every language, so nobody sees a dead link [ASVS-8.2.1]', () => {
    expect(IMPACT_NAV).toHaveLength(1);
    for (const entry of IMPACT_NAV) {
      expect(entry.path).toBe(EVALUATE_PATH);
      expect(entry.permission).toBe(IMPACT_ROUTES[0]!.permission);
      for (const locale of ['en', 'de'])
        expect(messages[locale]?.[entry.label], `${locale} ${entry.label}`).toBeTruthy();
    }
    expect(messages.en!['nav.impact']).toBe('Impact');
  });

  it('shares the number of years with the table route', () => {
    expect(YEARS_SHOWN).toBe(YEARS_OFFERED);
  });
});

describe('the words of the page', () => {
  it('have every text in English and German, with the same placeholders and plural forms', () => {
    expect(catalogueProblems(messages)).toEqual([]);
  });

  it.each(['en', 'de'])('has a sentence in %s for every reason a row can have but ok', (locale) => {
    const texts = messages[locale]!;
    const wanted = ROW_REASONS.filter((code) => code !== 'ok');
    expect(wanted.filter((code) => !texts[`impact.reason.${code}`])).toEqual([]);
    const have = Object.keys(texts)
      .filter((key) => key.startsWith('impact.reason.'))
      .map((key) => key.slice('impact.reason.'.length));
    expect(have.filter((code) => !(wanted as readonly string[]).includes(code))).toEqual([]);
  });

  it('has a state word in both languages for each of the four states', () => {
    for (const locale of ['en', 'de'])
      for (const state of ['ok', 'no-data', 'no-evaluation', 'error'])
        expect(messages[locale]![`impact.state.${state}`], `${locale} ${state}`).toBeTruthy();
  });

  it('say the German sentences in German: none is the English text of its key', () => {
    for (const [key, text] of Object.entries(messages.de!))
      if (text.replace(/\{\w+\}/g, '').trim().length > 12)
        expect(text, key).not.toBe(messages.en![key]);
  });

  it('name no instance, product or sender, and no hard-coded vocabulary term', () => {
    const forbidden = /scorpion|de\.nbi|nfdi|\b(DEV|DEMO|PROD|TERM)\b/i;
    for (const [locale, texts] of Object.entries(messages))
      for (const [key, text] of Object.entries(texts))
        expect(forbidden.test(text), `${locale} ${key}: ${text}`).toBe(false);
  });

  it('have a text for every key the components use, in both languages', () => {
    const used = new Set<string>();
    for (const { text } of sources()) {
      for (const match of text.matchAll(/\bt\(\s*'([a-z][A-Za-z0-9.-]*)'/g)) used.add(match[1]!);
      for (const match of text.matchAll(/\bt\(\s*`([a-z][A-Za-z0-9.-]*)\.\$\{/g)) {
        const prefix = match[1]!;
        expect(
          Object.keys(messages.en!).filter((key) => key.startsWith(`${prefix}.`)).length,
          prefix,
        ).toBeGreaterThan(0);
      }
    }
    expect(used.size).toBeGreaterThan(25);
    for (const key of used) {
      for (const locale of ['en', 'de'])
        expect(
          messages[locale]![key] ?? messages[locale]![`${key}.other`],
          `${locale} ${key}`,
        ).toBeTruthy();
    }
  });
});

describe('the source of the page', () => {
  it('uses no {@html}, no hand-written request and no motion, and names no stage', () => {
    for (const { file, text } of sources()) {
      expect(text, `${file} {@html}`).not.toContain('{@html');
      expect(/\bfetch\(/.test(text), `${file} fetch(`).toBe(false);
      expect(/\b(transition|animate|animation|transform):?/.test(text), `${file} motion`).toBe(
        false,
      );
      expect(/['"`](DEV|DEMO|PROD|TERM)['"`]/.test(text), `${file} a stage key`).toBe(false);
    }
  });

  it('builds every link with href() and keeps the state in words and an icon', () => {
    const page = readFileSync(`${root}Evaluate.svelte`, 'utf8');
    expect(page).toContain('href(`/services/${row.slug}`)');
    expect(page).toContain('<caption');
    expect(page).toContain('scope="col"');
    expect(page).toContain('scope="row"');
    expect(page).toContain('role="status"');
    expect(page).toContain('<Icon');
  });
});

describe('the address of the page', () => {
  it.each<[string, string, Partial<ReturnType<typeof parseEvaluateQuery>>]>([
    ['nothing', '', { consortium: undefined, year: undefined, includeUnpublished: false, page: 0 }],
    [
      'everything',
      `consortium=${ID.toUpperCase()}&year=2024&unpublished=1&page=3`,
      { consortium: ID, year: 2024, includeUnpublished: true, page: 3 },
    ],
    [
      'what is not understood is dropped',
      'consortium=nope&year=24&unpublished=yes&page=-1',
      { consortium: undefined, year: undefined, includeUnpublished: false, page: 0 },
    ],
  ])('reads %s', (_name, search, expected) => {
    expect(parseEvaluateQuery(new URLSearchParams(search))).toMatchObject(expected);
  });

  it('writes equal views as equal addresses, in a fixed order, and nothing for the defaults', () => {
    expect(evaluateQueryString({})).toBe('');
    expect(
      evaluateQueryString({ page: 2, includeUnpublished: true, year: 2025, consortium: ID }),
    ).toBe(`?consortium=${ID}&year=2025&unpublished=1&page=2`);
    const query = { consortium: ID, year: 2023, includeUnpublished: true, page: 4 };
    expect(parseEvaluateQuery(new URLSearchParams(evaluateQueryString(query)))).toEqual(query);
  });
});

describe('the label of a unit', () => {
  const terms = [{ key: 'count', labels: { en: 'Count', de: 'Anzahl' }, active: true }];
  it('is the vocabulary’s in the language, its English one, or the key', () => {
    expect(labelOf(terms, 'count', 'de')).toBe('Anzahl');
    expect(labelOf(terms, 'count', 'fr')).toBe('Count');
    expect(labelOf(terms, 'gone', 'de')).toBe('gone');
  });
});
