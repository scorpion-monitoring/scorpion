<script lang="ts">
  // The volatility bars (FEATURES §3.8): per KPI a bar, the value and the band **in words** (low, medium, high), banded by the thresholds of the
  // module's settings (the server decides the band; this widget only shows it). The explanation is a disclosure button, reachable by keyboard and
  // by touch, which a hover-only tooltip is not; it is also the widget's description in the menu that adds it.
  import type { UiWidgetProps } from '@scorpion/contracts';
  import { getShell } from '@scorpion/ui-kit';
  import { barFill, formatPercent } from './format.ts';
  import WidgetFrame from './WidgetFrame.svelte';

  let { config, editing, setConfig }: UiWidgetProps = $props();
  const { t, locale } = getShell();
  const explainId = $props.id();
  let explained = $state(false);

  const BANDS = ['low', 'medium', 'high'];
  const bandWord = (band: string | null) =>
    band !== null && BANDS.includes(band) ? t(`analytics.band.${band}`) : t('analytics.band.none');
  const tone = (band: string | null) =>
    band === 'low'
      ? 'progress-success'
      : band === 'medium'
        ? 'progress-warning'
        : band === 'high'
          ? 'progress-error'
          : '';
</script>

<WidgetFrame title={t('analytics.volatility.title')} {config} {editing} {setConfig}>
  {#snippet body({ rows })}
    <div>
      <button
        type="button"
        class="btn btn-ghost btn-xs"
        aria-expanded={explained}
        aria-controls={explainId}
        onclick={() => (explained = !explained)}
      >
        {t('analytics.volatility.whatIs')}
      </button>
      <p id={explainId} class="text-sm" hidden={!explained}>{t('analytics.volatility.about')}</p>
    </div>
    <!-- A scrolling region must take focus, or a keyboard cannot scroll it (axe: scrollable-region-focusable). -->
    <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
    <div
      class="min-h-0 flex-1 overflow-y-auto"
      role="region"
      aria-label={t('analytics.volatility.title')}
      tabindex="0"
    >
      <ul class="flex flex-col gap-3">
        {#each rows as row (row.indicatorId)}
          <li class="flex flex-col gap-1">
            <div class="flex items-baseline justify-between gap-2 text-sm">
              <span class="truncate font-medium">{row.name}</span>
              {#if row.volatility.value === null}
                <span>{t('analytics.na')}</span>
              {:else}
                <span>
                  {formatPercent(row.volatility.value, locale())} ·
                  <strong>{bandWord(row.volatility.band)}</strong>
                </span>
              {/if}
            </div>
            {#if row.volatility.value !== null}
              <progress
                class="progress {tone(row.volatility.band)} w-full"
                value={barFill(row.volatility.value)}
                max="1"
                aria-label={t('analytics.volatility.bar', {
                  name: row.name,
                  value: formatPercent(row.volatility.value, locale()),
                  band: bandWord(row.volatility.band),
                })}
              ></progress>
            {/if}
          </li>
        {/each}
      </ul>
    </div>
  {/snippet}
</WidgetFrame>
