<script lang="ts">
  // Page buttons for a list with server-side paging. Pages are counted from 0 as in the API; people see
  // them from 1. The range ("21–40 of 134") is a polite live region, so a screen reader hears the page
  // change after a button was pressed.
  import { getShell } from './context.ts';
  import { pageCount, pageWindow, rowRange } from './table.ts';

  let {
    page,
    pageSize,
    total,
    pageSizes = [10, 20, 50, 100],
    onpage,
    onpagesize,
  }: {
    page: number;
    pageSize: number;
    total: number;
    pageSizes?: readonly number[];
    onpage: (page: number) => void;
    onpagesize?: (pageSize: number) => void;
  } = $props();
  const { t } = getShell();

  const pages = $derived(pageCount(total, pageSize));
  // A gap has no page number.
  const buttons = $derived(
    pageWindow(page, pages).map((entry) => ({ number: entry === 'gap' ? undefined : entry })),
  );
  const range = $derived(rowRange(page, pageSize, total));
  const sizeId = $props.id();
</script>

<nav
  aria-label={t('kit.pagination.label')}
  class="flex flex-wrap items-center justify-between gap-3"
>
  <p class="text-sm" role="status" aria-live="polite">
    {t('kit.pagination.range', { from: range.from, to: range.to, total })}
  </p>
  <div class="flex flex-wrap items-center gap-3">
    {#if onpagesize}
      <div class="flex items-center gap-2 text-sm">
        <label for={sizeId}>{t('kit.pagination.pageSize')}</label>
        <select
          id={sizeId}
          class="select select-sm"
          value={String(pageSize)}
          onchange={(event) => onpagesize(Number(event.currentTarget.value))}
        >
          {#each pageSizes as size (size)}
            <option value={String(size)}>{size}</option>
          {/each}
        </select>
      </div>
    {/if}
    <div class="join">
      <button
        type="button"
        class="join-item btn btn-sm"
        disabled={page <= 0}
        onclick={() => onpage(page - 1)}
      >
        {t('kit.pagination.previous')}
      </button>
      {#each buttons as button, index (index)}
        {#if button.number === undefined}
          <span class="join-item btn btn-sm btn-disabled" aria-hidden="true">…</span>
        {:else}
          <button
            type="button"
            class="join-item btn btn-sm"
            class:btn-active={button.number === page}
            aria-current={button.number === page ? 'page' : undefined}
            aria-label={t('kit.pagination.page', { page: button.number + 1 })}
            onclick={() => onpage(button.number!)}
          >
            {button.number + 1}
          </button>
        {/if}
      {/each}
      <button
        type="button"
        class="join-item btn btn-sm"
        disabled={page >= pages - 1}
        onclick={() => onpage(page + 1)}
      >
        {t('kit.pagination.next')}
      </button>
    </div>
  </div>
</nav>
