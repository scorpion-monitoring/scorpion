<script lang="ts">
  // The "Export" menu of a widget (M11 sprint 5): CSV and XLSX of what the widget shows (its service, range and category). A choice is one request
  // through the typed client; the file is saved through a blob URL, as the import template download is, under the name the server gave. The
  // menu is a button with a list of buttons, closed by Escape and after a choice; progress and failure are said in a status line.
  import { getShell } from '@scorpion/ui-kit';
  import { fileNameOf, saveBlob } from './download.ts';

  let {
    service,
    range,
    category,
    slug,
  }: {
    service: string;
    range: string;
    category: string;
    /** The abbreviation of the service, for the name of the file when the server names none. */
    slug: string;
  } = $props();

  const { t, api } = getShell();
  const menuId = $props.id();
  // The formats the menu offers; the server's registry `analytics.exporter` decides what an id means.
  const FORMATS = [
    { id: 'csv', label: 'analytics.export.csv' },
    { id: 'xlsx', label: 'analytics.export.xlsx' },
  ] as const;

  let open = $state(false);
  let busy = $state(false);
  let failed = $state(false);
  let done = $state('');
  let trigger = $state<HTMLButtonElement>();

  function close(refocus: boolean) {
    open = false;
    if (refocus) trigger?.focus();
  }

  async function choose(format: (typeof FORMATS)[number]) {
    close(true);
    // One file at a time; the button stays focusable, so focus is never lost.
    if (busy) return;
    busy = true;
    failed = false;
    done = '';
    try {
      const { data, error, response } = await api.GET('/kpi/analytics/export', {
        params: { query: { service, range, category, format: format.id } },
        parseAs: 'blob',
      });
      if (!response.ok || error !== undefined || !data) throw new Error('export');
      const name = fileNameOf(
        response.headers.get('content-disposition'),
        `${slug}-kpis-${range}.${format.id}`,
      );
      saveBlob(data, name);
      done = t('analytics.export.done', { name });
    } catch {
      failed = true;
    } finally {
      busy = false;
    }
  }
</script>

<svelte:window
  onkeydown={(event: KeyboardEvent) => open && event.key === 'Escape' && close(true)}
/>

<div class="relative shrink-0">
  <button
    bind:this={trigger}
    type="button"
    class="btn btn-sm"
    aria-haspopup="true"
    aria-expanded={open}
    aria-controls={menuId}
    aria-busy={busy}
    onclick={() => (open = !open)}
  >
    {t('analytics.export.button')}
  </button>
  {#if open}
    <ul
      id={menuId}
      class="menu bg-base-100 border-base-300 absolute end-0 z-10 mt-1 w-40 rounded border p-1 shadow"
      aria-label={t('analytics.export.menu')}
    >
      {#each FORMATS as format (format.id)}
        <li>
          <button type="button" onclick={() => choose(format)}>{t(format.label)}</button>
        </li>
      {/each}
    </ul>
  {/if}
  <p class="sr-only" role="status">
    {busy ? t('analytics.export.busy') : failed ? '' : done}
  </p>
  {#if failed}
    <p class="text-error absolute end-0 mt-1 w-48 text-sm" role="alert">
      {t('analytics.export.failed')}
    </p>
  {/if}
</div>
