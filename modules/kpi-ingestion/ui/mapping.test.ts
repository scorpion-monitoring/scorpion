import { describe, expect, it } from 'vitest';
import {
  columnOf,
  mappedColumns,
  mappingBody,
  missingNames,
  optionsFor,
  sameMapping,
  targetOf,
  withTarget,
  type Mapping,
  type Target,
} from './mapping.ts';

const targets: Target[] = [
  { id: 'i1', name: 'Downloads' },
  { id: 'i2', name: 'Citations' },
  { id: 'i3', name: 'Users' },
];

describe('the target of a column', () => {
  it.each<[Mapping, number, string]>([
    [{ '0': 'period', '2': 'i1' }, 0, 'period'],
    [{ '0': 'period', '2': 'i1' }, 1, ''],
    [{ '0': 'period', '2': 'i1' }, 2, 'i1'],
    [{}, 0, ''],
  ])('%j column %i holds %j', (mapping, column, expected) => {
    expect(targetOf(mapping, column)).toBe(expected);
  });

  it('finds the column that has a target, 0-based', () => {
    expect(columnOf({ '0': 'period', '3': 'i2' }, 'i2')).toBe(3);
    expect(columnOf({ '0': 'period' }, 'i2')).toBeUndefined();
  });
});

describe('optionsFor', () => {
  const mapping: Mapping = { '0': 'period', '2': 'i1' };

  it('offers not mapped, the period and every indicator, in that order', () => {
    expect(optionsFor(1, {}, targets).map((option) => option.value)).toEqual([
      '',
      'period',
      'i1',
      'i2',
      'i3',
    ]);
  });

  it('says which column has a target another column would take (1-based), and not for the column itself', () => {
    const taken = (column: number) =>
      Object.fromEntries(
        optionsFor(column, mapping, targets)
          .filter((option) => option.takenBy !== undefined)
          .map((option) => [option.value, option.takenBy]),
      );
    expect(taken(1)).toEqual({ period: 1, i1: 3 });
    expect(taken(0)).toEqual({ i1: 3 });
    expect(taken(2)).toEqual({ period: 1 });
  });

  it('carries the name of an indicator and none for the two fixed options', () => {
    const options = optionsFor(0, {}, targets);
    expect(options[0]).toEqual({ value: '' });
    expect(options[2]).toMatchObject({ value: 'i1', name: 'Downloads' });
  });
});

describe('withTarget', () => {
  it.each<[string, Mapping, number, string, Mapping]>([
    ['maps a free column', { '0': 'period' }, 1, 'i1', { '0': 'period', '1': 'i1' }],
    [
      'changes the target of a column',
      { '0': 'period', '1': 'i1' },
      1,
      'i2',
      { '0': 'period', '1': 'i2' },
    ],
    [
      'moves a target another column had, so none is twice',
      { '0': 'period', '1': 'i1' },
      2,
      'i1',
      { '0': 'period', '2': 'i1' },
    ],
    ['clears a column', { '0': 'period', '1': 'i1' }, 1, '', { '0': 'period' }],
    ['clears nothing in an empty mapping', {}, 3, '', {}],
    ['keeps the same target on the same column', { '1': 'i1' }, 1, 'i1', { '1': 'i1' }],
  ])('%s', (_, mapping, column, target, expected) => {
    const copy = structuredClone(mapping);
    expect(withTarget(mapping, column, target)).toEqual(expected);
    expect(mapping).toEqual(copy);
  });

  it('never leaves a target twice, whatever the sequence of changes', () => {
    let mapping: Mapping = {};
    const steps: [number, string][] = [
      [0, 'period'],
      [1, 'i1'],
      [2, 'i1'],
      [3, 'period'],
      [1, 'i2'],
      [2, ''],
      [4, 'i2'],
    ];
    for (const [column, target] of steps) {
      mapping = withTarget(mapping, column, target);
      const values = Object.values(mapping);
      expect(new Set(values).size).toBe(values.length);
    }
    expect(mapping).toEqual({ '3': 'period', '4': 'i2' });
  });
});

describe('comparing and sending a mapping', () => {
  it.each<[Mapping, Mapping, boolean]>([
    [{ '0': 'period' }, { '0': 'period' }, true],
    [{ '0': 'period', '1': '' }, { '0': 'period' }, true],
    [{ '0': 'period' }, { '0': 'i1' }, false],
    [{ '0': 'period' }, { '0': 'period', '1': 'i1' }, false],
    [{}, {}, true],
  ])('%j and %j are the same: %s', (a, b, same) => {
    expect(sameMapping(a, b)).toBe(same);
    expect(sameMapping(b, a)).toBe(same);
  });

  it('sends only the columns that have a target, keyed by the 0-based index', () => {
    expect(JSON.parse(mappingBody({ '0': 'period', '1': '', '2': 'i1' }))).toEqual({
      '0': 'period',
      '2': 'i1',
    });
    expect(mappingBody({})).toBe('{}');
  });

  it('lists the mapped columns in order', () => {
    expect(mappedColumns({ '10': 'i1', '2': 'period', '5': '' })).toEqual([2, 10]);
  });
});

describe('missingNames', () => {
  it('names the period apart and the indicators by name, in order', () => {
    expect(missingNames(['i3', 'period', 'i2'], targets)).toEqual({
      period: true,
      names: ['Citations', 'Users'],
    });
    expect(missingNames([], targets)).toEqual({ period: false, names: [] });
  });

  it('shows the id of an indicator it does not know rather than nothing', () => {
    expect(missingNames(['zzz'], targets).names).toEqual(['zzz']);
  });
});
