// The column mapping of a file as pure functions. The mapping is keyed by the 0-based index of the column (two columns may have one header),
// each target (`period` or an indicator id) at most once. The server proposes one (`preview`) and judges the one sent; these keep what the
// person changes consistent, give the select of each column its options and build what is sent. Pure.
export const PERIOD_TARGET = 'period';

export type Mapping = Record<string, string>;

/** An indicator a column may map to. */
export interface Target {
  id: string;
  name: string;
}

export interface Option {
  /** `''` for "not mapped", `period`, or an indicator id. */
  value: string;
  /** The name of the indicator; absent for the two fixed options (the page words them). */
  name?: string;
  /** The column (1-based) that has this target already, when it is not this one; the option is then taken. */
  takenBy?: number;
}

/** The target of a column, `''` when it has none. */
export const targetOf = (mapping: Mapping, column: number): string => mapping[String(column)] ?? '';

/** The column (0-based) that has `target`, if any. */
export function columnOf(mapping: Mapping, target: string): number | undefined {
  for (const [column, value] of Object.entries(mapping))
    if (value === target) return Number(column);
  return undefined;
}

/** The options of one column's select: not mapped, the period, then every indicator; a target that another column has says which. */
export function optionsFor(
  column: number,
  mapping: Mapping,
  indicators: readonly Target[],
): Option[] {
  const taken = (target: string): Pick<Option, 'takenBy'> => {
    const holder = columnOf(mapping, target);
    return holder !== undefined && holder !== column ? { takenBy: holder + 1 } : {};
  };
  return [
    { value: '' },
    { value: PERIOD_TARGET, ...taken(PERIOD_TARGET) },
    ...indicators.map((indicator) => ({
      value: indicator.id,
      name: indicator.name,
      ...taken(indicator.id),
    })),
  ];
}

/** The mapping with `target` on `column` (`''` clears it). A target another column had moves, so no target is ever twice. */
export function withTarget(mapping: Mapping, column: number, target: string): Mapping {
  const next: Mapping = {};
  for (const [key, value] of Object.entries(mapping))
    if (value !== target || target === '') next[key] = value;
  if (target === '') delete next[String(column)];
  else next[String(column)] = target;
  return next;
}

/** Whether two mappings say the same. */
export function sameMapping(a: Mapping, b: Mapping): boolean {
  const left = Object.entries(a).filter(([, value]) => value !== '');
  const right = Object.entries(b).filter(([, value]) => value !== '');
  return left.length === right.length && left.every(([key, value]) => b[key] === value);
}

/** What is sent as `mapping` (JSON text in a multipart field): only the columns that have a target. */
export function mappingBody(mapping: Mapping): string {
  return JSON.stringify(
    Object.fromEntries(Object.entries(mapping).filter(([, value]) => value !== '')),
  );
}

/** The columns that are mapped, in order. */
export const mappedColumns = (mapping: Mapping): number[] =>
  Object.entries(mapping)
    .filter(([, value]) => value !== '')
    .map(([key]) => Number(key))
    .sort((a, b) => a - b);

/** The names of the required targets that no column maps to, as the server listed them (`period` first, then indicators by name). */
export function missingNames(
  missing: readonly string[],
  indicators: readonly Target[],
): { period: boolean; names: string[] } {
  const names = new Map(indicators.map((indicator) => [indicator.id, indicator.name]));
  return {
    period: missing.includes(PERIOD_TARGET),
    names: missing
      .filter((id) => id !== PERIOD_TARGET)
      .map((id) => names.get(id) ?? id)
      .sort((a, b) => a.localeCompare(b)),
  };
}
