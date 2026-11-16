// The faceted search as plain functions (sprint 3 of M12a): what the three looks share and what can be tested
// without a browser. The selection's address is still written by `serializeFacets()` of `../facets.ts`, so a
// selection gives the same address in every look as it did before the redesign; this file adds the text (`q`),
// the matching of typed text against labels, the `facet:value` shortcut, the chips' words and the range check.
import {
  isRange,
  serializeFacets,
  type FacetDefinition,
  type FacetOption,
  type FacetState,
  type RangeValue,
} from '../facets.ts';

/** The three looks an administrator chooses between (`registry.services`, setting `catalogueFilters`). */
export const FACET_LOOKS = ['sidebar', 'bar', 'combined'] as const;
export type FacetLook = (typeof FACET_LOOKS)[number];

/** How long typing rests before the search is sent. */
export const SEARCH_DEBOUNCE_MS = 250;
/** The longest search text an address carries (the catalogue's `q` takes 100). */
export const MAX_TEXT = 100;
/** A list panel shows a filter field above this many values. */
export const FILTER_FROM = 8;
/** A list panel shows at most this many values; the rest are reached by typing. */
export const LIST_CAP = 50;
/** How many matching facet values the combined box offers for typed text. */
export const OFFER_CAP = 8;

/** Text compared without case and without accents (`Böhm` finds `bohm`, `IPK` finds `ipk`). */
export const fold = (text: string): string =>
  text.normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase().trim();

/**
 * The address for a text and a selection: `q` set (trimmed, cut to `MAX_TEXT`) or removed, the facets written by
 * `serializeFacets()`, which also drops `page`, so every change returns to the first page. Everything else in
 * `base` (`sort`, `dir`, `pageSize`, a parameter of the page) stays.
 */
export function facetSearchParams(
  text: string,
  state: FacetState,
  definitions: readonly FacetDefinition[],
  base: URLSearchParams = new URLSearchParams(),
): URLSearchParams {
  const params = new URLSearchParams(base);
  const q = text.trim().slice(0, MAX_TEXT);
  if (q) params.set('q', q);
  else params.delete('q');
  return serializeFacets(state, definitions, params);
}

/** The values of a list panel for a filter: the first `LIST_CAP` that match, and how many more match. */
export function visibleOptions(
  options: readonly FacetOption[],
  filter: string,
): { shown: FacetOption[]; more: number } {
  const wanted = fold(filter);
  const matching = wanted
    ? options.filter((option) => fold(option.label).includes(wanted))
    : [...options];
  return { shown: matching.slice(0, LIST_CAP), more: Math.max(0, matching.length - LIST_CAP) };
}

/** One facet value offered for typed text: "Provider: IPK Gatersleben (12)". */
export interface Offer {
  facet: FacetDefinition & { type: 'checkbox' };
  option: FacetOption;
}

const isList = (
  definition: FacetDefinition,
): definition is FacetDefinition & { type: 'checkbox' } => definition.type === 'checkbox';

/**
 * The facet values whose label contains `text`, best first (more services first, then a label that starts with
 * the text, then the facets' order), at most `limit`. Values already chosen are left out: there is nothing to add.
 */
export function matchingOffers(
  definitions: readonly FacetDefinition[],
  text: string,
  state: FacetState,
  limit = OFFER_CAP,
): Offer[] {
  const wanted = fold(text);
  if (!wanted) return [];
  const found: (Offer & { starts: boolean; order: number })[] = [];
  definitions.filter(isList).forEach((facet, order) => {
    const chosen = state[facet.id];
    for (const option of facet.options) {
      if (Array.isArray(chosen) && chosen.includes(option.value)) continue;
      const label = fold(option.label);
      if (label.includes(wanted)) {
        found.push({ facet, option, starts: label.startsWith(wanted), order });
      }
    }
  });
  return found
    .sort(
      (a, b) =>
        (b.option.count ?? 0) - (a.option.count ?? 0) ||
        Number(b.starts) - Number(a.starts) ||
        a.order - b.order,
    )
    .slice(0, limit)
    .map(({ facet, option }) => ({ facet, option }));
}

/** The facet value to suggest when the typed text matches no name (decision Q2): the best offer, if any. */
export const bestOffer = (
  definitions: readonly FacetDefinition[],
  text: string,
  state: FacetState,
): Offer | undefined => matchingOffers(definitions, text, state, 1)[0];

