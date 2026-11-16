<script lang="ts">
  // FacetSearch (sprint 3 of M12a) over a made-up list that counts the way the catalogue's API does: each facet
  // over the services that the text and the *other* facets leave, a chosen value with no service kept with 0,
  // "No consortium" a real value. `look` picks the look, `set` the facets:
  //   2x3    two facets of three values (the default)
  //   6      six facets
  //   300    one facet with 300 values
  //   range  a range facet next to a list facet
  //   zero   a text that matches no name but a facet value (start with `q=gatersleben`)
  import {
    FACET_LOOKS,
    FacetSearch,
    fold,
    parseFacets,
    type FacetDefinition,
    type FacetLook,
    type FacetState,
  } from '@scorpion/ui-kit';

  type Service = { name: string; values: Record<string, string[]>; year: number };
  type Facet = { id: string; label: string; options: { value: string; label: string }[] };

  const params = new URLSearchParams(window.location.search);
  const asked = params.get('look');
  const look: FacetLook = (FACET_LOOKS as readonly string[]).includes(asked ?? '')
    ? (asked as FacetLook)
    : 'combined';
  const set = params.get('set') ?? '2x3';

  const option = (value: string, label = value) => ({ value, label });
  const consortium: Facet = {
    id: 'consortium',
    label: 'Consortium',
    options: [
      option('denbi', 'de.NBI'),
      option('nfdi4plants', 'NFDI4Plants'),
      option(':none', 'No consortium'),
    ],
  };
  const stage: Facet = {
    id: 'stage',
    label: 'Stage',
    options: [
      option('PROD', 'Production'),
      option('DEV', 'Development'),
      option('RETIRED', 'Retired'),
    ],
  };
  const provider: Facet = {
    id: 'provider',
    label: 'Provider',
    options:
      set === '300'
        ? Array.from({ length: 300 }, (_, index) =>
            option(
              `p${index}`,
              index === 7 ? 'IPK Gatersleben' : `Provider ${String(index).padStart(3, '0')}`,
            ),
          )
        : [
            option('ipk', 'IPK Gatersleben'),
            option('fzj', 'Forschungszentrum Jülich'),
            option('bielefeld', 'Bielefeld University'),
          ],
  };
  const licence: Facet = {
    id: 'license',
    label: 'Licence',
    options: [option('MIT'), option('Apache-2.0'), option(':none', 'Unknown')],
  };
  const kpiSet: Facet = {
    id: 'kpi-set',
    label: 'KPI set',
    options: [option('core', 'Core'), option('extended', 'Extended')],
  };
  const topic: Facet = {
    id: 'topic',
    label: 'Topic',
    options: [
      option('genomics', 'Genomics'),
      option('proteomics', 'Proteomics'),
      option('imaging', 'Imaging'),
    ],
  };

  const lists: Facet[] =
    set === '6'
      ? [consortium, stage, provider, licence, kpiSet, topic]
      : set === '300'
        ? [provider, stage]
        : set === 'range'
          ? [stage]
          : set === 'zero'
            ? [consortium, provider]
            : [consortium, stage];
  const withYear = set === 'range';

  const pick = <T,>(items: readonly T[], index: number) => items[index % items.length]!;
  const services: Service[] = Array.from({ length: set === '300' ? 300 : 24 }, (_, index) => ({
    name: `Service ${index < 26 ? String.fromCharCode(65 + index) : index}${index === 3 ? ' Galaxy' : ''}`,
    year: 2010 + (index % 12),
    values: Object.fromEntries(
      lists.map((facet) => {
        if (facet.id === 'consortium') {
          // One service in two consortia, one in none.
          if (index === 0) return [facet.id, ['denbi', 'nfdi4plants']];
          if (index % 5 === 4) return [facet.id, [':none']];
        }
        // Every one of the 300 providers runs a service, so each is listed (a value with none is not).
        if (facet.id === 'provider' && set === '300')
          return [facet.id, [pick(facet.options, index).value]];
        return [facet.id, [pick(facet.options, index * (facet.id.length + 1)).value]];
      }),
    ),
  }));

  const definitionsOf = (
    counts: Map<string, Map<string, number>> | undefined,
    state: FacetState,
  ) => [
    ...lists.map((facet): FacetDefinition => {
      const chosen = state[facet.id];
      return {
        id: facet.id,
        label: facet.label,
        type: 'checkbox',
        options: facet.options
          .map((entry) => ({ ...entry, count: counts?.get(facet.id)?.get(entry.value) ?? 0 }))
          .filter(
            (entry) => entry.count > 0 || (Array.isArray(chosen) && chosen.includes(entry.value)),
          ),
      };
    }),
    ...(withYear
      ? [{ id: 'year', label: 'Year', type: 'range', min: 2000, max: 2030 } as FacetDefinition]
      : []),
  ];

  const all = definitionsOf(undefined, {});
  const matches = (service: Service, text: string, state: FacetState, skip?: string) =>
    (!text || fold(service.name).includes(fold(text))) &&
    Object.entries(state).every(([id, value]) => {
      if (id === skip) return true;
      if (Array.isArray(value)) return value.some((entry) => service.values[id]?.includes(entry));
      return (
        (value.min === undefined || service.year >= value.min) &&
        (value.max === undefined || service.year <= value.max)
      );
    });

  function answer(text: string, state: FacetState) {
    // eslint-disable-next-line svelte/prefer-svelte-reactivity -- a count made and read in one call, not state
    const counts = new Map<string, Map<string, number>>();
    for (const facet of lists) {
      // eslint-disable-next-line svelte/prefer-svelte-reactivity -- as above
      const perValue = new Map<string, number>();
      for (const service of services) {
        if (!matches(service, text, state, facet.id)) continue;
        for (const value of service.values[facet.id] ?? [])
          perValue.set(value, (perValue.get(value) ?? 0) + 1);
      }
      counts.set(facet.id, perValue);
    }
    const rows = services.filter((service) => matches(service, text, state));
    return { definitions: definitionsOf(counts, state), rows };
  }

  let q = $state(params.get('q') ?? '');
  let selection = $state<FacetState>(parseFacets(params, all));
  const current = $derived(answer(q, selection));
  const suggestions = $derived(answer('', selection).definitions);
  let address = $state(window.location.search);
  let changes = $state(0);
</script>

<h1 class="mb-4 text-2xl font-bold">Facet search</h1>
<FacetSearch
  definitions={current.definitions}
  {suggestions}
  state={selection}
  {q}
  total={current.rows.length}
  {look}
  path="/"
  label="Search services"
  countKey="harness.matches"
  shortcuts={params.has('shortcuts')}
  onchange={(change: { q: string; state: FacetState }) => {
    q = change.q;
    selection = change.state;
    changes += 1;
    // The harness's `goto` replaces the address after `onchange`; read it on the next turn.
    setTimeout(() => (address = window.location.search));
  }}
>
  <ul aria-label="Results" class="flex flex-col gap-1" data-testid="rows">
    {#each current.rows.slice(0, 20) as row (row.name)}
      <li>{row.name}</li>
    {/each}
  </ul>
</FacetSearch>
<pre class="bg-base-200 mt-4 p-2 text-xs" data-testid="state">{JSON.stringify({
    q,
    state: selection,
  })}</pre>
<p class="mt-2">
  Address: <code data-testid="search">{address}</code> <span data-testid="changes">{changes}</span>
</p>
