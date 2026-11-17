// The value panel of each facet type: the looks `bar` and `combined` pick a panel here and nowhere else, so a new
// facet type adds a panel to this map and no `if` to a look (CLAUDE.md rule 7, inside the kit).
import type { Component } from 'svelte';
import type { FacetDefinition } from '../facets.ts';
import ListPanel from './ListPanel.svelte';
import RangePanel from './RangePanel.svelte';
import type { FacetSearchView } from './types.ts';

export interface PanelProps {
  view: FacetSearchView;
  definition: FacetDefinition;
  /** The id of the panel's list (the combobox's `aria-controls`). */
  listId: string;
  /**
   * `combined`: the look's box keeps the focus, types the filter (`filter`) and hands its keys to `onkey`.
   * `bar`: the panel has its own filter field and keys.
   */
  owned: boolean;
  /** The text that narrows the values when `owned`. */
  filter?: string;
  /** The id of the active option, for the owner's `aria-activedescendant`. */
  activeId?: string;
  /** Escape or ← in the panel: back to where it was opened from. */
  onback: () => void;
}

/** What a panel does with a key its owner hands it; `true` when it used it. */
export interface PanelHandle {
  onkey: (event: KeyboardEvent) => boolean;
  /** Puts the focus into the panel (a range panel's first field); `false` when the panel keeps none. */
  focus: () => boolean;
}

type Panel = Component<PanelProps, PanelHandle, 'activeId'>;

// `tsc` reads a `.svelte` import as Svelte's legacy component type, which does not carry the exports
// (`onkey`, `focus`); svelte-check, which knows the files, checks them against `Panel`.
export const PANELS: Record<FacetDefinition['type'], Panel> = {
  checkbox: ListPanel as unknown as Panel,
  range: RangePanel as unknown as Panel,
};
