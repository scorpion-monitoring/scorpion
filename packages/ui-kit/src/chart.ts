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
  /** Series colours, as `#rrggbb`/`rgb()` strings the library can parse. */
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

const PALETTE_VARIABLES = [
  '--color-primary',
  '--color-secondary',
  '--color-accent',
  '--color-info',
  '--color-success',
  '--color-warning',
] as const;

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
  return {
    colorScheme: style.colorScheme.includes('dark') ? 'dark' : 'light',
    palette: PALETTE_VARIABLES.map((name) => read(name, text)),
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
    destroy() {
      destroyed = true;
      handle?.dispose();
      handle = undefined;
    },
  };
}
