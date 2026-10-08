<script lang="ts">
  // Administration, logs: the audit trail with the filters of `GET /audit`, newest first. The first page comes
  // from the loader and "Load more" appends the next one (the API pages by offset, so an entry that arrives
  // meanwhile can shift a page: rows are kept once per id). The user column shows the name the account has
  // now; an account that was purged leaves only its id in the trail, which the page says. The CSV export is
  // a plain download of the same filters and is an entry of the trail itself.
  import {
    Alert,
    Breadcrumb,
    DataTable,
    failureMessage,
    failureOf,
    getShell,
    Time,
    type Column,
  } from '@scorpion/ui-kit';
  import { unwrap } from '@scorpion/contracts/client';
  import type { LogEntry, LogsData } from './loaders.ts';
  import {
    isFiltered,
    LOG_METHODS,
    LOG_OUTCOMES,
    LOG_PAGE_SIZE,
    LOG_SOURCES,
    logsApiQuery,
    logsQueryString,
    validDay,
    type LogsQuery,
  } from './query.ts';

  let { data }: { data: LogsData } = $props();
  const { t, href, goto, api } = getShell();

  const path = '/admin/logs';

  // The form starts from the address and goes back to it when the address changes.
  let draft = $derived(blank(data.query));
  const set = (key: keyof LogsQuery, value: string) => (draft = { ...draft, [key]: value });
  function blank(query?: LogsQuery): Record<keyof LogsQuery, string> {
    return {
      method: query?.method ?? '',
      user: query?.user ?? '',
      endpoint: query?.endpoint ?? '',
      action: query?.action ?? '',
      outcome: query?.outcome ?? '',
      source: query?.source ?? '',
      from: query?.from ?? '',
      to: query?.to ?? '',
    };
  }

  const dayProblem = $derived(
    (draft.from !== '' && !validDay(draft.from)) || (draft.to !== '' && !validDay(draft.to)),
  );
  const rangeProblem = $derived(
    !dayProblem && draft.from !== '' && draft.to !== '' && draft.from > draft.to,
  );

  function apply(event: SubmitEvent) {
    event.preventDefault();
    if (dayProblem || rangeProblem) return;
    const text = (value: string) => value.trim() || undefined;
    const query = {
      method: LOG_METHODS.find((m) => m === draft.method),
      user: text(draft.user),
      endpoint: text(draft.endpoint),
      action: text(draft.action),
      outcome: LOG_OUTCOMES.find((o) => o === draft.outcome),
      source: LOG_SOURCES.find((s) => s === draft.source),
      from: validDay(draft.from),
      to: validDay(draft.to),
    } satisfies LogsQuery;
    void goto(href(path) + logsQueryString(query));
  }

  // "Load more": the rows after the first page, tied to the data they were loaded for.
  let more = $state<{ base: LogsData; rows: LogEntry[]; next: number }>();
  let loading = $state(false);
  let failed = $state<string>();

  const rows = $derived.by(() => {
    const extra = more?.base === data ? more.rows : [];
    const seen: Record<string, true> = {};
    return [...data.entries, ...extra].filter((row) => {
      if (seen[row.id]) return false;
      seen[row.id] = true;
      return true;
    });
  });
  const hasMore = $derived(rows.length < data.total);

  async function loadMore() {
    loading = true;
    failed = undefined;
    const current = more?.base === data ? more : { base: data, rows: [], next: 1 };
    try {
      const answer = await unwrap(
        api.GET('/audit', {
          params: {
            query: {
              ...logsApiQuery(data.query),
              page: String(current.next),
              pageSize: String(LOG_PAGE_SIZE),
            },
          },
        }),
      );
      more = {
        base: data,
        rows: [...current.rows, ...answer.result],
        next: current.next + 1,
      };
    } catch (error) {
      failed = failureMessage(failureOf(error), t);
    } finally {
      loading = false;
    }
  }

  const exportAddress = $derived(
    href('/api/internal/audit/export.csv') +
      (() => {
        const query = new URLSearchParams(logsApiQuery(data.query)).toString();
        return query ? `?${query}` : '';
      })(),
  );
