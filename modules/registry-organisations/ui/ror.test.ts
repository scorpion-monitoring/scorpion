import { describe, expect, it } from 'vitest';
import { parseRorId } from '../service/fields.ts';
import { previewRor, rorLink } from './ror.ts';

describe('previewRor', () => {
  it.each([
    ['02skbsp27', '02skbsp27'],
    ['  02SKBSP27 ', '02skbsp27'],
    ['ror.org/02skbsp27', '02skbsp27'],
    ['https://ror.org/02skbsp27', '02skbsp27'],
    ['HTTP://ROR.ORG/02SKBSP27', '02skbsp27'],
    ['03yrm5c26', '03yrm5c26'],
  ])('%j previews as %j', (input, expected) => {
    expect(previewRor(input)).toBe(expected);
  });

  it.each([
    '',
    'abc',
    '12skbsp27',
    '02skbspi7',
    '02skbsp2',
    '02skbsp277',
    'https://example.org/02skbsp27',
    '02skbsp27/x',
  ])('shows no preview for %j', (input) => {
    expect(previewRor(input)).toBeUndefined();
  });

  it('previews what the server stores: for every value the preview names, the server stores the same id', () => {
    for (const input of [
      '02skbsp27',
      'ror.org/02SKBSP27',
      'https://ror.org/03yrm5c26',
      ' 02skbsp27 ',
    ]) {
      const parsed = parseRorId(input);
      expect(parsed.ok, input).toBe(true);
      expect(previewRor(input)).toBe(parsed.ok ? parsed.value : undefined);
    }
  });

  it('links to ror.org', () => {
    expect(rorLink('02skbsp27')).toBe('https://ror.org/02skbsp27');
  });
});
