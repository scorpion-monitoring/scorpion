<script lang="ts">
  // The faceted search of a list (sprint 3 of M12a): a search box that searches as one types, the facets, a
  // count line and a polite live region, drawn by one of three looks (`sidebar`, `bar`, `combined`) that an
  // administrator chooses. The state lives here and only here: the text, the selection, the address and the
  // history. A look draws and calls the functions of `view`. The address is the one `Facets` always wrote
  // (`?q=&f.<facet>=<value>`, `serializeFacets()`), and every change goes back to the first page.
  //
  // History: a filter change replaces the entry, as before; a search adds one entry when typing starts and
  // replaces it while typing goes on, so a search is one step back, never one per keystroke.
  import type { Snippet } from 'svelte';
  import { getShell } from './context.ts';
  import type { FacetDefinition, FacetState, RangeValue } from './facets.ts';
  import { clearFacet, setRange as withRange, toggleOption } from './facets.ts';
  import { LOOKS } from './facet-search/looks.ts';
  import {
    bestOffer,
    chipText,
    facetSearchParams,
    MAX_TEXT,
    SEARCH_DEBOUNCE_MS,
    type FacetLook,
    type Offer,
  } from './facet-search/model.ts';
  import type { FacetSearchView } from './facet-search/types.ts';

  let {
    definitions,
    suggestions,
    state: given = {},
    q = '',
    total,
    look = 'sidebar',
    path,
    label,
    countKey = 'kit.facetSearch.matches',
    shortcuts = false,
    onchange,
    children,
  }: {
    definitions: readonly FacetDefinition[];
    /** The facets counted without the text, for the values offered while typing (decision Q2); default `definitions`. */
    suggestions?: readonly FacetDefinition[];
    /** The selection the address holds. */
    state?: FacetState;
    /** The search text the address holds. */
    q?: string;
    /** How many results the list has; `undefined` hides the count line. */
    total?: number;
    look?: FacetLook;
    /** The page's path in the application (`/services`); without it nothing is navigated, only `onchange` is called. */
    path?: string;
    /** The search box's label; default "Search". */
    label?: string;
    /** The keys of the count line: `<key>.one`, `<key>.other`, `<key>.none`, `<key>.noName`. */
    countKey?: string;
    /** Facet buttons under the box (combined): for visitors who do not think of the search box. */
    shortcuts?: boolean;
    onchange?: (change: { q: string; state: FacetState }) => void;
    /** The list itself (a table), drawn under the count line. */
    children: Snippet;
  } = $props();

  const { t, href, goto } = getShell();
  const id = $props.id();

  // What is on screen. Both start from the address and follow it when it changes (the back button, a link).
  // A change shows at once (assigned here); the next answer's `state` replaces it.
  let selection = $derived<FacetState>(given);
  // svelte-ignore state_referenced_locally
  let text = $state(q);
  /** The text the address was last given (or came with). */
  // svelte-ignore state_referenced_locally
  let sent = q;
  let timer: ReturnType<typeof setTimeout> | undefined;
  /** True after the first send of a typing run: the next sends replace its history entry. */
  let typing = false;

  $effect.pre(() => {
    // The address changed from outside (back, a link): take its text, unless it is the one just sent.
    if (q !== sent && timer === undefined) {
      text = q;
      sent = q;
    }
  });

  function navigate(nextText: string, next: FacetState, push: boolean) {
    sent = nextText.trim().slice(0, MAX_TEXT);
    onchange?.({ q: sent, state: next });
    if (path === undefined) return;
    const query = facetSearchParams(
      nextText,
      next,
      definitions,
      new URLSearchParams(window.location.search),
    ).toString();
    void goto(href(path) + (query ? `?${query}` : ''), {
      replace: !push,
      keep: true,
    });
  }

  function flushText() {
    if (timer === undefined) return;
    clearTimeout(timer);
    timer = undefined;
    if (text.trim().slice(0, MAX_TEXT) === sent) return;
    navigate(text, selection, !typing);
    typing = true;
  }

  function change(next: FacetState) {
    if (timer !== undefined) {
      clearTimeout(timer);
      timer = undefined;
    }
    typing = false;
    selection = next;
    navigate(text, next, false);
  }

  /** Said before the count after the next answer ("Stage: Production removed."), then forgotten. */
  let prefix = '';

  const view: FacetSearchView = {
    id,
    t,
    get definitions() {
      return definitions;
    },
    get suggestions() {
      return suggestions ?? definitions;
    },
    get state() {
      return selection;
    },
    get text() {
      return text;
    },
    get label() {
      return label ?? t('kit.facetSearch.search');
    },
    setText(next) {
      text = next.slice(0, MAX_TEXT);
      if (timer !== undefined) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = undefined;
        if (text.trim() === sent) return;
        navigate(text, selection, !typing);
        typing = true;
      }, SEARCH_DEBOUNCE_MS);
    },
    flushText,
    endTyping() {
      flushText();
      typing = false;
    },
    apply: change,
    toggle(facet, value, on) {
      change(toggleOption(selection, facet, value, on));
    },
    setRange(facet, range: RangeValue) {
      change(withRange(selection, facet, range));
    },
    clear(facet, announce = false) {
      const definition = definitions.find((entry) => entry.id === facet);
      const chip = definition ? chipText(definition, selection) : undefined;
      if (announce && chip) prefix = t('kit.facetSearch.removed', { chip: chip.full });
      change(clearFacet(selection, facet));
    },
    clearAll() {
      text = '';
      change({});
    },
    take(offer: Offer) {
      text = '';
      change(toggleOption(selection, offer.facet.id, offer.option.value, true));
    },
  };

  const Look = $derived(LOOKS[look] ?? LOOKS.sidebar);

  /** The value to suggest when the text matches no name but a facet value (decision Q2). */
  const hint = $derived(
    total === 0 && q ? bestOffer(suggestions ?? definitions, q, given) : undefined,
  );
  const hintText = $derived(
    hint
      ? t('kit.facetSearch.suggest', {
          facet: hint.facet.label,
          value: hint.option.label,
          count: hint.option.count ?? 0,
        })
      : '',
  );
  const countText = $derived(
    total === undefined
      ? ''
      : total > 0
        ? t(countKey, { count: total })
        : t(q && hint ? `${countKey}.noName` : `${countKey}.none`),
  );
  const filtered = $derived(Boolean(q) || Object.keys(given).length > 0);

  // The live region: after each change of the answer, the count line again (and what was removed). Not on the
  // first render: a page that opens says nothing on its own. Emptied first, so the same words are said again.
  let status = $state('');
  let first = true;
  let speak: ReturnType<typeof setTimeout> | undefined;
  $effect(() => {
    // A new answer is a new `state` object (and maybe a new text or total), even when the count stays the same.
    void [given, q, total];
    const words = [prefix, countText, hintText].filter(Boolean).join(' ');
    if (first) {
      first = false;
      return;
    }
    prefix = '';
    status = '';
    clearTimeout(speak);
    speak = setTimeout(() => (status = words), 100);
  });
  $effect(() => () => {
    clearTimeout(timer);
    clearTimeout(speak);
  });
</script>

{#snippet results()}
  {#if total !== undefined}
    <div class="flex flex-wrap items-center gap-x-3 gap-y-1" data-facet-count>
      <p class="font-medium" id="{id}-count">{countText}</p>
      {#if hint}
        <button
          type="button"
          class="btn btn-link btn-sm px-0"
          onclick={() => hint && view.take(hint)}>{hintText}</button
        >
      {/if}
      {#if total === 0 && filtered}
        <button type="button" class="btn btn-ghost btn-sm" onclick={() => view.clearAll()}
          >{t('kit.facetSearch.clearAll')}</button
        >
      {/if}
    </div>
  {/if}
  {@render children()}
{/snippet}

<div class="flex flex-col gap-4" data-facet-look={look}>
  <Look {view} {results} {shortcuts} />
  <div role="status" class="sr-only" data-facet-status>{status}</div>
</div>