/** The `facet:value` shortcut, once its facet is known. `value` is the text after the colon, unquoted. */
export interface Shortcut {
  facet: FacetDefinition;
  value: string;
}

const SHORTCUT = /^\s*(?:"([^"]+)"|([^\s:"]+))\s*:\s*(?:"([^"]*)"?|(.*))$/u;

/**
 * Reads `provider:ipk`, `Anbieter:ipk`, `provider:"IPK Gatersleben"` and `"KPI set":core`. The facet is named by its
 * id or by its label in the page's language (the definitions carry that label), without case or accents; a label
 * with spaces is quoted. An unknown facet name, or text without a colon, is no shortcut: it stays search text.
 */
export function parseShortcut(
  text: string,
  definitions: readonly FacetDefinition[],
): Shortcut | undefined {
  const match = SHORTCUT.exec(text);
  if (!match) return undefined;
  const name = fold(match[1] ?? match[2] ?? '');
  const facet = definitions.find(
    (definition) => fold(definition.id) === name || fold(definition.label) === name,
  );
  if (!facet) return undefined;
  return { facet, value: (match[3] ?? match[4] ?? '').trim() };
}

/** Labels of the chosen values of a list facet, in the order they were chosen; an unknown value keeps its key. */
export function chosenLabels(definition: FacetDefinition, state: FacetState): string[] {
  const chosen = state[definition.id];
  if (!isList(definition) || !Array.isArray(chosen)) return [];
  return chosen.map(
    (value) => definition.options.find((option) => option.value === value)?.label ?? value,
  );
}

/** A chip's text is folded to its first value and `+N` past this many characters. */
export const CHIP_FOLD_AT = 32;

/**
 * The words of one facet's chip: `full` names every chosen value (`Consortium: de.NBI, NFDI4Plants`), `short` is
 * what is shown (`Provider: IPK Gatersleben +2` past `CHIP_FOLD_AT` characters), and `name` is for the chip's
 * accessible name: every value, and the shown words in it too (WCAG 2.5.3), so a folded chip is named
 * `Provider: IPK Gatersleben +2 (Forschungszentrum Jülich, IPK Data Hub)`. A range reads `Year: 2018–2022`,
 * `Year: ≥ 2018` or `Year: ≤ 2022`. `undefined` when the facet has nothing chosen.
 */
export function chipText(
  definition: FacetDefinition,
  state: FacetState,
): { full: string; short: string; name: string } | undefined {
  const value = state[definition.id];
  if (value === undefined) return undefined;
  if (definition.type === 'range') {
    if (!isRange(value)) return undefined;
    const text = rangeText(value);
    if (!text) return undefined;
    const full = `${definition.label}: ${text}`;
    return { full, short: full, name: full };
  }
  const labels = chosenLabels(definition, state);
  if (labels.length === 0) return undefined;
  const full = `${definition.label}: ${labels.join(', ')}`;
  if (labels.length < 2 || full.length <= CHIP_FOLD_AT) return { full, short: full, name: full };
  const short = `${definition.label}: ${labels[0]} +${labels.length - 1}`;
  return { full, short, name: `${short} (${labels.slice(1).join(', ')})` };
}

/** `2018–2022`, `≥ 2018`, `≤ 2022`, or empty for a range with neither end. */
export function rangeText(range: RangeValue): string {
  if (range.min !== undefined && range.max !== undefined) {
    return range.min === range.max ? String(range.min) : `${range.min}–${range.max}`;
  }
  if (range.min !== undefined) return `≥ ${range.min}`;
  if (range.max !== undefined) return `≤ ${range.max}`;
  return '';
}

/** Why a range cannot be applied, or `undefined` when it can: `order` (from > to) or `bounds` (outside the facet's limits). */
export function rangeProblem(
  definition: FacetDefinition & { type: 'range' },
  range: RangeValue,
): 'order' | 'bounds' | undefined {
  const { min, max } = range;
  for (const end of [min, max]) {
    if (end !== undefined && (end < definition.min || end > definition.max)) return 'bounds';
  }
  if (min !== undefined && max !== undefined && min > max) return 'order';
  return undefined;
}

/** The facets that have a chip, in the definitions' order. */
export const chosenFacets = (
  definitions: readonly FacetDefinition[],
  state: FacetState,
): FacetDefinition[] => definitions.filter((definition) => chipText(definition, state));
