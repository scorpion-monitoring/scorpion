<script lang="ts">
  // Indicators: every indicator with a search, filters (thematic category, unit, kind) and pages (the server sorts
  // by name, then id). A row leads to the editor; "New indicator" to the create form. The labels of categories and
  // units come from their vocabularies and the value types from the registry.
  import { Breadcrumb, DataTable, getShell, type Column } from '@scorpion/ui-kit';
  import type { IndicatorsData } from './loaders.ts';
  import { changeQuery, indicatorsQueryString, type IndicatorsQuery } from './query.ts';
  import { labelOf } from './terms.ts';

  let { data }: { data: IndicatorsData } = $props();
  const { t, href, goto, locale } = getShell();

  type Row = IndicatorsData['indicators'][number];

  const go = (change: Partial<IndicatorsQuery>) =>
    goto(href('/kpi/indicators') + indicatorsQueryString(changeQuery(data.query, change)));

  // What is typed in the search box; it starts from the address and goes back to it when the address changes.
  let search = $derived(data.query.q ?? '');

  const typeLabel = (id: string) => {
    const entry = data.types.find((type) => type.id === id);
    return entry ? (entry.labels[locale() as 'en' | 'de'] ?? entry.labels.en) : id;
  };
  const kind = $derived(
    data.query.qualitative === undefined ? '' : data.query.qualitative ? 'true' : 'false',
  );
</script>

<svelte:head><title>{t('kpi.indicators.title')}</title></svelte:head>

<div class="flex flex-col gap-6">
  <Breadcrumb items={[{ label: t('nav.section.admin') }, { label: t('kpi.indicators.title') }]} />
  <div class="flex flex-wrap items-center justify-between gap-2">
    <h1 class="text-2xl font-bold">{t('kpi.indicators.title')}</h1>
    <a class="btn btn-primary" href={href('/kpi/indicators/new')}>{t('kpi.indicators.new')}</a>
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
        <label class="text-sm font-medium" for="indicators-search">
          {t('kpi.indicators.search')}
        </label>
        <input
          id="indicators-search"
          type="search"
          class="input input-bordered"
          maxlength={100}
          autocomplete="off"
          bind:value={search}
        />
      </div>
      <button type="submit" class="btn">{t('kpi.indicators.searchSubmit')}</button>
    </form>
    <div class="flex flex-col gap-1">
      <label class="text-sm font-medium" for="indicators-thematic">
        {t('kpi.indicators.filter.thematic')}
      </label>
      <select
        id="indicators-thematic"
        class="select select-bordered"
        value={data.query.thematic ?? ''}
        onchange={(event) => void go({ thematic: event.currentTarget.value || undefined })}
      >
        <option value="">{t('kpi.indicators.filter.all')}</option>
        {#each data.thematic as term (term.key)}
          <option value={term.key}>{labelOf(data.thematic, term.key, locale())}</option>
        {/each}
      </select>
    </div>
    <div class="flex flex-col gap-1">
      <label class="text-sm font-medium" for="indicators-unit">
        {t('kpi.indicators.filter.unit')}
      </label>
      <select
        id="indicators-unit"
        class="select select-bordered"
        value={data.query.unit ?? ''}
        onchange={(event) => void go({ unit: event.currentTarget.value || undefined })}
      >
        <option value="">{t('kpi.indicators.filter.all')}</option>
        {#each data.units as term (term.key)}
          <option value={term.key}>{labelOf(data.units, term.key, locale())}</option>
        {/each}
      </select>
    </div>
    <div class="flex flex-col gap-1">
      <label class="text-sm font-medium" for="indicators-kind">
        {t('kpi.indicators.filter.qualitative')}
      </label>
      <select
        id="indicators-kind"
        class="select select-bordered"
        value={kind}
        onchange={(event) =>
          void go({
            qualitative:
              event.currentTarget.value === '' ? undefined : event.currentTarget.value === 'true',
          })}
      >
        <option value="">{t('kpi.indicators.filter.all')}</option>
        <option value="true">{t('kpi.indicators.filter.qualitative.yes')}</option>
        <option value="false">{t('kpi.indicators.filter.qualitative.no')}</option>
      </select>
    </div>
  </div>

  {#snippet nameCell(row: Row)}
    <a class="link link-hover font-medium" href={href(`/kpi/indicators/${row.id}`)}>{row.name}</a>
  {/snippet}
  {#snippet thematicCell(row: Row)}
    <span class="badge badge-outline">{labelOf(data.thematic, row.thematic, locale())}</span>
  {/snippet}

  <DataTable
    caption={t('kpi.indicators.title')}
    columns={[
      { key: 'name', header: t('kpi.indicators.name'), rowHeader: true, cell: nameCell },
      { key: 'thematic', header: t('kpi.indicators.thematic'), cell: thematicCell },
      {
        key: 'valueType',
        header: t('kpi.indicators.valueType'),
        cell: valueTypeCell,
      },
      { key: 'unit', header: t('kpi.indicators.unit'), cell: unitCell },
      { key: 'setCount', header: t('kpi.indicators.sets') },
    ] satisfies Column<Row>[]}
    rows={data.indicators}
    rowKey={(row: Row) => row.id}
    page={data.query.page}
    pageSize={data.query.pageSize}
    total={data.total}
    onpage={(page: number) => void go({ page })}
    onpagesize={(pageSize: number) => void go({ pageSize })}
    empty={t('kpi.indicators.empty')}
  />
</div>

{#snippet valueTypeCell(row: Row)}
  {typeLabel(row.valueType)}
{/snippet}
{#snippet unitCell(row: Row)}
  {row.unit ? labelOf(data.units, row.unit, locale()) : ''}
{/snippet}
