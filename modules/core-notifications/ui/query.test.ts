import { describe, expect, it } from 'vitest';
import {
  changeDeliveriesQuery,
  DEFAULT_DELIVERIES_QUERY,
  deliveriesApiQuery,
  deliveriesQueryString,
  parseDeliveriesQuery,
} from './query.ts';

const parse = (query: string) => parseDeliveriesQuery(new URLSearchParams(query));

describe('the address of the notification status page', () => {
  it('reads the filters and the page, and drops what is not valid', () => {
    expect(parse('status=dead&channel=email&template=identity.reset&page=2&pageSize=50')).toEqual({
      page: 2,
      pageSize: 50,
      status: 'dead',
      channel: 'email',
      template: 'identity.reset',
    });
    expect(parse('status=lost&channel=sms&page=-1&pageSize=7&template=%20')).toEqual(
      DEFAULT_DELIVERIES_QUERY,
    );
  });

  it('cuts a template filter at the length the API takes', () => {
    expect(parse(`template=${'t'.repeat(150)}`).template).toHaveLength(100);
  });

  it('writes a plain address for the default state and round-trips the rest', () => {
    expect(deliveriesQueryString(DEFAULT_DELIVERIES_QUERY)).toBe('');
    const query = { ...DEFAULT_DELIVERIES_QUERY, status: 'dead' as const, page: 3, pageSize: 10 };
    expect(parse(deliveriesQueryString(query).slice(1))).toEqual(query);
  });

  it('gives the API every value as a string', () => {
    expect(deliveriesApiQuery({ ...DEFAULT_DELIVERIES_QUERY, status: 'sent' })).toEqual({
      page: '0',
      pageSize: '20',
      status: 'sent',
    });
  });

  it('starts again at the first page when a filter changes, but not when only the page does', () => {
    const at3 = { ...DEFAULT_DELIVERIES_QUERY, page: 3 };
    expect(changeDeliveriesQuery(at3, { status: 'dead' }).page).toBe(0);
    expect(changeDeliveriesQuery(at3, { page: 4 }).page).toBe(4);
  });
});
