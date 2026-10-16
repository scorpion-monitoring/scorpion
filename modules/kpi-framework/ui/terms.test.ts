import { describe, expect, it } from 'vitest';
import { errorsFor, leftover } from './failure.ts';
import { labelOf, offered, type Term } from './terms.ts';

const terms: Term[] = [
  { key: 'count', labels: { en: 'Count', de: 'Anzahl' }, active: true },
  { key: 'byte', labels: { en: 'Byte' }, active: false },
];

describe('labelOf', () => {
  it('takes the language of the person, then English, then the key', () => {
    expect(labelOf(terms, 'count', 'de')).toBe('Anzahl');
    expect(labelOf(terms, 'byte', 'de')).toBe('Byte');
    expect(labelOf(terms, 'gone', 'de')).toBe('gone');
  });
});

describe('offered', () => {
  it('lists the active terms and the one a row keeps even when it is deactivated', () => {
    expect(offered(terms).map((t) => t.key)).toEqual(['count']);
    expect(offered(terms, ['byte']).map((t) => t.key)).toEqual(['count', 'byte']);
  });
});

describe('the failure of a form', () => {
  const failure = {
    status: 422,
    type: undefined,
    retryAfterSeconds: undefined,
    general: ['General.'],
    fields: {
      name: ['Bad name.'],
      'measuredBy[1]': ['Unknown.'],
      'indicators[0].necessity': ['No.'],
      other: ['Odd.'],
    },
  };
  it('puts the messages of a drawn field, and of the items of a list, on that field', () => {
    expect(errorsFor(failure, 'name')).toEqual(['Bad name.']);
    expect(errorsFor(failure, 'measuredBy')).toEqual(['Unknown.']);
    expect(errorsFor(failure, 'indicators')).toEqual(['No.']);
    expect(errorsFor(undefined, 'name')).toEqual([]);
  });
  it('keeps everything else for the alert', () => {
    expect(leftover(failure, ['name', 'measuredBy'])).toEqual([
      'General.',
      'indicators[0].necessity: No.',
      'other: Odd.',
    ]);
    expect(leftover(undefined, [])).toEqual([]);
  });
});
