<script lang="ts">
  // The service catalogue: a table with a search, facets that count over the filtered set, removable filter
  // badges and server-side sort and pages. The search, the filters, the sort and the page live in the
  // address; a change of the search, a filter, the sort or the page size goes back to the first page. The
  // labels of the facets and their values come from the API (the registry, the vocabulary, the organisation);
  // the page names none of them. The links to the wizard and to a service page appear only when the API says
  // the caller may create and the page is offered (`./offered.ts`).
  import {
    Breadcrumb,
    DataTable,
    Facets,
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
    withoutFilter,
    type CatalogueQuery,
    type SortKey,
  } from './query.ts';

  let { data }: { data: CatalogueData } = $props();
  const { t, href, goto } = getShell();

  type Row = CatalogueData['services'][number];

  const path = '/services';
  const go = (change: Partial<CatalogueQuery>) =>
    goto(href(path) + catalogueQueryString(changeCatalogueQuery(data.query, change)));

  // What is typed in the search box; it starts from the address and goes back to it when the address changes.
  let search = $derived(data.query.q ?? '');

  const definitions = $derived<FacetDefinition[]>(
    data.facets
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
      })),
  );

  /** The chosen values as badges: the facet's label and the value's label, from the API's answer. */
  const badges = $derived(
    Object.entries(data.query.filters).flatMap(([id, values]) => {
      const facet = data.facets.find((entry) => entry.id === id);
      return values.map((value) => ({
        id,
        value,
        facet: facet?.label ?? id,
        label: facet?.values.find((entry) => entry.key === value)?.label ?? value,
      }));
    }),
  );

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

  <form
    role="search"
    class="flex items-end gap-2"
    onsubmit={(event) => {
      event.preventDefault();
      void go({ q: search.trim() || undefined });
    }}
  >
    <div class="flex flex-col gap-1">
      <label class="text-sm font-medium" for="services-search">{t('services.search')}</label>
      <input
        id="services-search"
        type="search"
        class="input input-bordered"
        maxlength={100}
        autocomplete="off"
        bind:value={search}
      />
    </div>
    <button type="submit" class="btn">{t('services.searchSubmit')}</button>
  </form>

  {#if badges.length > 0}
    <section aria-label={t('services.filters.active')} class="flex flex-wrap items-center gap-2">
      <ul class="flex flex-wrap gap-2">
        {#each badges as badge (`${badge.id}/${badge.value}`)}
          <li>
            <button
              type="button"
              class="badge badge-outline badge-lg gap-2"
              aria-label={t('services.filters.remove', { facet: badge.facet, value: badge.label })}
              onclick={() => void go(withoutFilter(data.query, badge.id, badge.value))}
            >
              <span>{badge.facet}: {badge.label}</span>
              <span aria-hidden="true">×</span>
            </button>
          </li>
        {/each}
      </ul>
    </section>
  {/if}

  <div class="grid gap-6 lg:grid-cols-[16rem_1fr]">
    <aside>
      <Facets {definitions} state={data.query.filters as FacetState} {path} />
    </aside>

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
            <a class="link link-hover font-medium" href={href(`/services/${row.slug}`)}
              >{row.name}</a
            >
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
                    ({consortium.name})</span
                  >{/if}
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
  </div>
</div>
