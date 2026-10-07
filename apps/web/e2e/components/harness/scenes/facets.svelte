<script lang="ts">
  import { Facets, parseFacets, type FacetDefinition, type FacetState } from '@scorpion/ui-kit';

  const definitions: FacetDefinition[] = [
    {
      id: 'status',
      label: 'Status',
      type: 'checkbox',
      options: [
        { value: 'active', label: 'Active', count: 12 },
        { value: 'pending', label: 'Pending', count: 3 },
        { value: 'closed', label: 'Closed' },
      ],
    },
    { id: 'year', label: 'Year', type: 'range', min: 2000, max: 2030 },
  ];
  let selected = $state<FacetState>(
    parseFacets(new URLSearchParams(window.location.search), definitions),
  );
  let search = $state(window.location.search);
</script>

<h1 class="mb-4 text-2xl font-bold">Facets</h1>
<Facets
  {definitions}
  bind:state={selected}
  path="/"
  onchange={() => (search = window.location.search)}
/>
<pre class="bg-base-200 mt-4 p-2 text-xs" data-testid="state">{JSON.stringify(selected)}</pre>
<p class="mt-2">Address: <code data-testid="search">{search}</code></p>
