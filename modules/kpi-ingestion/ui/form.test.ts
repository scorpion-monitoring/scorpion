import { describe, expect, it } from 'vitest';
import {
  checkValue,
  groupRows,
  hasAnyValue,
  initialValues,
  inputSpec,
  isDirty,
  missingMandatory,
  problemsByIndicator,
  valuesPayload,
  type InputSpec,
} from './form.ts';
import type { GridRow, ValueType } from './types.ts';

const row = (id: string, necessity: string, extra: Partial<GridRow> = {}): GridRow => ({
  indicatorId: id,
  name: `Indicator ${id}`,
  valueType: 'integer',
  unit: null,
  necessity,
  min: null,
  max: null,
  measurement: null,
  ...extra,
});
const stored = (value: string): GridRow['measurement'] => ({ id: 'm', value, valueNumber: null });

// The value types as `GET /kpi/value-types` answers them.
const TYPES: Record<string, ValueType> = {
  integer: {
    id: 'integer',
    labels: { en: 'Whole number' },
    numeric: true,
    aggregates: [],
    input: { kind: 'number', step: 1 },
  },
  float: {
    id: 'float',
    labels: { en: 'Decimal' },
    numeric: true,
    aggregates: [],
    input: { kind: 'number', step: 'any' },
  },
  percentage: {
    id: 'percentage',
    labels: { en: 'Percentage' },
    numeric: true,
    range: { min: 0, max: 100 },
    aggregates: [],
    input: { kind: 'number', step: 'any' },
  },
  duration: {
    id: 'duration',
    labels: { en: 'Duration' },
    numeric: true,
    range: { min: 0 },
    aggregates: [],
    input: { kind: 'text', pattern: '^\\d{1,4}-[0-5]\\d-[0-5]\\d$', hint: 'HH-MM-SS' },
  },
  text: {
    id: 'text',
    labels: { en: 'Text' },
    numeric: false,
    aggregates: [],
    input: { kind: 'text' },
  },
  // a type that says nothing about its input (a contribution from another module)
  rating: { id: 'rating', labels: { en: 'Rating' }, numeric: true, aggregates: [] },
  note: { id: 'note', labels: { en: 'Note' }, numeric: false, aggregates: [] },
};

describe('groupRows', () => {
  const rows = [
    row('a', 'optional'),
    row('b', 'mandatory'),
    row('c', 'recommended'),
    row('d', 'mandatory'),
    row('e', 'custom'),
  ];
  it.each<[string, string[], string[]]>([
    [
      'the order of the vocabulary',
      ['mandatory', 'recommended', 'optional'],
      ['mandatory', 'recommended', 'optional', 'custom'],
    ],
    [
      'a vocabulary in another order',
      ['optional', 'mandatory'],
      ['optional', 'mandatory', 'recommended', 'custom'],
    ],
    [
      'a term the rows do not use',
      ['mandatory', 'unused', 'optional'],
      ['mandatory', 'optional', 'recommended', 'custom'],
    ],
    ['no vocabulary', [], ['optional', 'mandatory', 'recommended', 'custom']],
  ])('puts the groups in %s', (_, order, expected) => {
    expect(groupRows(rows, order).map((group) => group.necessity)).toEqual(expected);
  });

  it('keeps the grid order inside a group and the 1-based position of each row in the grid', () => {
    const groups = groupRows(rows, ['mandatory', 'recommended', 'optional']);
    expect(groups[0]!.rows.map((entry) => [entry.row.indicatorId, entry.position])).toEqual([
      ['b', 2],
      ['d', 4],
    ]);
    expect(
      groups
        .flatMap((group) => group.rows)
        .map((entry) => entry.position)
        .sort(),
    ).toEqual([1, 2, 3, 4, 5]);
  });

  it('has no group for no rows', () => {
    expect(groupRows([], ['mandatory'])).toEqual([]);
  });
});

