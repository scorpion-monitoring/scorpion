import { describe, expect, it } from 'vitest';
import { createTranslator, interpolate, mergeBundles } from './i18n.ts';

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
