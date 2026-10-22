// The table an exporter writes (M11 sprint 5, ADR-0043 decision 8): one row per KPI (name, unit, then one column per month of the **union** of
// the months of all the series, empty where a KPI has no value). The legacy export assumed every KPI shared the first KPI's dates and put values
// under the wrong month; here a month is looked up by its own period. Pure: no database, no clock, no registry.
import { escapeCell } from '@scorpion/kpi-ingestion/public';

/** A cell: text (already escaped), a number, or empty. */
export type Cell = string | number | null;

export interface ExportTable {
  /** `KPI`, `Unit`, then one `YYYY-MM` per month. Always text. */
  header: string[];
  /** One row per KPI, as long as the header. */
  rows: Cell[][];
}

export interface ExportRow {
  name: string;
  /** The unit as a person reads it, or `null` for none. */
  unit: string | null;
  points: readonly { period: string; value: number | null; text: string | null }[];
}

/** The headings are fixed words, not branding; they are the same in every language so a file reads the same wherever it goes. */
export const NAME_HEADING = 'KPI';
export const UNIT_HEADING = 'Unit';

/** A period is the last day of a month, `YYYY-MM-DD`; the column is its month. */
const monthOf = (period: string) => period.slice(0, 7);

/**
 * Builds the table. The months are the union of the periods of all the rows, oldest first. A number stays a number (a negative number is not
 * a formula); every text (names, units, text values, headings) goes through `escapeCell`. A gap is empty, never zero.
 */
export function buildTable(rows: readonly ExportRow[]): ExportTable {
  const months = [
    ...new Set(rows.flatMap((row) => row.points.map((point) => monthOf(point.period)))),
  ].sort();
  const column = new Map(months.map((month, index) => [month, index]));
  return {
    header: [NAME_HEADING, UNIT_HEADING, ...months].map(escapeCell),
    rows: rows.map((row) => {
      const cells: Cell[] = months.map(() => null);
      for (const point of row.points) {
        const at = column.get(monthOf(point.period))!;
        if (typeof point.value === 'number' && Number.isFinite(point.value))
          cells[at] = point.value;
        else if (point.text !== null && point.text !== '') cells[at] = escapeCell(point.text);
      }
      return [escapeCell(row.name), escapeCell(row.unit ?? ''), ...cells];
    }),
  };
}
