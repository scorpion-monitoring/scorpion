// The sparkline of a KPI card, as an SVG path built from numbers by our code and never from a data string (nothing in it can be markup). A gap
// breaks the line (a month with no value is not a zero); one value alone is a dot. Pure.

export interface Sparkline {
  /** The `d` of one `<path>`: a `M` per run of values and `L` between neighbours. Empty when there is no value. */
  d: string;
  /** The values that stand alone (a run of one), as `[x, y]`, drawn as dots because a path of one point has no length. */
  dots: [number, number][];
  /** How many values were drawn. */
  count: number;
}

const round = (value: number) => Math.round(value * 100) / 100;

/**
 * The path of `values` in a box of `width` by `height` with `pad` around it. Values are spread evenly along the x axis (the months are
 * evenly spaced); the lowest value is at the bottom and the highest at the top; a flat series is a line through the middle. Anything that is
 * not a finite number is a gap.
 */
export function sparkline(
  values: readonly (number | null | undefined)[],
  width: number,
  height: number,
  pad = 2,
): Sparkline {
  const numbers = values.filter(
    (value): value is number => typeof value === 'number' && Number.isFinite(value),
  );
  if (numbers.length === 0 || !(width > 2 * pad) || !(height > 2 * pad) || values.length === 0)
    return { d: '', dots: [], count: 0 };
  const low = Math.min(...numbers);
  const high = Math.max(...numbers);
  const span = values.length > 1 ? (width - 2 * pad) / (values.length - 1) : 0;
  const x = (index: number) => (values.length > 1 ? pad + index * span : width / 2);
  // Halves, so a spread wider than the largest number (-1e308 to 1e308) does not overflow; a spread that rounds away is a flat line.
  const spread = high / 2 - low / 2;
  const y = (value: number) => {
    const t = (value / 2 - low / 2) / spread;
    return pad + (1 - (Number.isFinite(t) ? t : 0.5)) * (height - 2 * pad);
  };
  const runs: [number, number][][] = [];
  let run: [number, number][] = [];
  values.forEach((value, index) => {
    if (typeof value === 'number' && Number.isFinite(value)) run.push([x(index), y(value)]);
    else if (run.length > 0) {
      runs.push(run);
      run = [];
    }
  });
  if (run.length > 0) runs.push(run);
  const d = runs
    .filter((points) => points.length > 1)
    .map((points) =>
      points.map(([px, py], at) => `${at === 0 ? 'M' : 'L'}${round(px)} ${round(py)}`).join(' '),
    )
    .join(' ');
  const dots = runs
    .filter((points) => points.length === 1)
    .map(([point]): [number, number] => [round(point![0]), round(point![1])]);
  return { d, dots, count: numbers.length };
}

/** What a text alternative says about a series: how many values, the first and the last. `null` where there is none. */
export function sparkSummary(
  values: readonly (number | null | undefined)[],
): { count: number; first: number; last: number } | null {
  const numbers = values.filter(
    (value): value is number => typeof value === 'number' && Number.isFinite(value),
  );
  return numbers.length === 0
    ? null
    : { count: numbers.length, first: numbers[0]!, last: numbers[numbers.length - 1]! };
}
