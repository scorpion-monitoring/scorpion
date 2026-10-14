import { describe, expect, it } from 'vitest';
import {
  boundsProblem,
  formatDuration,
  parseDuration,
  parseFloatValue,
  parseInteger,
  parsePercentage,
  parseText,
  SEED_VALUE_TYPES,
  valueTypeEntrySchema,
  type ValueTypeEntry,
} from './value-types.ts';

const type = (id: string): ValueTypeEntry => SEED_VALUE_TYPES.find((entry) => entry.id === id)!;
const ok = (value: unknown) => ({ ok: true, value });
const bad = (problem: string | RegExp): unknown => ({
  ok: false,
  problem: expect.stringMatching(problem) as unknown,
});

describe('the registry entries', () => {
  it('are the five types of M9, each valid for the registry schema', () => {
    expect(SEED_VALUE_TYPES.map((entry) => entry.id)).toEqual([
      'integer',
      'float',
      'text',
      'duration',
      'percentage',
    ]);
    for (const entry of SEED_VALUE_TYPES)
      expect(valueTypeEntrySchema.safeParse(entry).success).toBe(true);
  });

  it('say which types are numeric and which aggregates fit', () => {
    expect(SEED_VALUE_TYPES.map((e) => [e.id, e.numeric, e.aggregates])).toEqual([
      ['integer', true, ['sum', 'avg', 'min', 'max']],
      ['float', true, ['sum', 'avg', 'min', 'max']],
      ['text', false, []],
      ['duration', true, ['sum', 'avg', 'min', 'max']],
      ['percentage', true, ['avg', 'min', 'max']],
    ]);
  });

  it('refuse an entry with an unknown field, a bad id or a missing function', () => {
    const entry = type('integer');
    expect(valueTypeEntrySchema.safeParse({ ...entry, extra: 1 }).success).toBe(false);
    expect(valueTypeEntrySchema.safeParse({ ...entry, id: 'Integer' }).success).toBe(false);
    expect(valueTypeEntrySchema.safeParse({ ...entry, parse: undefined }).success).toBe(false);
    expect(valueTypeEntrySchema.safeParse({ ...entry, labels: {} }).success).toBe(false);
  });
});

describe('integer', () => {
  it.each<[unknown, unknown]>([
    [0, ok(0)],
    [42, ok(42)],
    [-7, ok(-7)],
    [Number.MAX_SAFE_INTEGER, ok(Number.MAX_SAFE_INTEGER)],
    ['42', ok(42)],
    [' 42 ', ok(42)],
    ['-7', ok(-7)],
    ['+7', ok(7)],
    ['007', ok(7)],
    ['-0', ok(0)],
    [1.5, bad(/whole/)],
    ['1.5', bad(/whole/)],
    ['1e3', bad(/whole/)],
    ['0x10', bad(/whole/)],
    ['', bad(/whole/)],
    [' ', bad(/whole/)],
    ['abc', bad(/whole/)],
    ['1,000', bad(/whole/)],
    [NaN, bad(/whole/)],
    [Infinity, bad(/whole/)],
    [Number.MAX_SAFE_INTEGER + 1, bad(/whole/)],
    ['9007199254740993', bad(/whole/)],
    [null, bad(/whole/)],
    [undefined, bad(/whole/)],
    [true, bad(/whole/)],
    [[1], bad(/whole/)],
    [{}, bad(/whole/)],
  ])('parses %j', (input, expected) => {
    expect(parseInteger(input)).toEqual(expected);
  });
});

describe('float', () => {
  it.each<[unknown, unknown]>([
    [0, ok(0)],
    [1.5, ok(1.5)],
    [-0.25, ok(-0.25)],
    ['1.5', ok(1.5)],
    ['.5', ok(0.5)],
    ['5.', ok(5)],
    ['-3', ok(-3)],
    [' 2.50 ', ok(2.5)],
    [-0, ok(0)],
    ['1e3', bad(/number/)],
    ['1,5', bad(/number/)],
    ['NaN', bad(/number/)],
    ['Infinity', bad(/number/)],
    ['', bad(/number/)],
    ['1.2.3', bad(/number/)],
    [NaN, bad(/finite/)],
    [Infinity, bad(/finite/)],
    [-Infinity, bad(/finite/)],
    [null, bad(/number/)],
    [false, bad(/number/)],
  ])('parses %j', (input, expected) => {
    expect(parseFloatValue(input)).toEqual(expected);
  });

  it('does not turn a text that overflows into a value', () => {
    expect(parseFloatValue('9'.repeat(400))).toEqual(bad(/finite/));
  });
});

