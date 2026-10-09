import { describe, expect, it } from 'vitest';
import {
  catalogueProblems,
  createTranslator,
  interpolate,
  matchLocale,
  mergeBundles,
  negotiateLocale,
  parseAcceptLanguage,
} from './i18n.ts';

describe('interpolate', () => {
  it.each([
    ['Hello', undefined, 'Hello'],
    ['Hello {name}', { name: 'Ada' }, 'Hello Ada'],
    ['{a} and {b}', { a: 1, b: 'two' }, '1 and two'],
    ['Missing {nope}', { name: 'x' }, 'Missing {nope}'],
    ['Twice {n} {n}', { n: 3 }, 'Twice 3 3'],
    ['No braces { here', { here: 'x' }, 'No braces { here'],
  ])('%j with %j → %j', (text, params, expected) => {
    expect(interpolate(text, params)).toBe(expected);
  });
});

describe('createTranslator', () => {
  const bundles = {
    en: { 'nav.home': 'Home', 'only.en': 'English only', hi: 'Hi {name}' },
    de: { 'nav.home': 'Start' },
  };
  it('uses the locale, then English, then the key', () => {
    const de = createTranslator(bundles, 'de');
    expect(de('nav.home')).toBe('Start');
    expect(de('only.en')).toBe('English only');
    expect(de('unknown.key')).toBe('unknown.key');
    expect(createTranslator(bundles, 'fr')('nav.home')).toBe('Home');
    expect(createTranslator(bundles, 'en')('hi', { name: 'Ada' })).toBe('Hi Ada');
  });
});

describe('mergeBundles', () => {
  it('merges modules and refuses a key defined twice for one locale', () => {
    expect(mergeBundles([{ en: { a: '1' } }, { en: { b: '2' }, de: { a: 'eins' } }])).toEqual({
      en: { a: '1', b: '2' },
      de: { a: 'eins' },
    });
    expect(() => mergeBundles([{ en: { a: '1' } }, { en: { a: '2' } }])).toThrow(/twice/);
  });
});

describe('plural forms', () => {
  const bundles = {
    en: { 'n.one': '{count} session', 'n.other': '{count} sessions', plain: 'plain' },
    de: { 'n.one': '{count} Sitzung', 'n.other': '{count} Sitzungen' },
  };
  it.each([
    ['en', 0, '0 sessions'],
    ['en', 1, '1 session'],
    ['en', 2, '2 sessions'],
    ['de', 0, '0 Sitzungen'],
    ['de', 1, '1 Sitzung'],
    ['de', 5, '5 Sitzungen'],
  ])('%s with %i gives %j', (locale, count, expected) => {
    expect(createTranslator(bundles, locale)('n', { count })).toBe(expected);
  });
  it('uses the English form where the language lacks the key, and the plain key without a count', () => {
    expect(createTranslator({ ...bundles, de: {} }, 'de')('n', { count: 1 })).toBe('1 session');
    expect(createTranslator(bundles, 'en')('plain', { count: 3 })).toBe('plain');
  });
});

describe('matchLocale', () => {
  it.each([
    ['de', 'de'],
    ['de-AT', 'de'],
    ['DE-ch', 'de'],
    ['en-GB', 'en'],
    ['fr', undefined],
    ['', undefined],
    [undefined, undefined],
    ['deu', undefined],
  ])('%j → %j', (tag, expected) => {
    expect(matchLocale(tag)).toBe(expected);
  });
});

describe('parseAcceptLanguage', () => {
  it.each([
    ['de-DE,de;q=0.9,en;q=0.8', ['de-DE', 'de', 'en']],
    ['en;q=0.5, de;q=0.9', ['de', 'en']],
    ['fr;q=0, de', ['de']],
    ['*', []],
    ['', []],
    [undefined, []],
    ['de;q=abc, en', ['de', 'en']],
    ['ü, de', ['de']],
  ])('%j → %j', (header, expected) => {
    expect(parseAcceptLanguage(header)).toEqual(expected);
  });
  it('reads no more than the first 1000 characters', () => {
    expect(parseAcceptLanguage(`${'x'.repeat(2000)},de`)).toEqual([]);
  });
});

describe('negotiateLocale (ADR-0022: the person, the browser, the instance, English)', () => {
  it.each([
    [{ preferred: 'de', acceptLanguage: 'en' }, 'de'],
    [{ preferred: 'en', acceptLanguage: 'de' }, 'en'],
    [{ acceptLanguage: 'fr, de;q=0.8' }, 'de'],
    [{ acceptLanguage: 'fr', instanceDefault: 'de' }, 'de'],
    [{ preferred: 'xx', acceptLanguage: 'fr', instanceDefault: 'yy' }, 'en'],
    [{ preferred: 'de-AT' }, 'de'],
    [{}, 'en'],
  ])('%j → %s', (input, expected) => {
    expect(negotiateLocale(input)).toBe(expected);
  });
});

describe('catalogueProblems', () => {
  it('is empty for a complete catalogue', () => {
    expect(
      catalogueProblems({
        en: { a: 'A {x}', 'n.one': '{count} one', 'n.other': '{count} many' },
        de: { a: 'A {x}', 'n.one': '{count} eins', 'n.other': '{count} viele' },
      }),
    ).toEqual([]);
  });
  it('names a key German lacks, an extra one, a changed placeholder and a plural without other', () => {
    const problems = catalogueProblems({
      en: { a: 'A', b: 'B {x}', c: 'C' },
      de: { a: 'A', b: 'B {y}', extra: 'E', 'n.one': 'eins' },
    });
    expect(problems).toEqual(
      expect.arrayContaining([
        'de: missing "c"',
        'de: "b" has other placeholders than the English text',
        'de: "extra" has no English text',
        'de: "n.one" has no English text',
        'de: "n" has plural forms but no "other"',
      ]),
    );
  });
  it('refuses a language that is not shipped, and a plural form the language does not use', () => {
    expect(catalogueProblems({ en: { a: 'A' }, de: { a: 'A' }, fr: { a: 'A' } })).toEqual([
      '"fr" is not a shipped language',
    ]);
    expect(
      catalogueProblems({
        en: { 'n.one': '1', 'n.other': 'n' },
        de: { 'n.one': '1', 'n.other': 'n', 'n.few': 'f' },
      }),
    ).toContain('de: "n.few" has no English text');
  });
});
