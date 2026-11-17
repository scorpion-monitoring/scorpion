<script lang="ts">
  // SPIKE (sprint 3 of M12a, item 7): a bare ARIA 1.2 combobox with a two-level listbox and a polite live
  // region, only to learn whether VoiceOver and NVDA run stably on hosted runners. Replaced by the scenes of
  // the real component once it exists; nothing here is the design.
  type Option = { id: string; label: string; count?: number };
  const facets: Option[] = [
    { id: 'consortium', label: 'Consortium' },
    { id: 'stage', label: 'Stage' },
  ];
  const values: Record<string, Option[]> = {
    consortium: [
      { id: 'bionet', label: 'BioNet', count: 12 },
      { id: 'plantdata', label: 'PlantData', count: 4 },
    ],
    stage: [{ id: 'prod', label: 'Production', count: 9 }],
  };
  const totals: Record<string, number> = { bionet: 12, plantdata: 4, prod: 9 };

  let open = $state(false);
  let facet = $state<string | undefined>(undefined);
  let active = $state(0);
  let chosen = $state<string[]>([]);
  let status = $state('');
  const options = $derived(facet ? values[facet]! : facets);

  function announce(text: string) {
    status = '';
    setTimeout(() => (status = text), 50);
  }

  function key(event: KeyboardEvent) {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      if (!open) open = true;
      else active = Math.min(options.length - 1, active + 1);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      active = Math.max(0, active - 1);
    } else if ((event.key === 'Enter' || event.key === 'ArrowRight') && open && !facet) {
      event.preventDefault();
      facet = options[active]!.id;
      active = 0;
    } else if (event.key === ' ' && open && facet) {
      event.preventDefault();
      const id = options[active]!.id;
      chosen = chosen.includes(id) ? chosen.filter((c) => c !== id) : [...chosen, id];
      const total = chosen.reduce((sum, c) => sum + (totals[c] ?? 0), 0);
      announce(total === 1 ? '1 service matches' : `${total} services match`);
    } else if (event.key === 'Escape' || (event.key === 'ArrowLeft' && facet)) {
      event.preventDefault();
      if (facet) {
        facet = undefined;
        active = 0;
      } else open = false;
    }
  }
</script>

<h1 class="mb-4 text-2xl font-bold">Screen reader spike</h1>
<button type="button" class="btn btn-sm mb-2">Before</button>
<div class="relative">
  <label for="sr-box" class="block text-sm font-medium">Search and filter services</label>
  <input
    id="sr-box"
    class="input input-bordered w-full"
    role="combobox"
    aria-expanded={open}
    aria-controls="sr-list"
    aria-autocomplete="list"
    aria-activedescendant={open ? `sr-opt-${options[active]?.id}` : undefined}
    autocomplete="off"
    onfocus={() => (open = true)}
    onkeydown={key}
  />
  <ul
    id="sr-list"
    role="listbox"
    aria-label={facet ? (facets.find((f) => f.id === facet)?.label ?? '') : 'Filter by'}
    aria-multiselectable={facet ? 'true' : undefined}
    class="bg-base-100 border-base-300 rounded-box mt-1 border p-1"
    hidden={!open}
  >
    {#each options as option, index (option.id)}
      <li
        id="sr-opt-{option.id}"
        role="option"
        aria-selected={facet ? chosen.includes(option.id) : index === active}
        class={['rounded px-2 py-1', index === active && 'bg-base-200']}
      >
        {option.label}{#if option.count !== undefined}, {option.count} services{/if}
      </li>
    {/each}
  </ul>
</div>
<p role="status" class="mt-2 text-sm">{status}</p>
<button type="button" class="btn btn-sm mt-2">After</button>
