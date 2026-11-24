<script lang="ts">
  // The service catalogue: a table with the faceted search of ui-kit (`FacetSearch`: a search as one types,
  // facets that count over the filtered set, a count line, in the look the administrator chose) and server-side
  // sort and pages. The search, the filters, the sort and the page live in the address; a change of the
  // search, a filter, the sort or the page size goes back to the first page. The
  // labels of the facets and their values come from the API (the registry, the vocabulary, the organisation);
  // the page names none of them. The links to the wizard and to a service page appear only when the API says
  // the caller may create and the page is offered (`./offered.ts`).
  import {
    Breadcrumb,
    DataTable,
    FacetSearch,
    type Column,
    type FacetDefinition,
    type FacetState,
    type Sort,
  } from '@scorpion/ui-kit';
  import { getShell } from '@scorpion/ui-kit';
  import type { CatalogueData } from './loaders.ts';
  import { isOffered } from './offered.ts';
  import {
    catalogueQueryString,
    changeCatalogueQuery,
    PAGE_SIZES,
    SORT_KEYS,
    type CatalogueQuery,
    type SortKey,
  } from './query.ts';

  let { data }: { data: CatalogueData } = $props();
  const { t, href, goto } = getShell();

  type Row = CatalogueData['services'][number];

  const path = '/services';
  const go = (change: Partial<CatalogueQuery>) =>
    goto(href(path) + catalogueQueryString(changeCatalogueQuery(data.query, change)));

  /** The API's facets as `FacetSearch` takes them; a facet with no value to show is left out. */
  const toDefinitions = (facets: CatalogueData['facets']): FacetDefinition[] =>
    facets
      .filter((facet) => facet.values.length > 0)
      .map((facet) => ({
        id: facet.id,
        label: facet.label,
        type: 'checkbox' as const,
        options: facet.values.map((value) => ({
          value: value.key,
          label: value.label,
          count: value.count,
        })),
      }));
  const definitions = $derived(toDefinitions(data.facets));
  const suggestions = $derived(toDefinitions(data.suggestions));

  const sort = $derived<Sort>({ key: data.query.sort, direction: data.query.dir });
  const onsort = (next: Sort) =>
    void go({
      sort: (SORT_KEYS as readonly string[]).includes(next.key) ? (next.key as SortKey) : 'name',
      dir: next.direction,
    });

  const detailOffered = isOffered('/services/:slug');
  const wizardOffered = isOffered('/services/new');
</script>

<svelte:head><title>{t('services.title')}</title></svelte:head>

<div class="flex flex-col gap-6">
  <Breadcrumb items={[{ label: t('services.title') }]} />
  <div class="flex flex-wrap items-center justify-between gap-2">
    <h1 class="text-2xl font-bold">{t('services.title')}</h1>
    {#if data.canCreate && wizardOffered}
      <a class="btn btn-primary" href={href('/services/new')}>{t('services.new')}</a>
    {/if}
  </div>

  <FacetSearch
    {definitions}
    {suggestions}
    state={data.query.filters as FacetState}
    q={data.query.q ?? ''}
    total={data.total}
    look={data.filterStyle}
    {path}
    label={t('services.search')}
    countKey="services.matches"
  >
    <div>
      {#snippet nameCell(row: Row)}
        <div class="flex items-center gap-3">
          {#if row.iconUrl}
            <img
              class="size-8 rounded object-contain"
              src={row.iconUrl}
              alt={t('services.icon.alt', { name: row.name })}
            />
          {/if}
          {#if detailOffered}
            <a class="link link-hover font-medium" href={href(`/services/${row.slug}`)}>
              {row.name}
            </a>
          {:else}
            <span class="font-medium">{row.name}</span>
          {/if}
        </div>
      {/snippet}
      {#snippet providerCell(row: Row)}
        {#if row.provider}
          {row.provider
            .name}{#if row.provider.abbreviation && row.provider.abbreviation !== row.provider.name}
            ({row.provider.abbreviation}){/if}
        {/if}
      {/snippet}
      {#snippet consortiaCell(row: Row)}
        {#if row.consortia.length > 0}
          <ul class="flex flex-wrap gap-1">
            {#each row.consortia as consortium (consortium.id)}
              <li class="badge badge-outline">
                {consortium.abbreviation || consortium.name}{#if consortium.abbreviation}<span
                    class="sr-only"
                  >
                    ({consortium.name})
                  </span>{/if}
              </li>
            {/each}
          </ul>
        {/if}
      {/snippet}
      {#snippet stageCell(row: Row)}
        {data.facets
          .find((facet) => facet.id === 'stage')
          ?.values.find((value) => value.key === row.stage)?.label ?? row.stage}
      {/snippet}

      <DataTable
        caption={t('services.title')}
        columns={[
          {
            key: 'name',
            header: t('services.name'),
            sortable: true,
            rowHeader: true,
            cell: nameCell,
          },
          { key: 'provider', header: t('services.owner'), sortable: true, cell: providerCell },
          { key: 'consortia', header: t('services.group'), cell: consortiaCell },
          { key: 'stage', header: t('services.stage'), sortable: true, cell: stageCell },
        ] satisfies Column<Row>[]}
        rows={data.services}
        rowKey={(row: Row) => row.id}
        {sort}
        {onsort}
        page={data.query.page}
        pageSize={data.query.pageSize}
        total={data.total}
        pageSizes={PAGE_SIZES}
        onpage={(page: number) => void go({ page })}
        onpagesize={(pageSize: number) => void go({ pageSize })}
        empty={t('services.empty')}
      />
    </div>
  </FacetSearch>
</div>
