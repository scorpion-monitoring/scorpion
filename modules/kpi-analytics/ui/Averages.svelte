<script lang="ts">
  // The averages (FEATURES §3.8): a compact list of the average of each KPI over the window. A KPI whose average is not defined (a text, or no
  // value) says "n/a", never zero.
  import type { UiWidgetProps } from '@scorpion/contracts';
  import { getShell } from '@scorpion/ui-kit';
  import { formatNumber } from './format.ts';
  import WidgetFrame from './WidgetFrame.svelte';

  let { config, editing, setConfig }: UiWidgetProps = $props();
  const { t, locale } = getShell();
</script>

<WidgetFrame title={t('analytics.averages.title')} {config} {editing} {setConfig} units>
  {#snippet body({ rows, unit })}
    <!-- A scrolling region must take focus, or a keyboard cannot scroll it (axe: scrollable-region-focusable). -->
    <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
    <div
      class="min-h-0 flex-1 overflow-y-auto"
      role="region"
      aria-label={t('analytics.averages.title')}
      tabindex="0"
    >
      <table class="table table-sm">
        <caption class="sr-only">{t('analytics.averages.caption')}</caption>
        <thead>
          <tr>
            <th scope="col">{t('analytics.col.kpi')}</th>
            <th scope="col" class="text-end">{t('analytics.col.average')}</th>
          </tr>
        </thead>
        <tbody>
          {#each rows as row (row.indicatorId)}
            <tr>
              <th scope="row" class="font-normal">{row.name}</th>
              <td class="text-end">
                {#if row.average === null}
                  {t('analytics.na')}
                {:else}
                  {formatNumber(row.average, locale())}
                  {#if unit(row.unit)}<span class="text-base-content/70">{unit(row.unit)}</span
                    >{/if}
                {/if}
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  {/snippet}
</WidgetFrame>
