import { describe, expect, it } from 'vitest';
import { parseSubmitQuery, submitQueryString } from './query.ts';

const SERVICE = '0199aaaa-bbbb-7ccc-8ddd-eeeeffff0001';

describe('the address of the page', () => {
  it.each<[string, Record<string, string | undefined>]>([
    ['', {}],
    [`service=${SERVICE}`, { service: SERVICE }],
    [`service=${SERVICE.toUpperCase()}`, { service: SERVICE }],
    [`service=${SERVICE}&period=2026-05`, { service: SERVICE, period: '2026-05' }],
    ['q=%20genome%20', { q: 'genome' }],
    ['service=not-an-id&period=2026-13&q=', {}],
    ['period=2026-5', {}],
    ['period=2026-00', {}],
  ])('reads %j as %j, dropping what it does not understand', (search, expected) => {
    expect(parseSubmitQuery(new URLSearchParams(search))).toEqual({
      service: undefined,
      period: undefined,
      q: undefined,
      ...expected,
    });
  });

  it('cuts a long search at 100 characters', () => {
    expect(parseSubmitQuery(new URLSearchParams({ q: 'x'.repeat(300) })).q).toHaveLength(100);
  });

  it('writes the keys in a fixed order, nothing for nothing, and reads back what it wrote', () => {
    expect(submitQueryString({})).toBe('');
    expect(submitQueryString({ q: 'a b', period: '2026-05', service: SERVICE })).toBe(
      `?service=${SERVICE}&period=2026-05&q=a+b`,
    );
    const query = { service: SERVICE, period: '2026-05', q: 'a b' };
    expect(parseSubmitQuery(new URLSearchParams(submitQueryString(query)))).toEqual(query);
  });
});
