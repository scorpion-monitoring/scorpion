import { describe, expect, it } from 'vitest';
import { matchLocale, resolveLocale } from './locale.ts';

describe('matchLocale', () => {
  it.each([
    ['en', 'en'],
    ['de', 'de'],
    ['DE', 'de'],
    ['de-AT', 'de'],
    ['de_CH', 'de'],
    ['en-GB', 'en'],
    [' de ', 'de'],
    ['fr', undefined],
    ['pt-BR', undefined],
    ['', undefined],
    ['x'.repeat(100), undefined],
    [undefined, undefined],
    [42, undefined],
    [{ toString: () => 'de' }, undefined],
  ])('%j is %j', (input, expected) => {
    expect(matchLocale(input)).toBe(expected);
  });
});

describe('resolveLocale', () => {
  it.each([
    ['the first shipped candidate wins', ['de', 'en'], 'de'],
    ['an unsupported candidate falls through', ['fr', 'de'], 'de'],
    ['undefined candidates are skipped', [undefined, undefined, 'de'], 'de'],
    ['nothing shipped gives English', ['fr', 'pt'], 'en'],
    ['no candidates give English', [], 'en'],
  ])('%s', (_name, candidates, expected) => {
    expect(resolveLocale(...candidates)).toBe(expected);
  });
});
