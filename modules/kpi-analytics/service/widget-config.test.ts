// The configuration of the widgets: what a tile may hold, what it is repaired to, and that it always fits the 400 bytes the dashboard allows.
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { MAX_SERIES_STATES } from './widget-limits.ts';
import { filterConfigSchema, parseWidgetConfig, trendsConfigSchema } from './widget-config.ts';

const ID = '018f3b7e-aaaa-7000-8000-00000000000a';
const bytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).length;

describe('the filter configuration', () => {
  it.each<[string, unknown, unknown]>([
    [
      'nothing stored: the range and the category are always applied, the service is absent (never set up)',
      {},
      { range: '1y', category: 'all' },
    ],
    [
      'a full configuration',
      { service: ID, range: '3m', category: 'Usage' },
      { service: ID, range: '3m', category: 'Usage' },
    ],
    [
      'a choice that was made: "Choose a service"',
      { service: null },
      { service: null, range: '1y', category: 'all' },
    ],
    [
      'a bad range is repaired with the rest to the defaults, never to no range',
      { range: '5y' },
      { range: '1y', category: 'all' },
    ],
    ['a service that is no id', { service: 'abc' }, { range: '1y', category: 'all' }],
    ['an unknown key', { service: ID, extra: 1 }, { range: '1y', category: 'all' }],
    ['a category that is too long', { category: 'x'.repeat(33) }, { range: '1y', category: 'all' }],
    ['not an object', 'x', { range: '1y', category: 'all' }],
    ['null', null, { range: '1y', category: 'all' }],
    ['an array', [], { range: '1y', category: 'all' }],
  ])('%s', (_name, raw, expected) => {
    expect(parseWidgetConfig(filterConfigSchema, raw)).toEqual(expected);
  });
});

describe('the trends configuration', () => {
  const state = (n: number) =>
    Array.from({ length: n }, (_, i) => i.toString(16).padStart(12, '0'));

  it('defaults the three lists to empty and keeps what fits', () => {
    expect(parseWidgetConfig(trendsConfigSchema, {})).toEqual({
      range: '1y',
      category: 'all',
      cumulative: [],
      hidden: [],
      secondary: [],
    });
    const stored = {
      service: ID,
      range: 'all',
      category: 'Usage',
      cumulative: state(3),
      hidden: state(2),
      secondary: state(1),
    };
    expect(parseWidgetConfig(trendsConfigSchema, stored)).toEqual(stored);
  });

  it.each<[string, unknown]>([
    ['an id that is not 12 hex digits', { hidden: ['nope'] }],
    ['an upper-case id', { hidden: ['0123456789AB'] }],
    ['a KPI twice in a list', { hidden: ['0123456789ab', '0123456789ab'] }],
    ['a list that is too long', { hidden: state(MAX_SERIES_STATES + 1) }],
    ['all lists together too long', { cumulative: state(8), hidden: state(7) }],
    ['a list that is not a list', { hidden: 'x' }],
  ])('repairs %s to the defaults', (_name, raw) => {
    expect(parseWidgetConfig(trendsConfigSchema, raw)).toEqual({
      range: '1y',
      category: 'all',
      cumulative: [],
      hidden: [],
      secondary: [],
    });
  });

  it('takes the most the limit allows, and then fits 400 bytes with the longest filter', () => {
    const longest = {
      service: ID,
      range: 'all',
      category: 'c'.repeat(32),
      cumulative: state(5),
      hidden: state(5),
      secondary: state(4),
    };
    expect(parseWidgetConfig(trendsConfigSchema, longest)).toEqual(longest);
    expect(bytes(longest)).toBeLessThanOrEqual(400);
  });
});

describe('any input (properties)', () => {
  for (const [name, schema] of [
    ['filter', filterConfigSchema],
    ['trends', trendsConfigSchema],
  ] as const) {
    it(`${name}: never throws, always gives a configuration that fits the schema and 400 bytes, and parsing it again changes nothing`, () => {
      fc.assert(
        fc.property(fc.anything({ maxDepth: 4 }), (raw) => {
          const once = parseWidgetConfig(schema, raw);
          expect(schema.safeParse(once).success).toBe(true);
          expect(bytes(once)).toBeLessThanOrEqual(400);
          expect(parseWidgetConfig(schema, once)).toEqual(once);
        }),
      );
    });
  }

  it('trends: a configuration made of plausible parts is kept whole or replaced whole, never half repaired', () => {
    const shortIds = fc.array(fc.stringMatching(/^[0-9a-f]{12}$/), { maxLength: 16 });
    fc.assert(
      fc.property(
        fc.record({
          service: fc.option(fc.uuid(), { nil: undefined }),
          range: fc.constantFrom('3m', '6m', '1y', '2y', 'all'),
          category: fc.string({ minLength: 1, maxLength: 32 }),
          cumulative: shortIds,
          hidden: shortIds,
          secondary: shortIds,
        }),
        (raw) => {
          const parsed = parseWidgetConfig(trendsConfigSchema, raw);
          const kept =
            JSON.stringify(parsed) ===
            JSON.stringify({ ...raw, ...(raw.service === undefined ? {} : {}) });
          const replaced =
            parsed.cumulative.length + parsed.hidden.length + parsed.secondary.length === 0 &&
            parsed.range === '1y';
          expect(kept || replaced || parsed.range === raw.range).toBe(true);
        },
      ),
    );
  });
});
