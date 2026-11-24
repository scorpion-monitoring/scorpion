<script lang="ts">
  // The look `bar` (option B of the brainstorm, the fallback of `combined`): the search box, a row of facet buttons
  // under it that open the facet's value panel as a popover (a bottom sheet below `sm`), and one row of chips, one
  // per facet with a choice, with "Clear all". The buttons are disclosure buttons; Escape closes the popover and
  // gives the focus back to its button. A chip's × removes its facet; the focus then goes to the next chip, the
  // one before, or the search box.
  import { tick } from 'svelte';
  import ChipRow from './ChipRow.svelte';
  import { PANELS, type PanelHandle } from './panels.ts';
  import SearchField from './SearchField.svelte';
  import type { LookProps } from './types.ts';
  import { chipText } from './model.ts';

  let { view, results }: LookProps = $props();

  let open = $state<string>();
  let panel = $state<PanelHandle>();
  let bar = $state<HTMLElement>();
  const buttonId = (facet: string) => `${view.id}-facet-${facet}`;
  const panelId = (facet: string) => `${view.id}-panel-${facet}`;

  async function show(facet: string) {
    open = open === facet ? undefined : facet;
    if (open) {
      await tick();
      panel?.focus();
    }
  }

  function close(focusButton = true) {
    const was = open;
    open = undefined;
    if (was && focusButton) document.getElementById(buttonId(was))?.focus();
  }

  const chosenCount = (facet: string) => {
    const value = view.state[facet];
    return Array.isArray(value) ? value.length : value ? 1 : 0;
  };
</script>

<svelte:window
  onclick={(event: MouseEvent) => {
    if (open && bar && !bar.contains(event.target as Node)) close(false);
  }}
/>

<SearchField {view} />
<div
  bind:this={bar}
  role="group"
  aria-label={view.t('kit.facetSearch.filterBy')}
  class="flex flex-wrap gap-2"
>
  {#each view.definitions as definition (definition.id)}
    {@const count = chosenCount(definition.id)}
    {@const Panel = PANELS[definition.type]}
    <div class="sm:relative">
      <button
        id={buttonId(definition.id)}
        type="button"
        class={['btn btn-sm', count > 0 && 'btn-active']}
        aria-expanded={open === definition.id}
        aria-controls={panelId(definition.id)}
        onclick={() => void show(definition.id)}
      >
        {definition.label}
        {#if count > 0}
          <span class="badge badge-sm badge-primary">{count}</span><span class="sr-only">
            {view.t('kit.facetSearch.chosen')}
          </span>
        {/if}
        <span aria-hidden="true">▾</span>
      </button>
      {#if open === definition.id}
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div
          id={panelId(definition.id)}
          class="bg-base-100 border-base-300 rounded-box z-30 border p-2 shadow-lg max-sm:fixed max-sm:inset-x-0 max-sm:bottom-0 max-sm:max-h-[70vh] max-sm:overflow-y-auto max-sm:rounded-b-none sm:absolute sm:top-full sm:left-0 sm:mt-1 sm:w-80"
          onkeydown={(event) => {
            if (event.key === 'Escape') {
              event.preventDefault();
              close();
            }
          }}
        >
          <Panel
            bind:this={panel}
            {view}
            {definition}
            listId="{panelId(definition.id)}-list"
            owned={false}
            onback={() => close()}
          />
        </div>
      {/if}
    </div>
  {/each}
</div>
<ChipRow
  {view}
  facets={view.definitions.filter((definition) => chipText(definition, view.state))}
  onempty={() => document.getElementById(`${view.id}-search`)?.focus()}
/>
<div class="flex min-w-0 flex-col gap-3">
  {@render results()}
</div>
