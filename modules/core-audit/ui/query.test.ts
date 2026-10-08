import { describe, expect, it } from 'vitest';
import {
  EMPTY_QUERY,
  isFiltered,
  logsApiQuery,
  logsQueryString,
  parseLogsQuery,
  validDay,
} from './query.ts';

const parse = (query: string) => parseLogsQuery(new URLSearchParams(query));

describe('validDay', () => {
  it.each([
    ['2026-10-08', '2026-10-08'],
    ['2026-02-29', undefined],
    ['2024-02-29', '2024-02-29'],
    ['2026-13-01', undefined],
    ['10/08/2026', undefined],
    ['2026-10-08T00:00:00Z', undefined],
    ['', undefined],
    [null, undefined],
  ])('%s → %s', (input, expected) => expect(validDay(input)).toBe(expected));
});

describe('the address of the Logs page', () => {
  it('reads every filter and drops what is not valid', () => {
    expect(
      parse(
        'method=POST&user=abc&endpoint=/api/internal/users&action=api.POST&outcome=denied&source=api&from=2026-10-01&to=2026-10-31',
      ),
    ).toEqual({
      method: 'POST',
      user: 'abc',
      endpoint: '/api/internal/users',
      action: 'api.POST',
      outcome: 'denied',
      source: 'api',
      from: '2026-10-01',
      to: '2026-10-31',
    });
    expect(parse('method=TRACE&outcome=fine&source=x&from=yesterday&user=%20%20')).toEqual(
      EMPTY_QUERY,
    );
  });

  it('cuts the text filters at the length the API takes', () => {
    expect(parse(`user=${'u'.repeat(300)}`).user).toHaveLength(200);
    expect(parse(`endpoint=${'e'.repeat(900)}`).endpoint).toHaveLength(500);
  });

  it('writes a plain address for no filter and round-trips the rest', () => {
    expect(logsQueryString(EMPTY_QUERY)).toBe('');
    const query = { ...EMPTY_QUERY, method: 'PUT' as const, endpoint: '/api/internal/settings' };
    expect(parse(logsQueryString(query).slice(1))).toEqual(query);
  });

  it('turns the days into the start and the end of the day (UTC) for the API', () => {
    expect(
      logsApiQuery({ ...EMPTY_QUERY, from: '2026-10-01', to: '2026-10-01', outcome: 'ok' }),
    ).toEqual({
      outcome: 'ok',
      from: '2026-10-01T00:00:00.000Z',
      to: '2026-10-01T23:59:59.999Z',
    });
    expect(logsApiQuery(EMPTY_QUERY)).toEqual({});
  });

  it('says whether a filter is set', () => {
    expect(isFiltered(EMPTY_QUERY)).toBe(false);
    expect(isFiltered({ ...EMPTY_QUERY, source: 'event' })).toBe(true);
  });
});
