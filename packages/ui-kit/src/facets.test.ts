import { describe, expect, it } from 'vitest';
import {
  activeFacets,
  clearFacet,
  parseFacets,
  serializeFacets,
  setRange,
  toggleOption,
  type FacetDefinition,
  type FacetState,
} from './facets.ts';

const definitions: FacetDefinition[] = [
  {
    id: 'status',
    label: 'Status',
    type: 'checkbox',
    options: [{ value: 'active', label: 'Active' }],
  },
  { id: 'year', label: 'Year', type: 'range', min: 2000, max: 2030 },
];
const params = (query: string) => new URLSearchParams(query);

describe('parseFacets', () => {
  it.each([
    ['', {}],
    ['f.status=active', { status: ['active'] }],
    ['f.status=active&f.status=pending&f.status=active', { status: ['active', 'pending'] }],
    ['f.status=<script>', {}],
    [`f.status=${'x'.repeat(101)}`, {}],
    ['f.year.min=2010&f.year.max=2020', { year: { min: 2010, max: 2020 } }],
    ['f.year.min=1900', { year: { min: 2000 } }],
    ['f.year.max=3000', { year: { max: 2030 } }],
    ['f.year.min=2020&f.year.max=2010', { year: { min: 2010, max: 2020 } }],
    ['f.year.min=abc&f.year.max=', {}],
    ['f.nothing=x&page=3&q=abc', {}],
  ])('reads %s as %j', (query, expected) => {
    expect(parseFacets(params(query), definitions)).toEqual(expected);
  });
});

describe('serializeFacets', () => {
  it('writes the state, keeps what else is in the address, and drops the page number', () => {
    const query = serializeFacets(
      { status: ['active', 'pending'], year: { min: 2010 } },
      definitions,
      params('q=abc&sort=name&page=4&f.status=old'),
    );
    expect(query.toString()).toBe(
      'q=abc&sort=name&f.status=active&f.status=pending&f.year.min=2010',
    );
  });

  it('removes a facet that is no longer selected', () => {
    expect(
      serializeFacets({}, definitions, params('f.status=old&f.year.max=2020&q=x')).toString(),
    ).toBe('q=x');
  });

  it('round-trips through parseFacets', () => {
    const state: FacetState = { status: ['a', 'b'], year: { min: 2001, max: 2029 } };
    expect(parseFacets(serializeFacets(state, definitions), definitions)).toEqual(state);
  });
});

describe('changing a state', () => {
  it('turns an option on and off, and drops a facet with nothing selected', () => {
    let state: FacetState = {};
    state = toggleOption(state, 'status', 'active', true);
    state = toggleOption(state, 'status', 'pending', true);
    state = toggleOption(state, 'status', 'active', true);
    expect(state).toEqual({ status: ['active', 'pending'] });
    state = toggleOption(state, 'status', 'active', false);
    expect(state).toEqual({ status: ['pending'] });
    expect(toggleOption(state, 'status', 'pending', false)).toEqual({});
  });

  it('sets a range and removes it when both ends are empty', () => {
    expect(setRange({}, 'year', { min: 2010 })).toEqual({ year: { min: 2010 } });
    expect(setRange({ year: { min: 2010 } }, 'year', {})).toEqual({});
    expect(setRange({}, 'year', { min: Number.NaN, max: 2020 })).toEqual({ year: { max: 2020 } });
  });

  it('clears one facet and counts the active ones', () => {
    const state: FacetState = { status: ['a'], year: { min: 2001 } };
    expect(activeFacets(state)).toBe(2);
    expect(clearFacet(state, 'status')).toEqual({ year: { min: 2001 } });
    expect(state).toEqual({ status: ['a'], year: { min: 2001 } });
  });
});
