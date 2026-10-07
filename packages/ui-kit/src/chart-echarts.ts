// The ECharts adapter. This is the only file that names ECharts. It is loaded when the first chart mounts
// (`import('./chart-echarts.ts')`), and it pulls only the parts that line, bar and radar charts need, so the
// weight of the library stays out of every page without a chart. The SVG renderer draws real elements the
// theme and a screen magnifier can work with, and needs no inline style.
import {
  radarMax,
  type ChartAdapter,
  type ChartHandle,
  type ChartSpec,
  type ChartTheme,
} from './chart.ts';

/** The options ECharts is given for a spec and a theme. Plain data, so a test can read it. */
export function chartOption(spec: ChartSpec, theme: ChartTheme): Record<string, unknown> {
  const unit = spec.unit ? ` ${spec.unit}` : '';
  const base = {
    animation: !theme.reducedMotion,
    color: [...theme.palette],
    backgroundColor: 'transparent',
    textStyle: { color: theme.text },
    legend: spec.series.length > 1 ? { bottom: 0, textStyle: { color: theme.text } } : undefined,
    tooltip: {
      trigger: spec.type === 'radar' ? 'item' : 'axis',
      valueFormatter: (value: unknown) => `${String(value)}${unit}`,
    },
  };
  if (spec.type === 'radar') {
    return {
      ...base,
      radar: {
        indicator: spec.categories.map((name) => ({ name, max: radarMax(spec) })),
        axisName: { color: theme.text },
        splitLine: { lineStyle: { color: theme.grid } },
        splitArea: { show: false },
        axisLine: { lineStyle: { color: theme.grid } },
      },
      series: [
        {
          type: 'radar',
          data: spec.series.map((series) => ({ name: series.name, value: [...series.values] })),
        },
      ],
    };
  }
  return {
    ...base,
    grid: { left: 48, right: 16, top: 24, bottom: spec.series.length > 1 ? 48 : 32 },
    xAxis: {
      type: 'category',
      data: [...spec.categories],
      axisLine: { lineStyle: { color: theme.grid } },
      axisLabel: { color: theme.text },
    },
    yAxis: {
      type: 'value',
      axisLabel: { color: theme.text },
      splitLine: { lineStyle: { color: theme.grid } },
    },
    series: spec.series.map((series) => ({
      name: series.name,
      type: spec.type,
      data: [...series.values],
      ...(spec.type === 'line' ? { symbolSize: 6 } : {}),
    })),
  };
}

export const echartsAdapter: ChartAdapter = {
  async mount(element, spec, theme): Promise<ChartHandle> {
    const [core, charts, components, renderers] = await Promise.all([
      import('echarts/core'),
      import('echarts/charts'),
      import('echarts/components'),
      import('echarts/renderers'),
    ]);
    core.use([
      charts.LineChart,
      charts.BarChart,
      charts.RadarChart,
      components.GridComponent,
      components.TooltipComponent,
      components.LegendComponent,
      components.RadarComponent,
      renderers.SVGRenderer,
    ]);
    const chart = core.init(element, undefined, { renderer: 'svg' });
    const draw = (next: ChartSpec, nextTheme: ChartTheme) =>
      // `notMerge`: a changed type or theme replaces what was drawn instead of mixing with it.
      chart.setOption(chartOption(next, nextTheme) as never, { notMerge: true });
    draw(spec, theme);
    return {
      update: draw,
      resize: () => chart.resize(),
      dispose: () => chart.dispose(),
    };
  },
};
