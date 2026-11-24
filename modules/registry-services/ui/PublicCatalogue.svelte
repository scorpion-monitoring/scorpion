<script lang="ts">
  // The public list of services: what a Reviewer made public, for anyone, signed in or not. NOTHING here is drawn from
  // a role or a session: the page reads `t`, `href` and `goto` of the shell and the one answer of the public list,
  // never `session()` or `navigation()`, so it is the same page for every visitor. The faceted search of ui-kit
  // (`FacetSearch`, in the look the administrator chose, with facet shortcuts for visitors) over the two facets
  // (stage and consortium, counted over the published services), and pages of the server; the search, the
  // filters and the page live in the address. The names link to the public pages of the service and of
  // its provider; there is no edit, no sort control beyond the name and no create button.
  import { Breadcrumb, DataTable, FacetSearch, getShell, type Column } from '@scorpion/ui-kit';
  import type { FacetDefinition, FacetState } from '@scorpion/ui-kit';
  import type { PublicCatalogueData } from './loaders.ts';
  import {
    catalogueQueryString,
    changeCatalogueQuery,
    PAGE_SIZES,
    type CatalogueQuery,
  } from './query.ts';

  let { data }: { data: PublicCatalogueData } = $props();
  const { t, href, goto } = getShell();

  type Row = PublicCatalogueData['services'][number];

  const path = '/catalog/services';
  const go = (change: Partial<CatalogueQuery>) =>
    goto(href(path) + catalogueQueryString(changeCatalogueQuery(data.query, change)));

  /** The API's facets as `FacetSearch` takes them; a facet with no value to show is left out. */
  const toDefinitions = (facets: PublicCatalogueData['facets']): FacetDefinition[] =>
    facets
      .filter((facet) => facet.options.length > 0)
      .map((facet) => ({
        id: facet.id,
        label: facet.label,
        type: 'checkbox' as const,
        options: facet.options.map((option) => ({
          value: option.key,
          label: option.label,
          count: option.count,
        })),
      }));
  const definitions = $derived(toDefinitions(data.facets));
  const suggestions = $derived(toDefinitions(data.suggestions));

  const stageLabel = (key: string) =>
    data.facets.find((facet) => facet.id === 'stage')?.options.find((option) => option.key === key)
      ?.label ?? key;
</script>

<svelte:head><title>{t('catalog.title')}</title></svelte:head>

<div class="flex flex-col gap-6">
  <Breadcrumb items={[{ label: t('catalog.title') }]} />
  <div class="flex flex-col gap-1">
    <h1 class="text-2xl font-bold">{t('catalog.title')}</h1>
    <p>{t('catalog.lead')}</p>
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
    shortcuts
  >
    <div>
      {#snippet nameCell(row: Row)}
        <div class="flex items-center gap-3">
          {#if row.logoUrl}
            <img
              class="size-8 rounded object-contain"
              src={row.logoUrl}
              alt={t('services.icon.alt', { name: row.name })}
            />
          {/if}
          <a class="link link-hover font-medium" href={href(`/catalog/services/${row.slug}`)}>
            {row.name}
          </a>
        </div>
      {/snippet}
      {#snippet providerCell(row: Row)}
        <a class="link link-hover" href={href(`/catalog/organisations/${row.provider.id}`)}>
          {row.provider.name}
        </a>
      {/snippet}
      {#snippet consortiaCell(row: Row)}
        {#if row.consortia.length > 0}
          <ul class="flex flex-wrap gap-1">
            {#each row.consortia as consortium (consortium.id)}
              <li class="badge badge-outline">{consortium.name}</li>
            {/each}
          </ul>
        {/if}
      {/snippet}
      {#snippet stageCell(row: Row)}{stageLabel(row.stage)}{/snippet}

      <DataTable
        caption={t('catalog.title')}
        columns={[
          { key: 'name', header: t('services.name'), rowHeader: true, cell: nameCell },
          { key: 'provider', header: t('services.owner'), cell: providerCell },
          { key: 'consortia', header: t('services.group'), cell: consortiaCell },
          { key: 'stage', header: t('services.stage'), cell: stageCell },
        ] satisfies Column<Row>[]}
        rows={data.services}
        rowKey={(row: Row) => row.id}
        page={data.query.page}
        pageSize={data.query.pageSize}
        total={data.total}
        pageSizes={PAGE_SIZES}
        onpage={(page: number) => void go({ page })}
        onpagesize={(pageSize: number) => void go({ pageSize })}
        empty={t('catalog.empty')}
      />
    </div>
  </FacetSearch>
</div>
