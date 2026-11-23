// The chart adapter (architecture.md: "Apache ECharts behind a chart adapter"). Pages describe a chart as
// data (`ChartSpec`); an adapter draws it. Nothing outside `chart-echarts.ts` knows ECharts, so another
// library can replace it, and a page without a chart never loads it (the adapter is imported when the first
// chart mounts). A chart is not accessible by itself, so every one has a text alternative: the same numbers
// as a table (`tableOf`).
export type ChartType = 'line' | 'bar' | 'radar';

export interface ChartSeries {
  name: string;
  /** One value per category; `null` is a gap. */
  values: readonly (number | null)[];
  /** Draw the series against a second y axis on the right (line and bar charts), for a series of another magnitude. */
  secondary?: boolean;
  /**
   * The series' place in the palette (its colour, marker and dash). The colour follows the thing a series stands for, not its position in
   * the chart: a caller that can hide series gives each its slot among all of them, so hiding one never repaints the others. Default: its index.
   */
  slot?: number;
}

export interface ChartSpec {
  type: ChartType;
  /** The categories: the x axis of a line or bar chart, the spokes of a radar chart. */
  categories: readonly string[];
  series: readonly ChartSeries[];
  /** What a value is measured in, shown in the tooltip and the table (`%`, `services`). */
  unit?: string;
  /** The outer ring of a radar chart. Without it, the largest value, rounded up. */
  max?: number;
}

export interface ChartTheme {
  colorScheme: 'light' | 'dark';
  /** Series colours in their fixed order, as `#rrggbb`/`rgb()` strings the library can parse. */
  palette: readonly string[];
  /** Text, axes and the lines of the grid. */
  text: string;
  grid: string;
  background: string;
  /** The person asked for less motion: draw without animation. */
  reducedMotion: boolean;
}

export interface ChartHandle {
  /** Draws a new spec, or the same one in a new theme. */
  update(spec: ChartSpec, theme: ChartTheme): void;
  resize(): void;
  /** Shows the tooltip of one category (a person reading by keyboard), or hides it with `null`. A library without tooltips may leave it out. */
  showTip?(index: number | null): void;
  /** The chart as a standalone SVG document (for an export); a library that cannot say leaves it out. */
  toSvg?(): string | undefined;
  dispose(): void;
}

export interface ChartAdapter {
  mount(element: HTMLElement, spec: ChartSpec, theme: ChartTheme): Promise<ChartHandle>;
}

/** What is wrong with a spec, in words for a developer; empty when it can be drawn. */
export function chartProblems(spec: ChartSpec): string[] {
  const problems: string[] = [];
  if (spec.categories.length === 0) problems.push('a chart needs at least one category');
  if (spec.series.length === 0) problems.push('a chart needs at least one series');
  for (const series of spec.series) {
    if (series.values.length !== spec.categories.length) {
      problems.push(
        `series "${series.name}" has ${series.values.length} values for ${spec.categories.length} categories`,
      );
    }
    if (series.values.some((value) => value !== null && !Number.isFinite(value))) {
      problems.push(`series "${series.name}" has a value that is not a finite number`);
    }
  }
  if (spec.type === 'radar' && spec.categories.length < 3) {
    problems.push('a radar chart needs at least three categories');
  }
  return problems;
}

const formatter = (locale?: string) => new Intl.NumberFormat(locale, { maximumFractionDigits: 2 });

/** The same numbers as text, for the table that stands in for the picture: one row per category. */
export function tableOf(
  spec: ChartSpec,
  categoryHeader: string,
  locale?: string,
): { headers: string[]; rows: string[][] } {
  const numbers = formatter(locale);
  const format = (value: number) => numbers.format(value);
  const unit = spec.unit ? ` ${spec.unit}` : '';
  return {
    headers: [categoryHeader, ...spec.series.map((series) => series.name)],
    rows: spec.categories.map((category, index) => [
      category,
      ...spec.series.map((series) => {
        const value = series.values[index];
        return value === null || value === undefined ? '–' : `${format(value)}${unit}`;
      }),
    ]),
  };
}

export type TipKey = 'ArrowLeft' | 'ArrowRight' | 'Home' | 'End' | 'Escape';

/**
 * Where reading by keyboard goes next: the arrow keys step through the categories (without wrapping), Home and End jump to the ends, Escape
 * stops (`null`). The first arrow key lands on the first (right) or last (left) category. Any other key changes nothing.
 */
export function nextCategory(current: number | null, key: string, count: number): number | null {
  if (count <= 0) return null;
  switch (key) {
    case 'ArrowRight':
      return current === null ? 0 : Math.min(current + 1, count - 1);
    case 'ArrowLeft':
      return current === null ? count - 1 : Math.max(current - 1, 0);
    case 'Home':
      return 0;
    case 'End':
      return count - 1;
    case 'Escape':
      return null;
    default:
      return current;
  }
}

/** One category as a sentence for a live region: `March 2026: Downloads 12, Share 3 %`. */
export function describeCategory(
  table: { headers: string[]; rows: string[][] },
  index: number,
): string {
  const row = table.rows[index];
  if (!row) return '';
  return `${row[0]}: ${row
    .slice(1)
    .map((cell, at) => `${table.headers[at + 1]} ${cell}`)
    .join(', ')}`;
}

/** The outer ring of a radar chart: the given maximum, or the largest value rounded up to a tidy number. */
export function radarMax(spec: ChartSpec): number {
  if (spec.max !== undefined) return spec.max;
  const largest = Math.max(
    0,
    ...spec.series.flatMap((series) => series.values.filter((v): v is number => v !== null)),
  );
  if (largest === 0) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(largest));
  return Math.ceil(largest / magnitude) * magnitude;
}

