// The state of `Facets` as plain functions: what is selected, how it is written into the address and read
// back, so a filtered list can be bookmarked and shared. A checkbox facet keeps a list of option values
// (`f.status=active&f.status=pending`); a range facet keeps a minimum and a maximum
// (`f.year.min=2020&f.year.max=2024`). Anything else in the query (`page`, `sort`, `q`) is left alone.
export interface FacetOption {
  value: string;
  label: string;
  /** How many results this option would give; shown next to it when the server knows. */
  count?: number;
}

export type FacetDefinition =
  | { id: string; label: string; type: 'checkbox'; options: FacetOption[] }
  | { id: string; label: string; type: 'range'; min: number; max: number; step?: number };

export type RangeValue = { min?: number; max?: number };
export type FacetValue = string[] | RangeValue;
export type FacetState = Record<string, FacetValue>;

const PREFIX = 'f.';
/** A value read from an address: short, and made of characters an option value can hold. */
const OPTION_VALUE = /^[A-Za-z0-9._:@/+-]{1,100}$/;

export const isRange = (value: FacetValue | undefined): value is RangeValue =>
  value !== undefined && !Array.isArray(value);

const toNumber = (text: string | null): number | undefined => {
  if (text === null || text.trim() === '') return undefined;
  const value = Number(text);
  return Number.isFinite(value) ? value : undefined;
};

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/** What the address says about the facets. A value that is not valid is dropped; a range is kept inside its limits. */
export function parseFacets(
  params: URLSearchParams,
  definitions: readonly FacetDefinition[],
): FacetState {
  const state: FacetState = {};
  for (const definition of definitions) {
    if (definition.type === 'checkbox') {
      const values = params
        .getAll(`${PREFIX}${definition.id}`)
        .filter((value) => OPTION_VALUE.test(value));
      if (values.length > 0) state[definition.id] = [...new Set(values)];
    } else {
      let min = toNumber(params.get(`${PREFIX}${definition.id}.min`));
      let max = toNumber(params.get(`${PREFIX}${definition.id}.max`));
      if (min !== undefined) min = clamp(min, definition.min, definition.max);
      if (max !== undefined) max = clamp(max, definition.min, definition.max);
      if (min !== undefined && max !== undefined && min > max) [min, max] = [max, min];
      if (min !== undefined || max !== undefined) {
        state[definition.id] = {
          ...(min === undefined ? {} : { min }),
          ...(max === undefined ? {} : { max }),
        };
      }
    }
  }
  return state;
}

/**
 * The query for a state: `base` (the rest of the address) with every facet parameter replaced. `page` is
 * dropped, because a filter changes how many pages there are.
 */
export function serializeFacets(
  state: FacetState,
  definitions: readonly FacetDefinition[],
  base: URLSearchParams = new URLSearchParams(),
): URLSearchParams {
  const params = new URLSearchParams(base);
  for (const key of [...params.keys()]) {
    if (key.startsWith(PREFIX)) params.delete(key);
  }
  params.delete('page');
  for (const definition of definitions) {
    const value = state[definition.id];
    if (definition.type === 'checkbox' && Array.isArray(value)) {
      for (const option of value) params.append(`${PREFIX}${definition.id}`, option);
    } else if (definition.type === 'range' && isRange(value)) {
      if (value.min !== undefined) params.set(`${PREFIX}${definition.id}.min`, String(value.min));
      if (value.max !== undefined) params.set(`${PREFIX}${definition.id}.max`, String(value.max));
    }
  }
  return params;
}

/** The state without one facet. */
function without(state: FacetState, id: string): FacetState {
  const rest = { ...state };
  delete rest[id];
  return rest;
}

/** One option turned on or off. */
export function toggleOption(
  state: FacetState,
  id: string,
  value: string,
  on: boolean,
): FacetState {
  const current = state[id];
  const list = Array.isArray(current) ? current : [];
  const next = on ? [...new Set([...list, value])] : list.filter((entry) => entry !== value);
  const rest = without(state, id);
  return next.length === 0 ? rest : { ...rest, [id]: next };
}

/** A range changed; an empty range (neither end) removes the facet. */
export function setRange(state: FacetState, id: string, range: RangeValue): FacetState {
  const rest = without(state, id);
  const cleaned: RangeValue = {
    ...(range.min === undefined || Number.isNaN(range.min) ? {} : { min: range.min }),
    ...(range.max === undefined || Number.isNaN(range.max) ? {} : { max: range.max }),
  };
  return cleaned.min === undefined && cleaned.max === undefined ? rest : { ...rest, [id]: cleaned };
}

export const clearFacet = (state: FacetState, id: string): FacetState => without(state, id);

/** How many facets have a selection (for "Clear filters (3)"). */
export const activeFacets = (state: FacetState): number => Object.keys(state).length;
