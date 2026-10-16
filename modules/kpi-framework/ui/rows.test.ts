import { describe, expect, it } from 'vitest';
import {
  addRow,
  aggregateChoices,
  badgeCounts,
  removeRow,
  rowsBody,
  rowsChanged,
  setNecessity,
  type Row,
} from './rows.ts';

const a: Row = { indicatorId: 'a', name: 'A', necessity: 'mandatory' };
const b: Row = { indicatorId: 'b', name: 'B', necessity: 'optional' };

describe('the rows of a set', () => {
  it('add with the default necessity once, remove by id and change a necessity', () => {
    expect(addRow([a], { id: 'b', name: 'B' }, 'optional')).toEqual([a, b]);
    expect(addRow([a, b], { id: 'b', name: 'B' }, 'mandatory')).toEqual([a, b]);
    expect(removeRow([a, b], 'a')).toEqual([b]);
    expect(removeRow([a], 'zzz')).toEqual([a]);
    expect(setNecessity([a, b], 'b', 'recommended')).toEqual([
      a,
      { ...b, necessity: 'recommended' },
    ]);
  });

  it('are sent as ids and necessities only', () => {
    expect(rowsBody([a, b])).toEqual({
      indicators: [
        { indicatorId: 'a', necessity: 'mandatory' },
        { indicatorId: 'b', necessity: 'optional' },
      ],
    });
  });

  it.each([
    [[a, b], [a, b], false],
    [[b, a], [a, b], false],
    [[a], [a, b], true],
    [[a, { ...b, necessity: 'mandatory' }], [a, b], true],
    [[], [], false],
  ] as [Row[], Row[], boolean][])('rowsChanged %#', (draft, stored, expected) => {
    expect(rowsChanged(draft, stored)).toBe(expected);
  });
});

describe('aggregateChoices', () => {
  const terms = [
    { key: 'sum', active: true },
    { key: 'avg', active: true },
    { key: 'min', active: false },
    { key: 'max', active: true },
  ];
  it.each([
    [['sum', 'avg', 'min', 'max'], undefined, ['sum', 'avg', 'max']],
    [['avg', 'min', 'max'], undefined, ['avg', 'max']],
    [['avg', 'min', 'max'], 'min', ['avg', 'min', 'max']],
    [[], undefined, []],
    [['median'], undefined, []],
  ] as [string[], string | undefined, string[]][])(
    '%j keeping %j → %j',
    (allowed, current, expected) => {
      expect(aggregateChoices(allowed, terms, current)).toEqual(expected);
    },
  );
});

describe('badgeCounts', () => {
  it('orders by the vocabulary, leaves zero out and puts unknown terms last', () => {
    expect(
      badgeCounts({ optional: 1, mandatory: 3, odd: 2, none: 0 }, [
        'mandatory',
        'recommended',
        'optional',
      ]),
    ).toEqual([
      { key: 'mandatory', count: 3 },
      { key: 'optional', count: 1 },
      { key: 'odd', count: 2 },
    ]);
    expect(badgeCounts({}, ['mandatory'])).toEqual([]);
  });
});