/** Turns any CSS colour (`oklch(...)`, `var(--x)` already resolved, `#abc`) into one every library parses. */
function toRgb(color: string, context: CanvasRenderingContext2D | null): string {
  if (!context) return color;
  context.clearRect(0, 0, 1, 1);
  context.fillStyle = '#000';
  context.fillStyle = color;
  context.fillRect(0, 0, 1, 1);
  const [r, g, b, a] = context.getImageData(0, 0, 1, 1).data;
  return a === 255 ? `rgb(${r}, ${g}, ${b})` : `rgba(${r}, ${g}, ${b}, ${(a! / 255).toFixed(2)})`;
}

/**
 * The series colours, one fixed categorical palette per colour scheme (docs/ui-style-guide.md, "Chart adapter"). The theme's own tokens were
 * the series colours before, and in the built-in themes four of the six were blues, so the lines of a chart could not be told apart. These
 * eight hues are distinct in hue and lightness, and their order keeps neighbours apart for colour-blind readers: every adjacent pair is
 * at least ΔE 8 (OKLab ×100) under protan, deutan and tritan simulation and ΔE 19 for normal vision, checked against the card colour of each
 * built-in theme. In dark every colour is at least 3:1 on the card; in light orange, aqua, yellow and pink are less, which the second cue
 * (a marker shape per series) and the table of the numbers make up for. A series is never told by colour alone (`seriesStyle`).
 */
export const SERIES_PALETTE = {
  light: ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#6250d6', '#e34948'],
  dark: ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#0ca30c', '#9085e9', '#e66767'],
} as const;

/** The marker shapes, the second cue of a series beside its colour. Each is drawn by the library and by the legend (`Chart.svelte`). */
export const SERIES_MARKERS = ['circle', 'rect', 'triangle', 'diamond'] as const;
export type SeriesMarker = (typeof SERIES_MARKERS)[number];

/** How a series is drawn: its colour, marker and line. */
export interface SeriesStyle {
  color: string;
  marker: SeriesMarker;
  /** `dashed` for a series on the second axis (the legend says so too), `dotted` once the colours have all been used, else `solid`. */
  line: 'solid' | 'dashed' | 'dotted';
}

/**
 * The style of a series from its slot. Past the eighth slot a colour comes back, but with another line (dotted) and, as the markers cycle
 * by four, the pair of colour and line never does within sixteen series.
 */
export function seriesStyle(
  series: ChartSeries,
  index: number,
  palette: readonly string[],
): SeriesStyle {
  const slot = Math.max(0, Math.trunc(series.slot ?? index));
  const size = Math.max(1, palette.length);
  return {
    color: palette[slot % size] ?? '',
    marker: SERIES_MARKERS[slot % SERIES_MARKERS.length]!,
    line: series.secondary === true ? 'dashed' : slot >= size ? 'dotted' : 'solid',
  };
}

/**
 * The colours of the page's theme (DaisyUI variables on `element`), so a chart follows light and dark.
 * Reads the document; call it in the browser.
 */
export function themeFromElement(element: Element): ChartTheme {
  const style = getComputedStyle(element);
  const context = document.createElement('canvas').getContext('2d', { willReadFrequently: true });
  const read = (name: string, fallback: string) =>
    toRgb(style.getPropertyValue(name).trim() || fallback, context);
  const text = read('--color-base-content', '#1f2937');
  const colorScheme = style.colorScheme.includes('dark') ? 'dark' : 'light';
  return {
    colorScheme,
    palette: SERIES_PALETTE[colorScheme],
    text,
    grid: read('--color-base-300', '#d1d5db'),
    background: read('--color-base-100', '#ffffff'),
    reducedMotion: window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  };
}

export interface ChartController {
  /** Draws a new spec. Safe to call before the library has loaded: the last call wins. */
  update(spec: ChartSpec, theme: ChartTheme): void;
  resize(): void;
  /** Shows or hides the tooltip of a category (see `ChartHandle.showTip`). */
  showTip(index: number | null): void;
  /** The chart as an SVG document, or `undefined` while the library is loading or when it cannot say. */
  toSvg(): string | undefined;
  /** Stops the chart. A chart that was still loading is disposed as soon as it arrives. */
  destroy(): void;
}

/**
 * Owns the life of one chart: loads the adapter's chart, hands it the latest spec and theme, and cleans up.
 * It exists because the library loads late (a lazy import), and a page can change the spec, the theme or
 * leave before it has.
 */
export function createChartController(
  adapter: ChartAdapter,
  element: HTMLElement,
  initial: { spec: ChartSpec; theme: ChartTheme },
  onError?: (error: unknown) => void,
): ChartController {
  let latest = initial;
  let handle: ChartHandle | undefined;
  let destroyed = false;

  adapter.mount(element, initial.spec, initial.theme).then(
    (mounted) => {
      if (destroyed) {
        mounted.dispose();
        return;
      }
      handle = mounted;
      // Whatever changed while the library was loading.
      if (latest !== initial) handle.update(latest.spec, latest.theme);
    },
    (error: unknown) => onError?.(error),
  );

  return {
    update(spec, theme) {
      latest = { spec, theme };
      handle?.update(spec, theme);
    },
    resize: () => handle?.resize(),
    showTip: (index) => handle?.showTip?.(index),
    toSvg: () => handle?.toSvg?.(),
    destroy() {
      destroyed = true;
      handle?.dispose();
      handle = undefined;
    },
  };
}
