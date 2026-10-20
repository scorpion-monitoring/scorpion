// The value mapping: pure, table-driven. A numeric type goes to `value_numeric` as a decimal text, any other type to
// `value_text`; exactly one column is set; a registry entry that returns the wrong kind is a problem, never a failing insert.
import { describe, expect, it } from 'vitest';
import { fromColumns, MAX_TEXT_VALUE, sameColumns, toColumns } from './values.ts';

describe('toColumns', () => {
  it.each<[string, boolean, unknown, { valueNumeric: string | null; valueText: string | null }]>([
    ['an integer', true, 42, { valueNumeric: '42', valueText: null }],
    ['a negative integer', true, -7, { valueNumeric: '-7', valueText: null }],
    ['zero', true, 0, { valueNumeric: '0', valueText: null }],
    ['negative zero', true, -0, { valueNumeric: '0', valueText: null }],
    ['a fraction', true, 0.1, { valueNumeric: '0.1', valueText: null }],
    ['a long fraction', true, 0.1 + 0.2, { valueNumeric: '0.30000000000000004', valueText: null }],
    ['a large number', true, 1e21, { valueNumeric: '1e+21', valueText: null }],
    ['a small number', true, 1e-7, { valueNumeric: '1e-7', valueText: null }],
    [
      'the largest safe integer',
      true,
      Number.MAX_SAFE_INTEGER,
      { valueNumeric: '9007199254740991', valueText: null },
    ],
    ['text', false, 'a note', { valueNumeric: null, valueText: 'a note' }],
    ['text with a number in it', false, '42', { valueNumeric: null, valueText: '42' }],
    [
      'text of the longest length',
      false,
      'x'.repeat(MAX_TEXT_VALUE),
      { valueNumeric: null, valueText: 'x'.repeat(MAX_TEXT_VALUE) },
    ],
    [
      'text with a line break and an emoji',
      false,
      'a\nb 🙂',
      { valueNumeric: null, valueText: 'a\nb 🙂' },
    ],
  ])('maps %s', (_name, numeric, canonical, expected) => {
    expect(toColumns(numeric, canonical)).toEqual({ ok: true, value: expected });
  });

  it.each<[string, boolean, unknown]>([
    ['a numeric type given text', true, '42'],
    ['a numeric type given NaN', true, Number.NaN],
    ['a numeric type given Infinity', true, Number.POSITIVE_INFINITY],
    ['a numeric type given -Infinity', true, Number.NEGATIVE_INFINITY],
    ['a numeric type given null', true, null],
    ['a numeric type given a bigint', true, 1n],
    ['a text type given a number', false, 42],
    ['a text type given an empty text', false, ''],
    ['a text type given a text that is too long', false, 'x'.repeat(MAX_TEXT_VALUE + 1)],
    ['a text type given null', false, null],
    ['a text type given an object', false, {}],
  ])('refuses %s', (_name, numeric, canonical) => {
    expect(toColumns(numeric, canonical).ok).toBe(false);
  });

  it('sets exactly one column, whatever the input', () => {
    for (const [numeric, value] of [
      [true, 1],
      [true, 0],
      [false, 'a'],
    ] as const) {
      const result = toColumns(numeric, value);
      expect(result.ok).toBe(true);
      if (result.ok)
        expect((result.value.valueNumeric === null) !== (result.value.valueText === null)).toBe(
          true,
        );
    }
  });
});

describe('fromColumns', () => {
  it.each<[string | null, string | null, number | string]>([
    ['42', null, 42],
    ['0.1', null, 0.1],
    ['-7', null, -7],
    ['1e+21', null, 1e21],
    [null, 'a note', 'a note'],
    [null, '42', '42'],
  ])('reads (%j, %j) as %j', (valueNumeric, valueText, expected) => {
    expect(fromColumns({ valueNumeric, valueText })).toBe(expected);
  });

  it('refuses a row with neither column, which the table cannot hold', () => {
    expect(() => fromColumns({ valueNumeric: null, valueText: null })).toThrow(RangeError);
  });

  it.each([42, 0, -7, 0.1, 0.1 + 0.2, 1e21, 1e-7, Number.MAX_SAFE_INTEGER])(
    'gives back the number %s that toColumns stored',
    (value) => {
      const mapped = toColumns(true, value);
      expect(mapped.ok && fromColumns(mapped.value)).toBe(value);
    },
  );
});

describe('sameColumns', () => {
  it.each<
    [
      string,
      { valueNumeric: string | null; valueText: string | null },
      { valueNumeric: string | null; valueText: string | null },
      boolean,
    ]
  >([
    [
      'the same number',
      { valueNumeric: '5', valueText: null },
      { valueNumeric: '5', valueText: null },
      true,
    ],
    [
      'the same number written differently',
      { valueNumeric: '1.50', valueText: null },
      { valueNumeric: '1.5', valueText: null },
      true,
    ],
    [
      'another number',
      { valueNumeric: '5', valueText: null },
      { valueNumeric: '6', valueText: null },
      false,
    ],
    [
      'the same text',
      { valueNumeric: null, valueText: 'a' },
      { valueNumeric: null, valueText: 'a' },
      true,
    ],
    [
      'another text',
      { valueNumeric: null, valueText: 'a' },
      { valueNumeric: null, valueText: 'A' },
      false,
    ],
    [
      'a number and a text',
      { valueNumeric: '5', valueText: null },
      { valueNumeric: null, valueText: '5' },
      false,
    ],
    [
      'a text and a number',
      { valueNumeric: null, valueText: '5' },
      { valueNumeric: '5', valueText: null },
      false,
    ],
  ])('%s', (_name, a, b, expected) => {
    expect(sameColumns(a, b)).toBe(expected);
  });
});
