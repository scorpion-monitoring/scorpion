<script lang="ts">
  // The KPI cards (FEATURES §3.8): per KPI of the service, the latest value with its unit, the change over the window as an arrow **and in words**
  // (colour is never the only signal), and a sparkline with a text alternative. A text KPI shows its text and no change. The list scrolls inside
  // the tile, and the number of KPIs is said in a status line.
  import type { UiWidgetProps } from '@scorpion/contracts';
  import { getShell } from '@scorpion/ui-kit';
  import { changeView, formatLatest } from './format.ts';
  import Sparkline from './Sparkline.svelte';
  import type { Body } from './types.ts';
  import WidgetFrame from './WidgetFrame.svelte';

  let { config, editing, setConfig }: UiWidgetProps = $props();
  const { t, locale } = getShell();
  const direction = (kind: string) =>
    kind === 'up'
      ? t('analytics.change.up')
      : kind === 'down'
        ? t('analytics.change.down')
        : kind === 'flat'
          ? t('analytics.change.flat')
          : t('analytics.change.none');
</script>

<WidgetFrame title={t('analytics.cards.title')} {config} {editing} {setConfig} units>
  {#snippet body({ rows, unit }: Body)}
    <p class="text-base-content/70 text-sm" role="status">
      {t('analytics.cards.count', { count: rows.length })}
    </p>
    <!-- A scrolling list is reachable by keyboard: it is a labelled, focusable region. -->
    <!-- A scrolling region must take focus, or a keyboard cannot scroll it (axe: scrollable-region-focusable). -->
    <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
    <div
      class="min-h-0 flex-1 overflow-y-auto"
      role="region"
      aria-label={t('analytics.cards.title')}
      tabindex="0"
    >
      <ul class="flex flex-col gap-2">
        {#each rows as row (row.indicatorId)}
          {@const change = changeView(row.change, locale())}
          <li class="border-base-300 flex items-center justify-between gap-3 rounded border p-2">
            <div class="min-w-0">
              <h3 class="truncate text-sm font-medium">{row.name}</h3>
              {#if row.latest}
                <p class="text-xl font-semibold">
                  {formatLatest(row.latest, locale())}
                  {#if unit(row.unit)}<span class="text-base-content/70 text-sm font-normal"
                      >{unit(row.unit)}</span
                    >{/if}
                </p>
                {#if row.latest.value !== null}
                  <p class="text-sm">
                    {#if change.direction === 'none'}
                      {direction('none')}
                    {:else}
                      <span aria-hidden="true">{change.arrow}</span>
                      {direction(change.direction)}
                      {#if change.direction !== 'flat'}{change.amount}{/if}
                    {/if}
                  </p>
                {/if}
              {:else}
                <p class="text-base-content/70 text-sm">{t('analytics.cards.noValue')}</p>
              {/if}
            </div>
            <Sparkline name={row.name} values={row.points.map((point) => point.value)} />
          </li>
        {/each}
      </ul>
    </div>
  {/snippet}
</WidgetFrame>
