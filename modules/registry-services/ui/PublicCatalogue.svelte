<script lang="ts">
  // The public list of services: what a Reviewer made public, for anyone, signed in or not. NOTHING here is drawn from
  // a role or a session: the page reads `t`, `href` and `goto` of the shell and the one answer of the public list,
  // never `session()` or `navigation()`, so it is the same page for every visitor. A search by name, the two facets
  // (stage and consortium, counted over the published services), removable badges and pages of the server; the
  // search, the filters and the page live in the address. The names link to the public pages of the service and of
  // its provider; there is no edit, no sort control beyond the name and no create button.
  import { Breadcrumb, DataTable, Facets, getShell, type Column } from '@scorpion/ui-kit';
  import type { FacetDefinition, FacetState } from '@scorpion/ui-kit';
  import type { PublicCatalogueData } from './loaders.ts';
  import {
    catalogueQueryString,
    changeCatalogueQuery,
    PAGE_SIZES,
    withoutFilter,
    type CatalogueQuery,
  } from './query.ts';

  let { data }: { data: PublicCatalogueData } = $props();
  const { t, href, goto } = getShell();

  type Row = PublicCatalogueData['services'][number];

  const path = '/catalog/services';
  const go = (change: Partial<CatalogueQuery>) =>
    goto(href(path) + catalogueQueryString(changeCatalogueQuery(data.query, change)));

  // What is typed in the search box; it starts from the address and goes back to it when the address changes.
  let search = $derived(data.query.q ?? '');

  const definitions = $derived<FacetDefinition[]>(
    data.facets
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
      })),
  );

  const badges = $derived(
    Object.entries(data.query.filters).flatMap(([id, values]) => {
      const facet = data.facets.find((entry) => entry.id === id);
      return values.map((value) => ({
        id,
        value,
        facet: facet?.label ?? id,
        label: facet?.options.find((entry) => entry.key === value)?.label ?? value,
      }));
    }),
  );

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

  <form
    role="search"
    class="flex items-end gap-2"
    onsubmit={(event) => {
      event.preventDefault();
      void go({ q: search.trim() || undefined });
    }}
  >
    <div class="flex flex-col gap-1">
      <label class="text-sm font-medium" for="catalog-search">{t('services.search')}</label>
      <input
        id="catalog-search"
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

  <div class="flex flex-col gap-6">
    <aside class="bg-base-100 border-base-300 rounded-box border p-4">
      <Facets {definitions} state={data.query.filters as FacetState} {path} />
    </aside>

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
          <a class="link link-hover font-medium" href={href(`/catalog/services/${row.slug}`)}
            >{row.name}</a
          >
        </div>
      {/snippet}
      {#snippet providerCell(row: Row)}
        <a class="link link-hover" href={href(`/catalog/organisations/${row.provider.id}`)}
          >{row.provider.name}</a
        >
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
  </div>
</div>
