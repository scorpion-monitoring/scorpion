import { describe, expect, it } from 'vitest';
import { relevantRows, type RelevantRow } from './relevant.ts';

const point = (value: number | null, text: string | null = null) => ({ value, text });
const row = (name: string, points: RelevantRow['points'], current = true): RelevantRow => ({
  name,
  current,
  points,
});

describe('relevantRows', () => {
  const numbers = row('Users', [point(null), point(3)]);
  const text = row('Licence', [point(null, 'MIT'), point(null)]);
  const empty = row('Downloads', [point(null), point(null)]);
  const dropped = row('Hits', [point(5), point(6)], false);

  it.each<[string, 'value' | 'number', string[], string[]]>([
    ['a value of any kind', 'value', ['Users', 'Licence'], ['Downloads']],
    ['a number', 'number', ['Users'], ['Licence', 'Downloads']],
  ])('shows the KPIs of the set with %s and names the rest', (_, needs, shown, without) => {
    const chosen = relevantRows([numbers, text, empty, dropped], needs);
    expect(chosen.shown.map((r) => r.name)).toEqual(shown);
    expect(chosen.empty).toEqual(without);
  });

  it('never shows a KPI the service no longer has, even with values', () => {
    expect(relevantRows([dropped])).toEqual({ shown: [], empty: [] });
  });

  it('keeps the order of the answer', () => {
    const second = row('Actions', [point(1)]);
    expect(relevantRows([numbers, second]).shown).toEqual([numbers, second]);
  });

  it('defaults to any value', () => {
    expect(relevantRows([text]).shown).toEqual([text]);
  });
});