describe('text', () => {
  it.each<[unknown, unknown]>([
    ['good', ok('good')],
    ['  trimmed  ', ok('trimmed')],
    ['line\nbreak', ok('line\nbreak')],
    ['a'.repeat(4000), ok('a'.repeat(4000))],
    ['', bad(/empty/)],
    ['   ', bad(/empty/)],
    ['a'.repeat(4001), bad(/at most 4000/)],
    [1, bad(/text/)],
    [null, bad(/text/)],
    [{}, bad(/text/)],
  ])('parses %j', (input, expected) => {
    expect(parseText(input)).toEqual(expected);
  });
});

describe('duration', () => {
  it.each<[unknown, unknown]>([
    ['00-00-00', ok(0)],
    ['00-00-01', ok(1)],
    ['00-01-00', ok(60)],
    ['01-00-00', ok(3600)],
    ['01-02-03', ok(3723)],
    ['1-02-03', ok(3723)],
    ['23-59-59', ok(86399)],
    ['24-00-00', ok(86400)],
    ['100-00-00', ok(360000)],
    ['9999-59-59', ok(9999 * 3600 + 59 * 60 + 59)],
    [' 01-02-03 ', ok(3723)],
    [0, ok(0)],
    [3723, ok(3723)],
    ['00-60-00', bad(/HH-MM-SS/)],
    ['00-00-60', bad(/HH-MM-SS/)],
    ['00-5-00', bad(/HH-MM-SS/)],
    ['00-00-5', bad(/HH-MM-SS/)],
    ['10000-00-00', bad(/HH-MM-SS/)],
    ['01:02:03', bad(/HH-MM-SS/)],
    ['01-02', bad(/HH-MM-SS/)],
    ['01-02-03-04', bad(/HH-MM-SS/)],
    ['-1-00-00', bad(/HH-MM-SS/)],
    ['', bad(/HH-MM-SS/)],
    ['abc', bad(/HH-MM-SS/)],
    [-1, bad(/seconds/)],
    [1.5, bad(/seconds/)],
    [NaN, bad(/seconds/)],
    [Number.MAX_SAFE_INTEGER + 1, bad(/seconds/)],
    [null, bad(/HH-MM-SS/)],
  ])('parses %j', (input, expected) => {
    expect(parseDuration(input)).toEqual(expected);
  });

  it.each<[number, string]>([
    [0, '00-00-00'],
    [1, '00-00-01'],
    [59, '00-00-59'],
    [60, '00-01-00'],
    [3599, '00-59-59'],
    [3600, '01-00-00'],
    [3723, '01-02-03'],
    [86400, '24-00-00'],
    [360000, '100-00-00'],
  ])('formats %i seconds as %s, and parses it back', (seconds, text) => {
    expect(formatDuration(seconds)).toBe(text);
    expect(parseDuration(text)).toEqual(ok(seconds));
  });

  it.each([-1, 1.5, NaN, Infinity, '60', null])('does not format %j', (value) => {
    expect(() => formatDuration(value)).toThrow(RangeError);
  });
});

describe('percentage', () => {
  it.each<[unknown, unknown]>([
    [0, ok(0)],
    [100, ok(100)],
    [50.5, ok(50.5)],
    ['99.9', ok(99.9)],
    ['0', ok(0)],
    [-0.01, bad(/between 0 and 100/)],
    [100.01, bad(/between 0 and 100/)],
    ['101', bad(/between 0 and 100/)],
    ['-1', bad(/between 0 and 100/)],
    ['50%', bad(/number/)],
    [NaN, bad(/finite/)],
    [Infinity, bad(/finite/)],
    ['', bad(/number/)],
    [null, bad(/number/)],
  ])('parses %j', (input, expected) => {
    expect(parsePercentage(input)).toEqual(expected);
  });
});