</script>

<svelte:head><title>{t('admin.logs.title')}</title></svelte:head>

<div class="flex flex-col gap-6">
  <Breadcrumb items={[{ label: t('nav.section.admin') }, { label: t('admin.logs.title') }]} />
  <h1 class="text-2xl font-bold">{t('admin.logs.title')}</h1>
  <p>{t('admin.logs.lead')}</p>

  <form
    class="flex flex-col gap-4"
    role="search"
    aria-label={t('admin.logs.filters')}
    onsubmit={apply}
  >
    <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <div class="flex flex-col gap-1">
        <label class="text-sm font-medium" for="logs-user">{t('admin.logs.filter.user')}</label>
        <input
          id="logs-user"
          class="input input-bordered"
          maxlength={200}
          autocomplete="off"
          value={draft.user}
          oninput={(event) => set('user', event.currentTarget.value)}
        />
      </div>
      <div class="flex flex-col gap-1">
        <label class="text-sm font-medium" for="logs-endpoint"
          >{t('admin.logs.filter.endpoint')}</label
        >
        <input
          id="logs-endpoint"
          class="input input-bordered"
          maxlength={500}
          autocomplete="off"
          value={draft.endpoint}
          oninput={(event) => set('endpoint', event.currentTarget.value)}
        />
      </div>
      <div class="flex flex-col gap-1">
        <label class="text-sm font-medium" for="logs-action">{t('admin.logs.filter.action')}</label>
        <input
          id="logs-action"
          class="input input-bordered"
          maxlength={200}
          autocomplete="off"
          value={draft.action}
          oninput={(event) => set('action', event.currentTarget.value)}
        />
      </div>
      <div class="flex flex-col gap-1">
        <label class="text-sm font-medium" for="logs-method">{t('admin.logs.filter.method')}</label>
        <select
          id="logs-method"
          class="select select-bordered"
          value={draft.method}
          onchange={(event) => set('method', event.currentTarget.value)}
        >
          <option value="">{t('admin.logs.any')}</option>
          {#each LOG_METHODS as method (method)}<option value={method}>{method}</option>{/each}
        </select>
      </div>
      <div class="flex flex-col gap-1">
        <label class="text-sm font-medium" for="logs-outcome"
          >{t('admin.logs.filter.outcome')}</label
        >
        <select
          id="logs-outcome"
          class="select select-bordered"
          value={draft.outcome}
          onchange={(event) => set('outcome', event.currentTarget.value)}
        >
          <option value="">{t('admin.logs.any')}</option>
          {#each LOG_OUTCOMES as outcome (outcome)}
            <option value={outcome}>{t(`admin.logs.outcome.${outcome}`)}</option>
          {/each}
        </select>
      </div>
      <div class="flex flex-col gap-1">
        <label class="text-sm font-medium" for="logs-source">{t('admin.logs.filter.source')}</label>
        <select
          id="logs-source"
          class="select select-bordered"
          value={draft.source}
          onchange={(event) => set('source', event.currentTarget.value)}
        >
          <option value="">{t('admin.logs.any')}</option>
          {#each LOG_SOURCES as source (source)}
            <option value={source}>{t(`admin.logs.source.${source}`)}</option>
          {/each}
        </select>
      </div>
      <div class="flex flex-col gap-1">
        <label class="text-sm font-medium" for="logs-from">{t('admin.logs.filter.from')}</label>
        <input
          id="logs-from"
          type="date"
          class="input input-bordered"
          value={draft.from}
          oninput={(event) => set('from', event.currentTarget.value)}
        />
      </div>
      <div class="flex flex-col gap-1">
        <label class="text-sm font-medium" for="logs-to">{t('admin.logs.filter.to')}</label>
        <input
          id="logs-to"
          type="date"
          class="input input-bordered"
          value={draft.to}
          oninput={(event) => set('to', event.currentTarget.value)}
        />
      </div>
    </div>
    <p class="text-sm opacity-80">{t('admin.logs.filter.hint')}</p>
    {#if rangeProblem}<Alert kind="error">{t('admin.logs.filter.range')}</Alert>{/if}
    <div class="flex flex-wrap gap-2">
      <button type="submit" class="btn btn-primary" disabled={dayProblem || rangeProblem}>
        {t('admin.logs.filter.apply')}
      </button>
      {#if isFiltered(data.query)}
        <a class="btn" href={href(path)}>{t('admin.logs.filter.reset')}</a>
      {/if}
    </div>
  </form>

  <div class="flex flex-wrap items-center gap-4">
    <p role="status" class="font-medium">
      {t('admin.logs.shown', { shown: rows.length, total: data.total })}
    </p>
    <div class="ms-auto flex flex-col items-end gap-1">
      <a class="btn btn-sm" href={exportAddress} download>{t('admin.logs.export')}</a>
      <span class="text-sm opacity-80">{t('admin.logs.export.note')}</span>
    </div>
  </div>

  {#if failed}<Alert kind="error">{failed}</Alert>{/if}

  {#snippet timeCell(row: LogEntry)}
    <a class="link link-hover" href={href(`/admin/logs/${row.id}`)}><Time iso={row.occurredAt} /></a
    >
  {/snippet}
  {#snippet userCell(row: LogEntry)}
    {#if row.userId && row.userName}
      <a class="link link-hover font-medium" href={href(`/admin/users/${row.userId}`)}
        >{row.userName}</a
      >
    {:else if row.userId}
      <span>{t('admin.logs.deletedAccount')}</span>
      <span class="ms-1 font-mono text-xs opacity-80">{row.userId.slice(0, 8)}</span>
    {:else}
      <span class="opacity-80">{t(`admin.logs.actor.${row.actorKind}`)}</span>
    {/if}
    {#if row.actorKind === 'token'}<span class="badge badge-ghost ms-1"
        >{t('admin.logs.viaToken')}</span
      >{/if}
  {/snippet}
  {#snippet whatCell(row: LogEntry)}
    <span class="font-mono text-sm">{row.method ?? ''} {row.path ?? row.action}</span>
    {#if row.method}<span class="block text-sm opacity-80">{row.action}</span>{/if}
  {/snippet}
  {#snippet outcomeCell(row: LogEntry)}
    <span
      class="badge"
      class:badge-success={row.outcome === 'ok'}
      class:badge-warning={row.outcome === 'denied'}
      class:badge-error={row.outcome === 'error'}
    >
      {t(`admin.logs.outcome.${row.outcome}`)}{row.status ? ` ${row.status}` : ''}
    </span>
  {/snippet}

  <DataTable
    caption={t('admin.logs.title')}
    columns={[
      { key: 'occurredAt', header: t('admin.logs.col.time'), rowHeader: true, cell: timeCell },
      { key: 'user', header: t('admin.logs.col.user'), cell: userCell },
      { key: 'what', header: t('admin.logs.col.what'), cell: whatCell },
      { key: 'outcome', header: t('admin.logs.col.outcome'), cell: outcomeCell },
      {
        key: 'source',
        header: t('admin.logs.col.source'),
        value: (row: LogEntry) => t(`admin.logs.source.${row.source}`),
      },
    ] satisfies Column<LogEntry>[]}
    {rows}
    rowKey={(row: LogEntry) => row.id}
    {loading}
    empty={t('admin.logs.empty')}
  />

  {#if hasMore}
    <div>
      <button type="button" class="btn" disabled={loading} onclick={loadMore}>
        {t(loading ? 'admin.logs.loading' : 'admin.logs.more')}
      </button>
    </div>
  {/if}
</div>