describe('inputSpec', () => {
  it.each<[string, Partial<GridRow>, Partial<InputSpec>]>([
    [
      'integer',
      {},
      { kind: 'number', step: 1, inputMode: 'numeric', min: undefined, max: undefined },
    ],
    ['float', {}, { kind: 'number', step: 'any', inputMode: 'decimal' }],
    ['percentage', {}, { kind: 'number', step: 'any', min: 0, max: 100 }],
    ['percentage', { min: 10, max: 50 }, { min: 10, max: 50 }],
    ['percentage', { min: -5, max: 500 }, { min: 0, max: 100 }],
    ['integer', { min: 0, max: 1000 }, { min: 0, max: 1000 }],
    [
      'duration',
      {},
      { kind: 'text', hint: 'HH-MM-SS', min: undefined, max: undefined, inputMode: 'text' },
    ],
    ['text', { min: 0 }, { kind: 'text', min: undefined, hint: undefined }],
    // no descriptor: a numeric type is a number input, anything else text
    ['rating', { min: 1, max: 5 }, { kind: 'number', step: 'any', min: 1, max: 5 }],
    ['note', {}, { kind: 'text' }],
  ])('draws %s %j as %j', (typeId, bounds, expected) => {
    const spec = inputSpec(TYPES[typeId], { min: null, max: null, ...bounds });
    expect(spec).toMatchObject(expected);
  });

  it('is a text input for a type the registry does not know', () => {
    expect(inputSpec(undefined, { min: null, max: null }).kind).toBe('text');
  });

  it('has a pattern for the duration that matches what the registry says', () => {
    const spec = inputSpec(TYPES.duration, { min: null, max: null });
    expect(spec.pattern?.test('01-30-00')).toBe(true);
    expect(spec.pattern?.test('1:30:00')).toBe(false);
  });

  it('ignores a pattern that is not a regular expression instead of failing', () => {
    const odd = { numeric: false, input: { kind: 'text' as const, pattern: '(' } };
    expect(inputSpec(odd, { min: null, max: null }).pattern).toBeUndefined();
  });
});

describe('checkValue', () => {
  const spec = (typeId: string, bounds: Partial<GridRow> = {}) =>
    inputSpec(TYPES[typeId], { min: null, max: null, ...bounds });
  it.each<[string, string, Partial<GridRow>, string, unknown]>([
    // [type, text, bounds, name, the issue (undefined = fine)]
    ['integer', '', {}, 'blank is no value', undefined],
    ['integer', '   ', {}, 'only spaces is no value', undefined],
    ['integer', '42', {}, 'a whole number', undefined],
    ['integer', '-7', {}, 'a negative whole number', undefined],
    ['integer', '+7', {}, 'a signed whole number', undefined],
    ['integer', ' 12 ', {}, 'padding is trimmed', undefined],
    ['integer', '1.5', {}, 'a decimal in a whole-number field', { code: 'integer' }],
    ['integer', '1e3', {}, 'an exponent', { code: 'number' }],
    ['integer', 'abc', {}, 'text', { code: 'number' }],
    ['integer', '1,5', {}, 'a decimal comma', { code: 'number' }],
    ['integer', '0x10', {}, 'hex', { code: 'number' }],
    ['integer', '5', { min: 10 }, 'under the minimum', { code: 'min', bound: 10 }],
    ['integer', '10', { min: 10 }, 'at the minimum', undefined],
    ['integer', '11', { max: 10 }, 'over the maximum', { code: 'max', bound: 10 }],
    ['integer', '10', { max: 10 }, 'at the maximum', undefined],
    ['float', '12.5', {}, 'a decimal', undefined],
    ['float', '.5', {}, 'a leading point', undefined],
    ['float', '5.', {}, 'a trailing point', undefined],
    ['float', '-0.25', {}, 'a negative decimal', undefined],
    ['float', '1.2.3', {}, 'two points', { code: 'number' }],
    ['float', 'NaN', {}, 'NaN', { code: 'number' }],
    ['float', 'Infinity', {}, 'Infinity', { code: 'number' }],
    ['percentage', '100', {}, 'the top of the range', undefined],
    ['percentage', '100.1', {}, 'over the range', { code: 'max', bound: 100 }],
    ['percentage', '-1', {}, 'under the range', { code: 'min', bound: 0 }],
    [
      'percentage',
      '60',
      { max: 50 },
      'over the indicator’s bound inside the range',
      { code: 'max', bound: 50 },
    ],
    ['duration', '01-30-00', {}, 'a duration', undefined],
    ['duration', '9999-59-59', {}, 'the longest duration', undefined],
    ['duration', '1-60-00', {}, 'sixty minutes', { code: 'pattern' }],
    ['duration', '01:30:00', {}, 'colons', { code: 'pattern' }],
    ['duration', '90', {}, 'minutes only', { code: 'pattern' }],
    ['text', 'anything at all', {}, 'text', undefined],
    ['text', 'x'.repeat(4000), {}, 'the longest text', undefined],
    ['text', 'x'.repeat(4001), {}, 'text that is too long', { code: 'long' }],
    ['rating', '3', { min: 1, max: 5 }, 'a type with no descriptor', undefined],
    [
      'rating',
      '6',
      { min: 1, max: 5 },
      'a type with no descriptor, over',
      { code: 'max', bound: 5 },
    ],
  ])('%s %j %j (%s)', (typeId, text, bounds, _name, expected) => {
    expect(checkValue(spec(typeId, bounds), text)).toEqual(expected);
  });

  it('treats text a number input could not read as a number problem, even when the field looks blank', () => {
    expect(checkValue(spec('integer'), '', true)).toEqual({ code: 'number' });
    expect(checkValue(spec('text'), '', true)).toBeUndefined();
  });
});