describe('schema(config): the parser plus the indicator bounds', () => {
  const run = (id: string, config: Parameters<ValueTypeEntry['schema']>[0], input: unknown) =>
    type(id).schema(config).safeParse(input);

  it.each<[string, { min?: number | null; max?: number | null } | undefined, unknown, unknown]>([
    ['integer', undefined, '5', 5],
    ['integer', { min: 0, max: 10 }, 0, 0],
    ['integer', { min: 0, max: 10 }, 10, 10],
    ['integer', { min: 0 }, 1_000_000, 1_000_000],
    ['integer', { max: 10 }, -5, -5],
    ['integer', { min: null, max: null }, 3, 3],
    ['float', { min: 0.5, max: 1.5 }, '1.5', 1.5],
    ['duration', { min: 60, max: 3600 }, '00-30-00', 1800],
    ['percentage', { min: 10, max: 90 }, 55, 55],
    ['percentage', undefined, 100, 100],
    ['text', undefined, '  hello ', 'hello'],
  ])('%s %j accepts %j as %j', (id, config, input, expected) => {
    const result = run(id, config, input);
    expect(result.success).toBe(true);
    expect(result.data).toEqual(expected);
  });

  it.each<[string, { min?: number | null; max?: number | null } | undefined, unknown, RegExp]>([
    ['integer', { min: 0, max: 10 }, -1, /at least 0/],
    ['integer', { min: 0, max: 10 }, 11, /at most 10/],
    ['integer', { min: 1 }, 0, /at least 1/],
    ['integer', undefined, 'x', /whole/],
    ['float', { min: 0.5 }, 0.49, /at least 0.5/],
    ['duration', { max: 60 }, '00-01-01', /at most 60/],
    ['duration', undefined, '1:00', /HH-MM-SS/],
    ['percentage', { max: 50 }, 51, /at most 50/],
    ['percentage', undefined, 101, /between 0 and 100/],
    ['text', undefined, '', /empty/],
    ['text', undefined, 5, /text/],
  ])('%s %j refuses %j', (id, config, input, message) => {
    const result = run(id, config, input);
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toMatch(message);
  });
});

describe('format', () => {
  it.each<[string, unknown, string]>([
    ['integer', 42, '42'],
    ['integer', -3, '-3'],
    ['float', 1.5, '1.5'],
    ['float', 0.1 + 0.2, '0.30000000000000004'],
    ['text', 'hello', 'hello'],
    ['duration', 3723, '01-02-03'],
    ['percentage', 12.5, '12.5'],
  ])('%s %j is %s', (id, value, expected) => {
    expect(type(id).format(value)).toBe(expected);
  });

  it.each<[string, unknown]>([
    ['integer', 'x'],
    ['float', NaN],
    ['text', 5],
    ['duration', -1],
    ['percentage', Infinity],
  ])('%s refuses %j', (id, value) => {
    expect(() => type(id).format(value)).toThrow(RangeError);
  });

  it.each<[string, unknown]>([
    ['integer', 42],
    ['float', 2.75],
    ['text', 'hello'],
    ['duration', 90061],
    ['percentage', 33.3],
  ])('%s %j parses back from its own output', (id, value) => {
    expect(type(id).parse(type(id).format(value))).toEqual(ok(value));
  });
});

describe('boundsProblem', () => {
  it.each<[string, { min?: number | null; max?: number | null }, unknown]>([
    ['integer', {}, undefined],
    ['integer', { min: 0, max: 0 }, undefined],
    ['integer', { min: -5, max: 5 }, undefined],
    ['integer', { min: null, max: 5 }, undefined],
    ['float', { min: 0.5 }, undefined],
    ['duration', { min: 0, max: 86400 }, undefined],
    ['percentage', { min: 0, max: 100 }, undefined],
    ['percentage', { min: 20, max: 80 }, undefined],
    ['text', {}, undefined],
    ['text', { min: null, max: null }, undefined],
    ['integer', { min: 5, max: 4 }, { field: 'min', problem: 'must not exceed max' }],
    ['float', { min: NaN }, { field: 'min', problem: 'must be a finite number' }],
    ['float', { max: Infinity }, { field: 'max', problem: 'must be a finite number' }],
    ['duration', { min: -1 }, { field: 'min', problem: 'must be at least 0' }],
    ['percentage', { min: -1 }, { field: 'min', problem: 'must be at least 0' }],
    ['percentage', { max: 101 }, { field: 'max', problem: 'must be at most 100' }],
    ['text', { min: 0 }, { field: 'min', problem: 'a text indicator has no bounds' }],
    ['text', { max: 5 }, { field: 'max', problem: 'a text indicator has no bounds' }],
  ])('%s %j', (id, config, expected) => {
    expect(boundsProblem(type(id), config)).toEqual(expected);
  });

  it('decides from the entry, not from the id: a contributed numeric type with a range is checked the same way', () => {
    const contributed = { id: 'rating', numeric: true, range: { min: 1, max: 5 } };
    expect(boundsProblem(contributed, { min: 1, max: 5 })).toBeUndefined();
    expect(boundsProblem(contributed, { max: 6 })).toEqual({
      field: 'max',
      problem: 'must be at most 5',
    });
    expect(boundsProblem({ id: 'label', numeric: false }, { min: 1 })).toEqual({
      field: 'min',
      problem: 'a label indicator has no bounds',
    });
  });
});
