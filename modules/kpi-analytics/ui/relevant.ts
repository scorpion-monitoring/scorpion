// Which KPIs a widget of a service shows. The summary answers with every KPI of the service's effective set (the set of its category and the
// optional KPIs it opted into) and with KPIs it has dropped but whose values stay. A widget shows only the KPIs of the set that have something to
// show in the window, so a tile is not a column of "n/a"; the KPIs of the set it leaves out are named in one line under the tile.
// Pure, so it is unit tested.

/** The fields of a summary row this choice reads. */
export interface RelevantRow {
  name: string;
  /** `false`: the service no longer reports this KPI (it left the service's set); its old values stay. */
  current: boolean;
  points: readonly { value: number | null; text: string | null }[];
}

/**
 * What a widget needs of a KPI to show it: `value` (a number or a text in some month: the cards), or `number` (a number in some month: the
 * averages, the volatility and the chart, which cannot say anything about a text).
 */
export type Needs = 'value' | 'number';

export interface Chosen<T> {
  /** The rows the widget shows, in the order of the answer. */
  shown: T[];
  /** The names of the KPIs of the set that have nothing to show in this window. */
  empty: string[];
}

const hasValue = (row: RelevantRow, needs: Needs) =>
  row.points.some((point) => point.value !== null || (needs === 'value' && point.text !== null));

export function relevantRows<T extends RelevantRow>(
  rows: readonly T[],
  needs: Needs = 'value',
): Chosen<T> {
  const shown: T[] = [];
  const empty: string[] = [];
  for (const row of rows) {
    // A KPI outside the service's set is not the service's KPI any more: it is not shown and not named (its values stay in the export).
    if (!row.current) continue;
    if (hasValue(row, needs)) shown.push(row);
    else empty.push(row.name);
  }
  return { shown, empty };
}