describe('the state of the form', () => {
  const rows = [
    row('a', 'mandatory', { measurement: stored('5') }),
    row('b', 'mandatory'),
    row('c', 'optional', { measurement: stored('01-30-00'), valueType: 'duration' }),
  ];

  it('fills in the stored values, blank for the rest, a duration as its canonical text', () => {
    expect(initialValues(rows)).toEqual({ a: '5', b: '', c: '01-30-00' });
  });

  it.each<[string, Record<string, string>, string[]]>([
    ['the stored values only', { a: '5', b: '', c: '' }, ['b']],
    ['every mandatory filled', { a: '5', b: '1', c: '' }, []],
    ['spaces are no value', { a: '  ', b: '1', c: '' }, ['a']],
    ['nothing filled', {}, ['a', 'b']],
  ])('lists the mandatory indicators with no value: %s', (_, values, missing) => {
    expect(missingMandatory(rows, values).map((entry) => entry.indicatorId)).toEqual(missing);
  });

  it('sends only what is filled in, trimmed, and nothing for a blank field', () => {
    expect(valuesPayload({ a: ' 5 ', b: '', c: '   ', d: '01-00-00' })).toEqual({
      a: '5',
      d: '01-00-00',
    });
    expect(valuesPayload({})).toEqual({});
  });

  it('knows whether anything is filled in', () => {
    expect(hasAnyValue({ a: '', b: ' ' })).toBe(false);
    expect(hasAnyValue({ a: '', b: '1' })).toBe(true);
  });

  it.each<[string, Record<string, string>, boolean]>([
    ['as stored', { a: '5', b: '', c: '01-30-00' }, false],
    ['a field changed', { a: '6', b: '', c: '01-30-00' }, true],
    ['a stored value cleared', { a: '', b: '', c: '01-30-00' }, true],
    ['a blank field filled', { a: '5', b: '1', c: '01-30-00' }, true],
    ['only padding differs', { a: ' 5 ', b: ' ', c: '01-30-00' }, false],
  ])('is dirty when the form differs from what is stored: %s', (_, values, dirty) => {
    expect(isDirty(rows, values)).toBe(dirty);
  });
});

describe('problemsByIndicator', () => {
  const rows = [row('a', 'mandatory'), row('b', 'optional'), row('c', 'optional')];
  it('maps the column of a form problem (1-based, the place in the grid) to the indicator', () => {
    const { byIndicator, general } = problemsByIndicator(
      [
        { row: 1, column: 2, code: 'value-invalid' },
        { row: 1, column: 1, code: 'required-value' },
        { row: 1, column: 2, code: 'duplicate-row' },
      ],
      rows,
    );
    expect(byIndicator.get('b')?.map((problem) => problem.code)).toEqual([
      'value-invalid',
      'duplicate-row',
    ]);
    expect(byIndicator.get('a')?.map((problem) => problem.code)).toEqual(['required-value']);
    expect(general).toEqual([]);
  });

  it('keeps a problem of the form as a whole, or of a column that is not there, as general', () => {
    const { byIndicator, general } = problemsByIndicator(
      [
        { row: 1, column: 0, code: 'period-invalid' },
        { row: 1, column: 9, code: 'value-invalid' },
      ],
      rows,
    );
    expect(byIndicator.size).toBe(0);
    expect(general).toHaveLength(2);
  });
});
