<script lang="ts">
  // The impact page: choose a consortium and a year, read the tiles (how many services, how many are open source, how many in each stage) and the
  // yearly table of one headline KPI per service. The loader read the consortia on the server; this component reads the figures when a person
  // chooses: a consortium or the switch for unpublished services makes **two** reads (the tiles and the table), a year **one** (the table) and a page of
  // the table only the table's own. The address holds the choices (`?consortium=&year=&unpublished=1&page=`), so a link opens the same view. Every
  // state of a row says in words what to do and none is a blank cell; a state is never shown by colour alone.
  import { unwrap } from '@scorpion/contracts/client';
  import { onMount, untrack } from 'svelte';
  import { Alert, Breadcrumb, getShell, Icon, Pagination } from '@scorpion/ui-kit';
  import type { EvaluateData } from './loaders.ts';
  import { evaluateQueryString } from './query.ts';
  import { EVALUATE_PATH } from './routes.ts';
  import { labelOf } from './terms.ts';
  import type { Summary, TableAnswer, TableRow } from './types.ts';

  let { data }: { data: EvaluateData } = $props();
  const { t, href, api, locale, replaceUrl } = getShell();

  const SIZES = [25, 50, 100, 200] as const;
  const STATE_ICON: Record<TableRow['state'], string> = {
    ok: 'check',
    'no-data': 'info',
    'no-evaluation': 'settings',
    error: 'close',
  };

  // What the address named on arrival; the choices after that are this component's own state.
  const start = untrack(() => ({
    consortium: data.query.consortium ?? '',
    years: data.years,
    year:
      data.query.year !== undefined && data.years.includes(data.query.year)
        ? data.query.year
        : data.years[0]!,
    includeUnpublished: data.query.includeUnpublished,
    page: data.query.page,
  }));
  let consortium = $state(start.consortium);
  let years = $state(start.years);
  let year = $state(start.year);
  let includeUnpublished = $state(start.includeUnpublished);
  let page = $state(start.page);
  let pageSize = $state<number>(50);
  let summary = $state<Summary>();
  let table = $state<TableAnswer>();
  // What the figures on the screen are for: set when they arrive, so the tiles never carry the name of a consortium they are not about.
  let shown = $state<{ name: string; unpublished: boolean }>();
  let loading = $state(false);
  let failed = $state(false);
  let announcement = $state('');
  // A read that has been overtaken by a newer choice is dropped.
  let ticket = 0;

  const consortiumName = (id: string) => {
    const found = data.consortia.find((entry) => entry.id === id);
    return found ? (found.abbreviation ? `${found.name} (${found.abbreviation})` : found.name) : id;
  };
  const monthNames = $derived(
    Array.from({ length: 12 }, (_, index) =>
      new Intl.DateTimeFormat(locale(), { month: 'short', timeZone: 'UTC' }).format(
        new Date(Date.UTC(2000, index, 1)),
      ),
    ),
  );

  async function load(reads: 'both' | 'table') {
    const mine = ++ticket;
    const id = consortium;
    const flag = includeUnpublished ? 'true' : 'false';
    loading = true;
    failed = false;
    try {
      const [tiles, rows] = await Promise.all([
        reads === 'both'
          ? unwrap(
              api.GET('/kpi/impact/summary', {
                params: { query: { consortium: id, includeUnpublished: flag, locale: locale() } },
              }),
            )
          : Promise.resolve(summary),
        unwrap(
          api.GET('/kpi/impact/table', {
            params: {
              query: {
                consortium: id,
                year: String(year),
                includeUnpublished: flag,
                locale: locale(),
                page: String(page),
                pageSize: String(pageSize),
              },
            },
          }),
        ),
      ]);
      if (mine !== ticket) return;
      summary = tiles;
      table = rows;
      years = rows.years;
      shown = { name: consortiumName(id), unpublished: includeUnpublished };
      // Said once the table is there, so a screen reader hears the new table and not each step of the load.
      announcement = t('impact.table.live', {
        year: rows.year,
        consortium: shown.name,
        count: rows.metadata.totalCount,
      });
      replaceUrl(
        href(
          EVALUATE_PATH + evaluateQueryString({ consortium: id, year, includeUnpublished, page }),
        ),
      );
    } catch {
      if (mine === ticket) failed = true;
    } finally {
      if (mine === ticket) loading = false;
    }
  }

  function chooseConsortium(id: string) {
    ticket++;
    consortium = id;
    page = 0;
    summary = undefined;
    table = undefined;
    shown = undefined;
    announcement = '';
    failed = false;
    loading = false;
    replaceUrl(
      href(
        EVALUATE_PATH +
          evaluateQueryString({ consortium: id || undefined, year, includeUnpublished }),
      ),
    );
    if (id) void load('both');
  }
  function chooseYear(text: string) {
    year = Number(text);
    page = 0;
    void load('table');
  }
  function toggleUnpublished(checked: boolean) {
    includeUnpublished = checked;
    page = 0;
    void load('both');
  }
  function choosePage(next: number) {
    page = next;
    void load('table');
  }
  function choosePageSize(size: number) {
    pageSize = size;
    page = 0;
    void load('table');
  }

  // A link that opened the page on a consortium reads its figures at once.
  onMount(() => {
    if (consortium) void load('both');
  });

  const unitLabel = (unit: string) => labelOf(data.units, unit, locale());
  const stageLine = (line: Summary['stages'][number]) =>
    t(line.active ? 'impact.stage.line' : 'impact.stage.line.inactive', {
      label: line.label,
      count: line.count,
    });
  const stageText = $derived(
    summary
      ? [
          ...summary.stages.map(stageLine),
          ...summary.otherStages.map((line) =>
            t('impact.stage.line.other', { key: line.key, count: line.count }),
          ),
        ].join(', ')
      : '',
  );
