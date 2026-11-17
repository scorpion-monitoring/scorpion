<script lang="ts">
  // The chips of the look `bar`: one per facet with a choice, then "Clear all". A chip is a button named
  // "Remove Consortium: BioNet, PlantData"; it shows the short text (`Provider: IPK Gatersleben +2`). After a
  // removal the focus goes to the next chip, the one before, or (none left) to `onempty`.
  import { tick } from 'svelte';
  import type { FacetDefinition } from '../facets.ts';
  import { chipText } from './model.ts';
  import type { FacetSearchView } from './types.ts';

  let {
    view,
    facets,
    onempty,
  }: { view: FacetSearchView; facets: FacetDefinition[]; onempty: () => void } = $props();

  let row = $state<HTMLElement>();

  async function remove(index: number) {
    const facet = facets[index];
    if (!facet) return;
    view.clear(facet.id, true);
    await tick();
    const chips = row?.querySelectorAll<HTMLButtonElement>('[data-chip]') ?? [];
    const next = chips[Math.min(index, chips.length - 1)];
    if (next) next.focus();
    else onempty();
  }
</script>

{#if facets.length > 0}
  <div bind:this={row} class="flex flex-wrap items-center gap-2">
    <ul class="flex flex-wrap gap-2" aria-label={view.t('kit.facets.label')}>
      {#each facets as facet, index (facet.id)}
        {@const chip = chipText(facet, view.state)}
        {#if chip}
          <li>
            <button
              type="button"
              data-chip
              class="badge badge-outline badge-lg h-auto max-w-full gap-2 py-1"
              aria-label={view.t('kit.facetSearch.remove', { chip: chip.name })}
              onclick={() => void remove(index)}
            >
              <span class="truncate">{chip.short}</span>
              <span aria-hidden="true">×</span>
            </button>
          </li>
        {/if}
      {/each}
    </ul>
    <button
      type="button"
      class="btn btn-ghost btn-sm"
      onclick={() => {
        view.clearAll();
        onempty();
      }}>{view.t('kit.facetSearch.clearAll')}</button
    >
  </div>
{/if}
