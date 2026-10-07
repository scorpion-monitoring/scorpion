<script lang="ts" generics="Row">
  // A table for the list envelope of the API: pages from 0, a sort the server does (or, for a short list,
  // the table itself, stable by the row key), a state for loading, failing and being empty, and an actions
  // column. Semantics first: a real `<table>` with a caption, `scope`d headings and `aria-sort`, so a screen
  // reader can read it as a table. Up and Down move between the rows' buttons and links.
  import type { Snippet } from 'svelte';
  import Alert from './Alert.svelte';
  import { getShell } from './context.ts';
  import Pagination from './Pagination.svelte';
  import { ariaSort, nextSort, sortRows, type Column, type Sort } from './table.ts';

  let {
    columns,
    rows,
    rowKey,
    caption,
    sort,
    onsort,
    page,
    pageSize,
    total,
    pageSizes,
    onpage,
    onpagesize,
    loading = false,
    error,
    onretry,
    empty,
    actions,
    actionsLabel,
  }: {
    columns: readonly Column<Row>[];
    rows: readonly Row[];
    rowKey: (row: Row) => string;
    /** What the table is, for a screen reader (and for the page's own heading if it wants to show it). */
    caption: string;
    /** The current sort. With `onsort` the server sorts; without it the table sorts `rows` itself. */
    sort?: Sort;
    onsort?: (sort: Sort) => void;
    /** Server paging: the current page (from 0), the page size and the total number of rows. */
    page?: number;
    pageSize?: number;
    total?: number;
    pageSizes?: readonly number[];
    onpage?: (page: number) => void;
    onpagesize?: (pageSize: number) => void;
    loading?: boolean;
    /** A failure to show instead of the rows. */
    error?: string;
    onretry?: () => void;
    /** The text of an empty table. */
    empty?: string;
    /** The buttons of one row, shown in the last column. */
    actions?: Snippet<[Row]>;
    actionsLabel?: string;
  } = $props();
  const { t } = getShell();

  // A table with no `onsort` keeps its own sort.
  let local = $state<Sort>();
  const active = $derived(onsort ? sort : (local ?? sort));
  const shown = $derived.by(() => {
    if (onsort || !active) return [...rows];
    const column = columns.find((candidate) => candidate.key === active.key);
    return sortRows(rows, active, (row) => column?.value?.(row), rowKey);
  });

  function sortBy(key: string) {
    const next = nextSort(active, key);
    if (onsort) onsort(next);
    else local = next;
  }

  const span = $derived(columns.length + (actions ? 1 : 0));
  const paged = $derived(
    page !== undefined && pageSize !== undefined && total !== undefined && onpage !== undefined,
  );

  const FOCUSABLE = 'a[href], button:not([disabled])';
  /** Up and Down move to the same control in the next or the previous row; nothing else changes. */
  function moveBetweenRows(event: KeyboardEvent) {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    const target = event.target;
    if (!(target instanceof HTMLElement) || !target.matches(FOCUSABLE)) return;
    const row = target.closest('tr');
    if (!row) return;
    const position = [...row.querySelectorAll<HTMLElement>(FOCUSABLE)].indexOf(target);
    const neighbour =
      event.key === 'ArrowDown' ? row.nextElementSibling : row.previousElementSibling;
    const controls = neighbour?.querySelectorAll<HTMLElement>(FOCUSABLE);
    if (!controls || controls.length === 0) return;
    event.preventDefault();
    controls[Math.min(position, controls.length - 1)]?.focus();
  }
</script>

<div class="flex flex-col gap-3">
  {#if error}
    <Alert kind="error">
      <span>{error}</span>
      {#if onretry}
        <button type="button" class="btn btn-sm ms-3" onclick={onretry}>
          {t('kit.table.retry')}
        </button>
      {/if}
    </Alert>
  {/if}
  {#if loading}<p role="status" class="text-sm">{t('kit.table.loading')}</p>{/if}
  <div class="overflow-x-auto">
    <table class="table" aria-busy={loading}>
      <caption class="sr-only">{caption}</caption>
      <thead class="text-base-content">
        <tr>
          {#each columns as column (column.key)}
            <th
              scope="col"
              class={column.class}
              aria-sort={column.sortable ? ariaSort(active, column.key) : undefined}
            >
              {#if column.sortable}
                <button
                  type="button"
                  class="inline-flex items-center gap-1 font-semibold"
                  onclick={() => sortBy(column.key)}
                >
                  {column.header}
                  <span aria-hidden="true" class="text-xs opacity-70">
                    {active?.key === column.key ? (active.direction === 'asc' ? '▲' : '▼') : '↕'}
                  </span>
                </button>
              {:else}
                {column.header}
              {/if}
            </th>
          {/each}
          {#if actions}
            <th scope="col"
              ><span class="sr-only">{actionsLabel ?? t('kit.table.actions')}</span></th
            >
          {/if}
        </tr>
      </thead>
      <!-- Arrow keys on a control move between rows; the handler is on the body so every row shares it. -->
      <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
      <tbody onkeydown={moveBetweenRows}>
        {#if shown.length === 0 && !error && !loading}
          <tr>
            <td colspan={span}>{empty ?? t('kit.table.empty')}</td>
          </tr>
        {/if}
        {#each shown as row (rowKey(row))}
          <tr>
            {#each columns as column (column.key)}
              {#if column.rowHeader}
                <th scope="row" class={column.class}>
                  {#if column.cell}{@render column.cell(row)}{:else}{column.value?.(row) ?? ''}{/if}
                </th>
              {:else}
                <td class={column.class}>
                  {#if column.cell}{@render column.cell(row)}{:else}{column.value?.(row) ?? ''}{/if}
                </td>
              {/if}
            {/each}
            {#if actions}
              <td class="whitespace-nowrap">{@render actions(row)}</td>
            {/if}
          </tr>
        {/each}
      </tbody>
    </table>
  </div>
  {#if paged}
    <Pagination
      page={page!}
      pageSize={pageSize!}
      total={total!}
      {pageSizes}
      onpage={onpage!}
      {onpagesize}
    />
  {/if}
</div>
