<script lang="ts">
  // The trends chart (FEATURES §3.8): one line per KPI of the service over the window, through the chart adapter (which follows the theme, light
  // and dark, for the lines, the text and the tooltip). Each KPI has three controls kept in the tile's configuration, so they survive a reload:
  // **cumulative** (the running total), **hide** and **second axis** (for a KPI of another magnitude). The table of the numbers is the text
  // alternative (the chart's own "Show the data as a table"), and the arrow keys read the chart by keyboard.
  import type { UiWidgetProps } from '@scorpion/contracts';
  import { Chart, getShell, type ChartSpec } from '@scorpion/ui-kit';
  import { MAX_SERIES_STATES } from '../service/widget-limits.ts';
  import { monthLabel } from './format.ts';
  import { hasState, toggleState, trendSeries, type SeriesState } from './settings.ts';
  import type { Body } from './types.ts';
  import WidgetFrame from './WidgetFrame.svelte';

  let { config, editing, setConfig }: UiWidgetProps = $props();
  const { t, locale } = getShell();
  const controlsId = $props.id();
  let full = $state(false);

  function toggle(indicatorId: string, state: SeriesState, on: boolean) {
    const next = toggleState(config, state, indicatorId, on);
    full = !next.ok;
    if (next.ok) setConfig(next.config);
  }

  function specOf(body: Body) {
    const lines = trendSeries(body.rows, config);
    const unitOf = new Map(body.rows.map((row) => [row.indicatorId, row.unit]));
    const shown = lines.filter((line) => !line.hidden);
    const spec: ChartSpec = {
      type: 'line',
      categories: body.months.map((month) => monthLabel(month, locale())),
      series: shown.map((line) => {
        const unit = body.unit(unitOf.get(line.indicatorId) ?? null);
        return {
          name: unit ? `${line.name} (${unit})` : line.name,
          values: line.values,
          secondary: line.secondary,
        };
      }),
    };
    return { lines, shown, spec };
  }
</script>

<WidgetFrame title={t('analytics.trends.title')} {config} {editing} {setConfig} units>
  {#snippet body(data: Body)}
    {@const { lines, shown, spec } = specOf(data)}
    <div class="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto">
      {#if lines.length === 0}
        <p class="text-sm" role="status">{t('analytics.trends.noNumbers')}</p>
      {:else if shown.length === 0}
        <p class="text-sm" role="status">{t('analytics.trends.allHidden')}</p>
      {:else}
        <div class="flex min-h-48 flex-1 flex-col">
          <Chart {spec} label={t('analytics.trends.chart')} size="fill" />
        </div>
      {/if}

      {#if lines.length > 0}
        <details class="text-sm">
          <summary class="cursor-pointer">{t('analytics.trends.controls')}</summary>
          <table class="table table-xs mt-2" id={controlsId}>
            <caption class="sr-only">{t('analytics.trends.controls.caption')}</caption>
            <thead>
              <tr>
                <th scope="col">{t('analytics.col.kpi')}</th>
                <th scope="col">{t('analytics.trends.show')}</th>
                <th scope="col">{t('analytics.trends.cumulative')}</th>
                <th scope="col">{t('analytics.trends.secondary')}</th>
              </tr>
            </thead>
            <tbody>
              {#each lines as line (line.indicatorId)}
                <tr>
                  <th scope="row" class="font-normal">{line.name}</th>
                  <td>
                    <input
                      type="checkbox"
                      class="checkbox checkbox-sm"
                      checked={!hasState(config, 'hidden', line.indicatorId)}
                      aria-label={t('analytics.trends.show.named', { name: line.name })}
                      onchange={(event) =>
                        toggle(line.indicatorId, 'hidden', !event.currentTarget.checked)}
                    />
                  </td>
                  <td>
                    <input
                      type="checkbox"
                      class="checkbox checkbox-sm"
                      checked={hasState(config, 'cumulative', line.indicatorId)}
                      aria-label={t('analytics.trends.cumulative.named', { name: line.name })}
                      onchange={(event) =>
                        toggle(line.indicatorId, 'cumulative', event.currentTarget.checked)}
                    />
                  </td>
                  <td>
                    <input
                      type="checkbox"
                      class="checkbox checkbox-sm"
                      checked={hasState(config, 'secondary', line.indicatorId)}
                      aria-label={t('analytics.trends.secondary.named', { name: line.name })}
                      onchange={(event) =>
                        toggle(line.indicatorId, 'secondary', event.currentTarget.checked)}
                    />
                  </td>
                </tr>
              {/each}
            </tbody>
          </table>
          <p class="text-base-content/70 mt-1" role="status">
            {full ? t('analytics.trends.full', { count: MAX_SERIES_STATES }) : ''}
          </p>
        </details>
      {/if}
    </div>
  {/snippet}
</WidgetFrame>
