<script lang="ts">
  // The sparkline of a KPI: an SVG built from numbers (`sparkline()`), never from a data string, with a text alternative that says how many
  // values there are and where it starts and ends. It needs no inline style, so the page's Content-Security-Policy is untouched.
  import { getShell } from '@scorpion/ui-kit';
  import { formatNumber } from './format.ts';
  import { sparkline, sparkSummary } from './spark.ts';

  let { name, values }: { name: string; values: (number | null)[] } = $props();
  const { t, locale } = getShell();

  const WIDTH = 96;
  const HEIGHT = 28;
  const drawn = $derived(sparkline(values, WIDTH, HEIGHT));
  const summary = $derived(sparkSummary(values));
  const alt = $derived(
    summary
      ? t('analytics.spark.alt', {
          name,
          count: summary.count,
          first: formatNumber(summary.first, locale()),
          last: formatNumber(summary.last, locale()),
        })
      : '',
  );
</script>

{#if summary}
  <svg
    role="img"
    aria-label={alt}
    viewBox="0 0 {WIDTH} {HEIGHT}"
    width={WIDTH}
    height={HEIGHT}
    class="text-primary shrink-0"
    focusable="false"
  >
    {#if drawn.d}
      <path
        d={drawn.d}
        fill="none"
        stroke="currentColor"
        stroke-width="1.5"
        stroke-linejoin="round"
        stroke-linecap="round"
      />
    {/if}
    {#each drawn.dots as [x, y] (`${x},${y}`)}
      <circle cx={x} cy={y} r="2" fill="currentColor" />
    {/each}
  </svg>
{/if}
