<script lang="ts">
  // KPI sets: every set with a search, the RIMO category filter and pages (the server sorts by name, then id).
  // The necessity badges count the rows of each necessity; their words come from the vocabulary.
  import { Breadcrumb, DataTable, getShell, type Column } from '@scorpion/ui-kit';
  import type { SetsData } from './loaders.ts';
  import { changeQuery, setsQueryString, type SetsQuery } from './query.ts';
  import { badgeCounts } from './rows.ts';
  import { labelOf } from './terms.ts';

  let { data }: { data: SetsData } = $props();
  const { t, href, goto, locale } = getShell();

  type Row = SetsData['sets'][number];

  const go = (change: Partial<SetsQuery>) =>
    goto(href('/kpi/sets') + setsQueryString(changeQuery(data.query, change)));
  let search = $derived(data.query.q ?? '');
  const badgeText = (badge: { key: string; count: number }) =>
    `${badge.count} ${labelOf(data.necessity, badge.key, locale())}`;
  const order = $derived(data.necessity.map((term) => term.key));
</script>

<svelte:head><title>{t('kpi.sets.title')}</title></svelte:head>

<div class="flex flex-col gap-6">
  <Breadcrumb items={[{ label: t('nav.section.admin') }, { label: t('kpi.sets.title') }]} />
  <div class="flex flex-wrap items-center justify-between gap-2">
    <h1 class="text-2xl font-bold">{t('kpi.sets.title')}</h1>
    <a class="btn btn-primary" href={href('/kpi/sets/new')}>{t('kpi.sets.new')}</a>
  </div>

  <div class="flex flex-wrap items-end gap-4">
    <form
      role="search"
      class="flex items-end gap-2"
      onsubmit={(event) => {
        event.preventDefault();
        void go({ q: search.trim() || undefined });
      }}
    >
      <div class="flex flex-col gap-1">
        <label class="text-sm font-medium" for="sets-search">{t('kpi.sets.search')}</label>
        <input
          id="sets-search"
          type="search"
          class="input input-bordered"
          maxlength={100}
          autocomplete="off"
          bind:value={search}
        />
      </div>
      <button type="submit" class="btn">{t('kpi.sets.searchSubmit')}</button>
    </form>
    <div class="flex flex-col gap-1">
      <label class="text-sm font-medium" for="sets-category">{t('kpi.sets.filter.category')}</label>
      <select
        id="sets-category"
        class="select select-bordered"
        value={data.query.rimoCategory ?? ''}
        onchange={(event) => void go({ rimoCategory: event.currentTarget.value || undefined })}
      >
        <option value="">{t('kpi.sets.filter.all')}</option>
        {#each data.categories as term (term.key)}
          <option value={term.key}>{labelOf(data.categories, term.key, locale())}</option>
        {/each}
      </select>
    </div>
  </div>

  {#snippet nameCell(row: Row)}
    <a class="link link-hover font-medium" href={href(`/kpi/sets/${row.id}`)}>{row.name}</a>
  {/snippet}
  {#snippet categoryCell(row: Row)}
    {row.rimoCategory ? labelOf(data.categories, row.rimoCategory, locale()) : ''}
  {/snippet}
  {#snippet indicatorsCell(row: Row)}
    {#if row.indicatorCount === 0}
      <span class="opacity-70">{t('kpi.sets.noIndicators')}</span>
    {:else}
      <span class="flex flex-wrap items-center gap-1">
        {#each badgeCounts(row.necessityCounts, order) as badge (badge.key)}
          <span class="badge badge-outline">{badgeText(badge)}</span>
        {/each}
      </span>
    {/if}
  {/snippet}

  <DataTable
    caption={t('kpi.sets.title')}
    columns={[
      { key: 'name', header: t('kpi.sets.name'), rowHeader: true, cell: nameCell },
      { key: 'rimoCategory', header: t('kpi.sets.category'), cell: categoryCell },
      { key: 'indicatorCount', header: t('kpi.sets.indicators'), cell: indicatorsCell },
    ] satisfies Column<Row>[]}
    rows={data.sets}
    rowKey={(row: Row) => row.id}
    page={data.query.page}
    pageSize={data.query.pageSize}
    total={data.total}
    onpage={(page: number) => void go({ page })}
    onpagesize={(pageSize: number) => void go({ pageSize })}
    empty={t('kpi.sets.empty')}
  />
</div>
