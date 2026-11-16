// What `FacetSearch` hands to a look. The look draws; every change goes through these functions, so the three
// looks give the same address, the same history and the same announcements for the same selection.
import type { Snippet } from 'svelte';
import type { FacetDefinition, FacetState, RangeValue } from '../facets.ts';
import type { Translate } from '../i18n.ts';
import type { Offer } from './model.ts';

export interface FacetSearchView {
  /** A prefix for the ids of this instance's elements (ARIA references). */
  readonly id: string;
  readonly t: Translate;
  /** The facets, counted over the search and the other facets (the API's answer). */
  readonly definitions: readonly FacetDefinition[];
  /**
   * The facets counted without the text (`q`), for offering values that match typed text; the same as
   * `definitions` when the page has none.
   */
  readonly suggestions: readonly FacetDefinition[];
  /** The selection on screen (a change shows at once, before the next answer arrives). */
  readonly state: FacetState;
  /** What is typed in the search box. */
  readonly text: string;
  /** The search box's label. */
  readonly label: string;
  /** Typing: the text is sent after `SEARCH_DEBOUNCE_MS` of rest. */
  setText(text: string): void;
  /** Sends a waiting text at once (Enter). */
  flushText(): void;
  /** The box was left: the next typing starts a new history entry. */
  endTyping(): void;
  /** A whole new selection (the sidebar's `Facets` gives one). */
  apply(next: FacetState): void;
  toggle(id: string, value: string, on: boolean): void;
  setRange(id: string, range: RangeValue): void;
  /** Clears one facet; `announce` says so in the live region before the count. */
  clear(id: string, announce?: boolean): void;
  /** Clears the text and every facet. */
  clearAll(): void;
  /** Adds an offered value and removes the typed text. */
  take(offer: Offer): void;
}

/** The props of a look. `results` is the count line and the table, placed where the look wants them. */
export interface LookProps {
  view: FacetSearchView;
  results: Snippet;
  /** Facet buttons under the box that open the list at a facet (combined; the public page). */
  shortcuts?: boolean;
}
