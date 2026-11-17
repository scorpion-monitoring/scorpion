<script lang="ts">
  // The look `sidebar`: the look the catalogues had before sprint 3 of M12a. The search box (now searching as
  // one types) above, the facets beside the list from `lg` and above it below, drawn by `Facets` as before.
  // The selection is drawn once, by the checked boxes.
  import Facets from '../Facets.svelte';
  import SearchField from './SearchField.svelte';
  import type { FacetState } from '../facets.ts';
  import type { LookProps } from './types.ts';

  let { view, results }: LookProps = $props();
</script>

<SearchField {view} />
<div class="grid gap-6 lg:grid-cols-[16rem_1fr]">
  <aside>
    <Facets
      definitions={view.definitions}
      state={view.state}
      onchange={(next: FacetState) => view.apply(next)}
    />
  </aside>
  <div class="flex min-w-0 flex-col gap-3">
    {@render results()}
  </div>
</div>