</script>

<svelte:head><title>{t('impact.title')}</title></svelte:head>

<div class="flex flex-col gap-6">
  <Breadcrumb items={[{ label: t('impact.title') }]} />
  <h1 class="text-2xl font-bold">{t('impact.title')}</h1>
  <p>{t('impact.intro')}</p>
  <p>{t('impact.note.computed')}</p>

  {#if data.consortia.length === 0}
    <Alert kind="info">
      <strong class="block">{t('impact.consortium.none.title')}</strong>
      {t('impact.consortium.none.body')}
    </Alert>
  {:else}
    <form class="flex flex-wrap items-end gap-4" onsubmit={(event) => event.preventDefault()}>
      <label class="flex flex-col gap-1">
        <span class="font-semibold">{t('impact.consortium')}</span>
        <select
          class="select select-bordered"
          onchange={(event) => chooseConsortium(event.currentTarget.value)}
        >
          <option value="" selected={consortium === ''}>{t('impact.consortium.choose')}</option>
          {#each data.consortia as entry (entry.id)}
            <option value={entry.id} selected={entry.id === consortium}>
              {entry.abbreviation ? `${entry.name} (${entry.abbreviation})` : entry.name}
            </option>
          {/each}
        </select>
      </label>
      <label class="flex flex-col gap-1">
        <span class="font-semibold">{t('impact.year')}</span>
        <select
          class="select select-bordered"
          disabled={consortium === ''}
          onchange={(event) => chooseYear(event.currentTarget.value)}
        >
          {#each years as candidate (candidate)}
            <option value={candidate} selected={candidate === year}>{candidate}</option>
          {/each}
        </select>
      </label>
      <label class="flex items-center gap-2 pb-3">
        <input
          type="checkbox"
          class="checkbox"
          checked={includeUnpublished}
          disabled={consortium === ''}
          onchange={(event) => toggleUnpublished(event.currentTarget.checked)}
        />
        <span>{t('impact.unpublished')}</span>
      </label>
    </form>

    {#if consortium === ''}
      <p>{t('impact.choose')}</p>
    {/if}
  {/if}

  <!-- Said by a screen reader when a new table has arrived; the table itself is not a live region. -->
  <p class="sr-only" role="status" aria-live="polite">{announcement}</p>

  {#if loading && !summary}
    <p role="status">{t('impact.loading')}</p>
  {/if}
  {#if failed}
    <Alert kind="error">
      <span>{t('impact.failed')}</span>
      <button
        type="button"
        class="btn btn-sm ms-3"
        onclick={() => load(summary ? 'table' : 'both')}
      >
        {t('impact.retry')}
      </button>
    </Alert>
  {/if}

  {#if summary && shown}
    <section class="flex flex-col gap-4" aria-labelledby="impact-tiles-title">
      <h2 id="impact-tiles-title" class="text-xl font-semibold">
        {t('impact.tiles.label', { consortium: shown.name })}
      </h2>
      <p>{shown.unpublished ? t('impact.scope.all') : t('impact.scope.published')}</p>

      <ul class="grid gap-3 sm:grid-cols-2" aria-label={t('impact.total')}>
        <li class="rounded-box border border-base-300 p-4">
          <span class="block text-3xl font-bold">{summary.total}</span>
          <span class="block font-semibold">{t('impact.total')}</span>
          <span class="block text-sm">{t('impact.total.about')}</span>
        </li>
      </ul>

      <section class="flex flex-col gap-2" aria-labelledby="impact-licence-title">
        <h3 id="impact-licence-title" class="text-lg font-semibold">{t('impact.licence.title')}</h3>
        <p class="text-sm">{t('impact.licence.about')}</p>
        <ul class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" aria-labelledby="impact-licence-title">
          {#each [{ id: 'openSource', key: 'impact.licence.openSource', count: summary.openSource }, { id: 'other', key: 'impact.licence.other', count: summary.otherLicence }, { id: 'deprecated', key: 'impact.licence.deprecated', count: summary.licenceDeprecated }, { id: 'unknown', key: 'impact.licence.unknown', count: summary.licenceUnknown }] as tile (tile.id)}
            <li class="rounded-box border border-base-300 p-4" data-tile={`licence-${tile.id}`}>
              <span class="block text-3xl font-bold">{tile.count}</span>
              <span class="block font-semibold">{t(tile.key)}</span>
              <span class="block text-sm">{t(`${tile.key}.about`)}</span>
            </li>
          {/each}
        </ul>
      </section>

      <section class="flex flex-col gap-2" aria-labelledby="impact-stage-title">
        <h3 id="impact-stage-title" class="text-lg font-semibold">{t('impact.stage.title')}</h3>
        <p class="text-sm">{t('impact.stage.about')}</p>
        <ul class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" aria-labelledby="impact-stage-title">
          {#each summary.stages as line (line.key)}
            <li class="rounded-box border border-base-300 p-4" data-tile={`stage-${line.key}`}>
              <span class="block text-3xl font-bold">{line.count}</span>
              <span class="block font-semibold">{line.label}</span>
              {#if !line.active}
                <span class="block text-sm">{t('impact.stage.inactive')}</span>
              {/if}
            </li>
          {/each}
          {#each summary.otherStages as line (line.key)}
            <li
              class="rounded-box border border-base-300 p-4"
              data-tile={`stage-other-${line.key}`}
            >
              <span class="block text-3xl font-bold">{line.count}</span>
              <span class="block font-semibold">{line.key}</span>
              <span class="block text-sm">{t('impact.stage.other')}</span>
              <span class="block text-sm">{t('impact.stage.other.about')}</span>
            </li>
          {/each}
        </ul>
        <p class="text-sm">{t('impact.stage.text', { list: stageText })}</p>
      </section>
    </section>
  {/if}

  {#if table && shown}
    <section class="flex flex-col gap-3">
      <h2 id="impact-table-title" class="text-xl font-semibold">
        {t('impact.table.title', { year: table.year })}
      </h2>
      {#if loading}<p role="status" class="text-sm">{t('impact.loading')}</p>{/if}
      {#if table.result.length === 0}
        <p>{t('impact.table.empty')}</p>
      {:else}
        <!-- A scrollable region must be reachable with the keyboard. -->
        <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
        <div
          class="overflow-x-auto"
          role="region"
          aria-labelledby="impact-table-title"
          tabindex="0"
        >
          <table class="table table-sm" aria-busy={loading}>
            <caption class="sr-only">
              {t('impact.table.caption', { consortium: shown.name, year: table.year })}
            </caption>
            <thead>
              <tr>
                <th scope="col">{t('impact.col.service')}</th>
                <th scope="col">{t('impact.col.state')}</th>
                <th scope="col">{t('impact.col.headline')}</th>
                {#each monthNames as name (name)}
                  <th scope="col" class="text-end">{name}</th>
                {/each}
                <th scope="col">{t('impact.col.year')}</th>
              </tr>
            </thead>
            <tbody>
              {#each table.result as row (row.serviceId)}
                <tr data-service={row.slug}>
                  <th scope="row">
                    <a class="link" href={href(`/services/${row.slug}`)}>{row.name}</a>
                  </th>
                  <td>
                    <span
                      class="inline-flex items-center gap-1 font-semibold"
                      data-state={row.state}
                    >
                      <Icon name={STATE_ICON[row.state]} size={16} />
                      {t(`impact.state.${row.state}`)}
                    </span>
                    {#if row.reason !== 'ok'}
                      <span class="block text-sm">{t(`impact.reason.${row.reason}`)}</span>
                    {/if}
                  </td>
                  <td>
                    {#if row.headline}
                      <span class="block">{row.headline.name}</span>
                      {#if row.headline.unit}
                        <span class="block text-sm">
                          {t('impact.headline.unit', { unit: unitLabel(row.headline.unit) })}
                        </span>
                      {/if}
                    {:else}
                      {t('impact.headline.none')}
                    {/if}
                  </td>
                  {#each row.shown.months as figure, index (index)}
                    <td class="text-end tabular-nums">
                      {#if figure === null}
                        <span aria-hidden="true">–</span>
                        <span class="sr-only">{t('impact.noValue')}</span>
                      {:else}
                        {figure}
                      {/if}
                    </td>
                  {/each}
                  <td>
                    {#if row.shown.yearly === null}
                      <span aria-hidden="true">–</span>
                      <span class="sr-only">{t('impact.yearly.none')}</span>
                    {:else}
                      <span class="block font-semibold tabular-nums">{row.shown.yearly}</span>
                      <span class="block text-sm">
                        {t('impact.yearly.months', { count: row.monthsWithValue })}
                      </span>
                      {#if row.headline}<span class="block text-sm">{row.headline.label}</span>{/if}
                    {/if}
                  </td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
        <Pagination
          {page}
          {pageSize}
          total={table.metadata.totalCount}
          pageSizes={SIZES}
          onpage={choosePage}
          onpagesize={choosePageSize}
        />
      {/if}
    </section>
  {/if}
</div>
