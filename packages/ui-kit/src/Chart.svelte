<script lang="ts">
  // A chart with its text alternative. The picture is drawn by an adapter (ECharts by default), loaded when
  // the first chart mounts, so a page with no chart never downloads it. It follows the theme (light and
  // dark, and a change of either) and the size of its box. The same numbers are always available as a table
  // behind the "Show data as a table" button; the picture itself is one labelled image for a screen reader.
  import { onMount } from 'svelte';
  import { getShell } from './context.ts';
  import {
    chartProblems,
    createChartController,
    tableOf,
    themeFromElement,
    type ChartAdapter,
    type ChartController,
    type ChartSpec,
  } from './chart.ts';

  let {
    spec,
    label,
    adapter,
    size = 'md',
  }: {
    spec: ChartSpec;
    /** What the chart shows, in a few words: its name for a screen reader and the caption of its table. */
    label: string;
    /** Another adapter than ECharts (a test uses a stub). */
    adapter?: ChartAdapter;
    size?: 'sm' | 'md' | 'lg';
  } = $props();
  const { t, locale } = getShell();

  let element = $state<HTMLElement>();
  let showTable = $state(false);
  let failed = $state(false);
  const tableId = $props.id();
  const problems = $derived(chartProblems(spec));
  const table = $derived(tableOf(spec, t('kit.chart.category'), locale()));
  const height = { sm: 'h-56', md: 'h-80', lg: 'h-96' } as const;

  let controller: ChartController | undefined;
  let theme = $state<ReturnType<typeof themeFromElement>>();

  onMount(() => {
    const target = element!;
    const readTheme = () => (theme = themeFromElement(document.documentElement));
    readTheme();
    if (problems.length > 0) return;
    let stopped = false;
    void (async () => {
      const chosen = adapter ?? (await import('./chart-echarts.ts')).echartsAdapter;
      if (stopped) return;
      controller = createChartController(
        chosen,
        target,
        { spec, theme: theme! },
        () => (failed = true),
      );
    })();

    // The theme changes with `data-theme` on the page, and with the system's colour scheme.
    const watcher = new MutationObserver(readTheme);
    watcher.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme'],
    });
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    media.addEventListener('change', readTheme);
    const resizer = new ResizeObserver(() => controller?.resize());
    resizer.observe(target);
    return () => {
      stopped = true;
      watcher.disconnect();
      media.removeEventListener('change', readTheme);
      resizer.disconnect();
      controller?.destroy();
    };
  });

  $effect(() => {
    if (theme && problems.length === 0) controller?.update(spec, theme);
  });
</script>

<figure class="flex flex-col gap-2">
  {#if problems.length > 0}
    <p role="alert" class="text-error">{t('kit.chart.invalid')}</p>
  {:else}
    <div
      bind:this={element}
      role="img"
      aria-label={label}
      class="w-full {height[size]}"
      class:hidden={failed}
    ></div>
    {#if failed}<p role="alert" class="text-error">{t('kit.chart.failed')}</p>{/if}
  {/if}
  <div class="flex items-center gap-3">
    <button
      type="button"
      class="btn btn-ghost btn-sm"
      aria-expanded={showTable}
      aria-controls={tableId}
      onclick={() => (showTable = !showTable)}
    >
      {showTable ? t('kit.chart.hideTable') : t('kit.chart.showTable')}
    </button>
  </div>
  <div id={tableId} hidden={!showTable} class="overflow-x-auto">
    <table class="table table-sm">
      <caption class="sr-only">{label}</caption>
      <thead class="text-base-content">
        <tr>
          {#each table.headers as header (header)}<th scope="col">{header}</th>{/each}
        </tr>
      </thead>
      <tbody>
        {#each table.rows as row, rowIndex (rowIndex)}
          <tr>
            {#each row as cell, index (index)}
              {#if index === 0}<th scope="row">{cell}</th>{:else}<td>{cell}</td>{/if}
            {/each}
          </tr>
        {/each}
      </tbody>
    </table>
  </div>
</figure>
