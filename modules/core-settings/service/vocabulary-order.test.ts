import { describe, expect, it } from 'vitest';
import { labelFor, orderTerms } from './vocabulary-order.ts';

const term = (key: string, sortOrder: number) => ({ key, sortOrder });

describe('orderTerms', () => {
  it.each([
    ['by sort order', [term('b', 2), term('a', 3), term('c', 1)], ['c', 'b', 'a']],
    [
      'by key when the sort order is equal',
      [term('b', 1), term('a', 1), term('c', 1)],
      ['a', 'b', 'c'],
    ],
    ['with a negative sort order first', [term('a', 0), term('z', -5)], ['z', 'a']],
    [
      'upper case before lower case (binary)',
      [term('b', 1), term('B', 1), term('a', 1)],
      ['B', 'a', 'b'],
    ],
    [
      'digits before letters, "10" before "9"',
      [term('9', 1), term('10', 1), term('a', 1)],
      ['10', '9', 'a'],
    ],
    ['nothing', [], []],
  ])('orders %s', (_name, input, expected) => {
    expect(orderTerms(input).map((t) => t.key)).toEqual(expected);
  });

  it('does not change its input', () => {
    const input = [term('b', 2), term('a', 1)];
    orderTerms(input);
    expect(input.map((t) => t.key)).toEqual(['b', 'a']);
  });
});

describe('labelFor', () => {
  const labels = { en: 'Production', de: 'Betrieb', 'de-AT': 'Betrieb (AT)' };
  it.each([
    ['the exact locale', 'de-AT', 'Betrieb (AT)'],
    ['the language of an unknown region', 'de-CH', 'Betrieb'],
    ['English for an unknown language', 'fr', 'Production'],
    ['the language of the exact locale', 'en-GB', 'Production'],
  ])('uses %s', (_name, locale, expected) => {
    expect(labelFor(labels, locale, 'PROD')).toBe(expected);
  });

  it('falls back to the first label by locale, then to the key', () => {
    expect(labelFor({ nl: 'b', de: 'a' }, 'fr', 'K')).toBe('a');
    expect(labelFor({}, 'en', 'K')).toBe('K');
  });
});
