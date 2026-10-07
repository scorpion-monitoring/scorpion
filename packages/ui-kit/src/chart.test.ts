import { describe, expect, it } from 'vitest';
import {
  chartProblems,
  createChartController,
  radarMax,
  tableOf,
  type ChartAdapter,
  type ChartHandle,
  type ChartSpec,
  type ChartTheme,
} from './chart.ts';
import { chartOption } from './chart-echarts.ts';

const spec: ChartSpec = {
  type: 'line',
  categories: ['2022', '2023', '2024'],
  series: [
    { name: 'Services', values: [4, 8, null] },
    { name: 'Users', values: [10.456, 20, 30] },
  ],
  unit: 'items',
};
const theme: ChartTheme = {
  colorScheme: 'dark',
  palette: ['#111', '#222'],
  text: '#eee',
  grid: '#333',
  background: '#000',
  reducedMotion: false,
};

describe('chartProblems', () => {
  it('accepts a well-formed spec', () => {
    expect(chartProblems(spec)).toEqual([]);
  });

  it.each<[string, ChartSpec, string]>([
    [
      'no category',
      { ...spec, categories: [], series: [{ name: 'a', values: [] }] },
      'at least one category',
    ],
    ['no series', { ...spec, series: [] }, 'at least one series'],
    [
      'a short series',
      { ...spec, series: [{ name: 'Short', values: [1] }] },
      'series "Short" has 1 values for 3',
    ],
    [
      'infinity',
      { ...spec, series: [{ name: 'Inf', values: [1, Infinity, 3] }] },
      'not a finite number',
    ],
    [
      'a flat radar',
      { type: 'radar', categories: ['a', 'b'], series: [{ name: 's', values: [1, 2] }] },
      'three categories',
    ],
  ])('names the problem of %s', (_name, bad, expected) => {
    expect(chartProblems(bad).join(' ')).toContain(expected);
  });
});

describe('tableOf', () => {
  it('has one row per category and one column per series, with the unit and a dash for a gap', () => {
    expect(tableOf(spec, 'Year', 'en')).toEqual({
      headers: ['Year', 'Services', 'Users'],
      rows: [
        ['2022', '4 items', '10.46 items'],
        ['2023', '8 items', '20 items'],
        ['2024', '–', '30 items'],
      ],
    });
  });

  it('formats numbers in the language of the page', () => {
    expect(tableOf({ ...spec, unit: undefined }, 'Jahr', 'de').rows[0]![2]).toBe('10,46');
  });
});

describe('radarMax', () => {
  it.each([
    [undefined, [1, 2, 3], 3],
    [undefined, [7, 2], 7],
    [undefined, [12, 2], 20],
    [undefined, [0, 0], 1],
    [undefined, [93], 100],
    [5, [1, 2], 5],
  ])('with max %s and values %j is %i', (max, values, expected) => {
    expect(
      radarMax({
        type: 'radar',
        categories: values.map(String),
        series: [{ name: 's', values }],
        max,
      }),
    ).toBe(expected);
  });
});

interface Option {
  xAxis: { data: string[] };
  series: { type: string; name?: string; data: unknown[] }[];
  color: string[];
  legend?: unknown;
  animation: boolean;
  radar: { indicator: { name: string; max: number }[] };
}
const optionOf = (chart: ChartSpec, chartTheme: ChartTheme) =>
  chartOption(chart, chartTheme) as unknown as Option;

describe('chartOption', () => {
  it('draws a line chart with the categories on the x axis and the theme colours', () => {
    const option = optionOf(spec, theme);
    expect(option.xAxis.data).toEqual(['2022', '2023', '2024']);
    expect(option.series.map((s) => [s.type, s.name])).toEqual([
      ['line', 'Services'],
      ['line', 'Users'],
    ]);
    expect(option.color).toEqual(['#111', '#222']);
    expect(option.legend).toBeDefined();
    expect(option.animation).toBe(true);
  });

  it('draws a bar chart, shows no legend for one series and stops animation for reduced motion', () => {
    const option = optionOf(
      { ...spec, type: 'bar', series: [spec.series[0]!] },
      { ...theme, reducedMotion: true },
    );
    expect(option.series[0]!.type).toBe('bar');
    expect(option.legend).toBeUndefined();
    expect(option.animation).toBe(false);
  });

  it('draws a radar chart with one spoke per category', () => {
    const option = optionOf(
      {
        type: 'radar',
        categories: ['a', 'b', 'c'],
        series: [{ name: 's', values: [1, 2, 3] }],
        max: 5,
      },
      theme,
    );
    expect(option.radar.indicator).toEqual([
      { name: 'a', max: 5 },
      { name: 'b', max: 5 },
      { name: 'c', max: 5 },
    ]);
    expect(option.series[0]!.data).toEqual([{ name: 's', value: [1, 2, 3] }]);
  });
});

/** An adapter that records what it was asked, and lets the test decide when the library "arrives". */
function stubAdapter() {
  const calls: string[] = [];
  let release!: () => void;
  const loaded = new Promise<void>((resolve) => (release = resolve));
  const handle: ChartHandle = {
    update: (next, nextTheme) =>
      calls.push(`update ${next.series[0]!.name} ${nextTheme.colorScheme}`),
    resize: () => calls.push('resize'),
    dispose: () => calls.push('dispose'),
  };
  const adapter: ChartAdapter = {
    mount: async (_element, first, firstTheme) => {
      calls.push(`mount ${first.series[0]!.name} ${firstTheme.colorScheme}`);
      await loaded;
      return handle;
    },
  };
  return { adapter, calls, release };
}

describe('createChartController', () => {
  const element = {} as HTMLElement;
  const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

  it('mounts with the first spec and passes later changes on', async () => {
    const { adapter, calls, release } = stubAdapter();
    const controller = createChartController(adapter, element, { spec, theme });
    release();
    await flush();
    controller.update(
      { ...spec, series: [{ name: 'Other', values: [1, 2, 3] }] },
      { ...theme, colorScheme: 'light' },
    );
    controller.resize();
    expect(calls).toEqual(['mount Services dark', 'update Other light', 'resize']);
  });

  it('gives the library the newest spec when it arrives late, and only that', async () => {
    const { adapter, calls, release } = stubAdapter();
    const controller = createChartController(adapter, element, { spec, theme });
    controller.update({ ...spec, series: [{ name: 'A', values: [1, 2, 3] }] }, theme);
    controller.update({ ...spec, series: [{ name: 'B', values: [1, 2, 3] }] }, theme);
    release();
    await flush();
    expect(calls).toEqual(['mount Services dark', 'update B dark']);
  });

  it('disposes a chart that was still loading when the page left', async () => {
    const { adapter, calls, release } = stubAdapter();
    const controller = createChartController(adapter, element, { spec, theme });
    controller.destroy();
    release();
    await flush();
    expect(calls).toEqual(['mount Services dark', 'dispose']);
  });

  it('disposes once, and ignores a call after the end', async () => {
    const { adapter, calls, release } = stubAdapter();
    const controller = createChartController(adapter, element, { spec, theme });
    release();
    await flush();
    controller.destroy();
    controller.update(spec, theme);
    controller.resize();
    expect(calls).toEqual(['mount Services dark', 'dispose']);
  });

  it('reports a library that fails to load instead of throwing', async () => {
    const errors: unknown[] = [];
    createChartController(
      { mount: () => Promise.reject(new Error('offline')) },
      element,
      { spec, theme },
      (error) => errors.push(error),
    );
    await flush();
    expect(errors).toHaveLength(1);
  });
});
