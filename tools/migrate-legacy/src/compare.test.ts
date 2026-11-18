// The pure parts of `compare`: the windows of the value read (from January 1900 to the current month, at most 120 months each).
import { describe, expect, it } from 'vitest';
import { windows } from './compare.ts';

describe('windows', () => {
  it.each([
    ['January 1900', '1900-01-15T00:00:00Z', [['1900-01', '1900-01']]],
    ['the 120th month', '1909-12-31T23:59:59Z', [['1900-01', '1909-12']]],
    [
      'the 121st month',
      '1910-01-01T00:00:00Z',
      [
        ['1900-01', '1909-12'],
        ['1910-01', '1910-01'],
      ],
    ],
  ])('%s', (_name, now, expected) => {
    expect(windows(new Date(now))).toEqual(expected);
  });

  it('covers every month up to the current one without a gap or an overlap', () => {
    const list = windows(new Date('2026-11-18T10:00:00Z'));
    expect(list).toHaveLength(13);
    expect(list[0]![0]).toBe('1900-01');
    expect(list.at(-1)).toEqual(['2020-01', '2026-11']);
    for (let i = 1; i < list.length; i += 1) {
      const [year, month] = list[i - 1]![1].split('-').map(Number) as [number, number];
      const next =
        month === 12 ? `${year + 1}-01` : `${year}-${String(month + 1).padStart(2, '0')}`;
      expect(list[i]![0]).toBe(next);
    }
  });
});
