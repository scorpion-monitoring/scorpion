import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { MAX_SERIES_STATES } from '../service/widget-limits.ts';
import {
  hasState,
  resolveConfig,
  seeded,
  shortId,
  stateCount,
  toggleState,
  trendSeries,
  type Filter,
  type TrendRow,
} from './settings.ts';

const defaults: Filter = { service: 'svc-default', range: '2y', category: 'Usage' };
const A = '018f3b7e-aaaa-7000-8000-00000000000a';
const B = '018f3b7e-bbbb-7000-8000-00000000000b';

describe('shortId', () => {
  it('is the last 12 hex digits of the id, lower case, without dashes', () => {
    expect(shortId('018F3B7E-AAAA-7000-8000-0123456789AB')).toBe('0123456789ab');
    expect(shortId(A)).toMatch(/^[0-9a-f]{12}$/);
    expect(shortId(A)).not.toBe(shortId(B));
  });
});

describe('resolveConfig: a tile that was never set up shows the defaults, one that was set up shows its own', () => {
  it.each<[string, unknown, Filter | undefined, unknown]>([
    ['no config and the defaults loaded', {}, defaults, { ...defaults, fresh: true }],
    ['no config and the defaults not loaded yet', {}, undefined, undefined],
    ['not an object', 'x', defaults, { ...defaults, fresh: true }],
    ['an array', [], defaults, { ...defaults, fresh: true }],
    [
      'a range only (repaired by the server): still fresh',
      { range: '1y' },
      defaults,
      { ...defaults, fresh: true },
    ],
    [
      'a service of its own',
      { service: 'svc-own', range: '3m', category: 'all' },
      defaults,
      { service: 'svc-own', range: '3m', category: 'all', fresh: false },
    ],
    [
      'a choice that was made: no service, never the default one',
      { service: null, range: '6m', category: 'all' },
      defaults,
      { service: null, range: '6m', category: 'all', fresh: false },
    ],
    [
      'a service that is not a string is "Choose a service"',
      { service: 5 },
      defaults,
      { service: null, range: '1y', category: 'all', fresh: false },
    ],
  ])('%s', (_name, config, given, expected) => {
    expect(resolveConfig(config, given)).toEqual(expected);
  });

  it('seeds the filter and keeps the other keys', () => {
    expect(seeded({ hidden: ['0123456789ab'] }, defaults)).toEqual({
      hidden: ['0123456789ab'],
      service: 'svc-default',
      range: '2y',
      category: 'Usage',
    });
    expect(seeded({}, { service: null, range: '1y', category: 'all' }).service).toBeNull();
  });
});

describe('toggleState', () => {
  it('switches a KPI on and off in one list without touching the others', () => {
    const on = toggleState({ range: '1y' }, 'hidden', A, true);
    expect(on).toEqual({ ok: true, config: { range: '1y', hidden: [shortId(A)] } });
    const both = toggleState(
      (on as { config: Record<string, unknown> }).config,
      'secondary',
      B,
      true,
    );
    expect(hasState((both as { config: Record<string, unknown> }).config, 'hidden', A)).toBe(true);
    expect(hasState((both as { config: Record<string, unknown> }).config, 'secondary', B)).toBe(
      true,
    );
    expect(hasState((both as { config: Record<string, unknown> }).config, 'secondary', A)).toBe(
      false,
    );
    const off = toggleState(
      (both as { config: Record<string, unknown> }).config,
      'hidden',
      A,
      false,
    );
    expect((off as { config: Record<string, unknown> }).config.hidden).toEqual([]);
  });

  it('is a no-op for a state already as asked', () => {
    const config = { hidden: [shortId(A)] };
    expect(toggleState(config, 'hidden', A, true)).toEqual({ ok: true, config });
    expect(toggleState(config, 'cumulative', A, false)).toEqual({ ok: true, config });
  });

  it('refuses a state that would pass the limit, and always allows switching one off', () => {
    const ids = Array.from(
      { length: MAX_SERIES_STATES },
      (_, i) => `${'0'.repeat(11)}${i.toString(16)}`,
    );
    const full = { hidden: ids };
    expect(stateCount(full)).toBe(MAX_SERIES_STATES);
    const other = '018f3b7e-cccc-7000-8000-0000000000ff';
    expect(toggleState(full, 'cumulative', other, true)).toEqual({ ok: false, reason: 'full' });
    expect(toggleState(full, 'hidden', other, true)).toEqual({ ok: false, reason: 'full' });
    const freed = toggleState(full, 'hidden', `x-${ids[0]}`, false);
    expect(freed.ok && (freed.config.hidden as string[]).length).toBe(MAX_SERIES_STATES - 1);
  });

  it('never holds more than the limit, whatever is toggled, and stays within 400 bytes with the longest filter (a property)', () => {
    const uuids = fc.uuid();
    fc.assert(
      fc.property(
        fc.array(
          fc.tuple(fc.constantFrom('cumulative', 'hidden', 'secondary'), uuids, fc.boolean()),
          { maxLength: 80 },
        ),
        (steps) => {
          let config: Record<string, unknown> = {
            service: '018f3b7e-aaaa-7000-8000-00000000000a',
            range: 'all',
            category: 'x'.repeat(32),
          };
          for (const [state, id, on] of steps) {
            const next = toggleState(config, state, id, on);
            if (next.ok) config = next.config;
            expect(stateCount(config)).toBeLessThanOrEqual(MAX_SERIES_STATES);
          }
          expect(new TextEncoder().encode(JSON.stringify(config)).length).toBeLessThanOrEqual(400);
        },
      ),
    );
  });
});

describe('trendSeries', () => {
  const months = ['2026-01-31', '2026-02-28', '2026-03-31'];
  const row = (
    id: string,
    name: string,
    values: (number | null)[],
    text: (string | null)[] = [],
  ): TrendRow => ({
    indicatorId: id,
    name,
    unit: null,
    points: months.map((period, at) => ({
      period,
      value: values[at] ?? null,
      text: text[at] ?? null,
    })),
  });

  it('has one line per KPI that has a number, a gap stays a gap, and a KPI of text only has none', () => {
    const lines = trendSeries(
      [row(A, 'Downloads', [1, null, 3]), row(B, 'Notes', [null, null, null], ['a', null, 'c'])],
      {},
    );
    expect(lines.map((line) => line.name)).toEqual(['Downloads']);
    expect(lines[0]!.values).toEqual([1, null, 3]);
  });

  it('applies cumulative with the library (a gap carries the total and stays a gap), and marks hidden and secondary', () => {
    const config = {
      cumulative: [shortId(A)],
      hidden: [shortId(B)],
      secondary: [shortId(B)],
    };
    const [one, two] = trendSeries([row(A, 'A', [1, null, 3]), row(B, 'B', [5, 6, 7])], config);
    expect(one).toMatchObject({
      values: [1, null, 4],
      cumulative: true,
      hidden: false,
      secondary: false,
    });
    expect(two).toMatchObject({
      values: [5, 6, 7],
      cumulative: false,
      hidden: true,
      secondary: true,
    });
  });

  it('survives a configuration that is not what it should be (a property)', () => {
    fc.assert(
      fc.property(fc.anything(), (config) => {
        const safe =
          typeof config === 'object' && config !== null && !Array.isArray(config)
            ? (config as Record<string, unknown>)
            : {};
        expect(() => trendSeries([row(A, 'A', [1, 2, 3])], safe)).not.toThrow();
      }),
    );
  });
});
