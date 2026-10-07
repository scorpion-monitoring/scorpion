// The rules of `DataTable` and `Pagination` as plain functions: which way a click on a header sorts, what
// a screen reader hears for the sort, how rows sort when the table does it itself, and which page buttons
// to show. Pages are counted from 0 as in the API's envelope.
import type { Snippet } from 'svelte';

export type SortDirection = 'asc' | 'desc';
export interface Sort {
  key: string;
  direction: SortDirection;
}

/** A click on a header: a new column starts ascending, the sorted column turns round. */
export function nextSort(current: Sort | undefined, key: string): Sort {
  if (current?.key === key) return { key, direction: current.direction === 'asc' ? 'desc' : 'asc' };
  return { key, direction: 'asc' };
}

export type AriaSort = 'ascending' | 'descending' | 'none';

/** The `aria-sort` of a header: only the sorted column says anything. */
export function ariaSort(current: Sort | undefined, key: string): AriaSort {
  if (current?.key !== key) return 'none';
  return current.direction === 'asc' ? 'ascending' : 'descending';
}

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

/** Two values that are not empty. */
function compareValues(a: unknown, b: unknown): number {
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  if (a instanceof Date && b instanceof Date) return a.getTime() - b.getTime();
  if (typeof a === 'boolean' && typeof b === 'boolean') return Number(a) - Number(b);
  return collator.compare(String(a), String(b));
}

/**
 * Sorts rows the way the API does: by the column, then by the row's key, so two rows with the same value
 * never swap places between two renders and a page never repeats a row. A new array; the input is kept.
 */
export function sortRows<Row>(
  rows: readonly Row[],
  sort: Sort | undefined,
  value: (row: Row, key: string) => unknown,
  rowKey: (row: Row) => string,
): Row[] {
  if (!sort) return [...rows];
  const factor = sort.direction === 'asc' ? 1 : -1;
  const withValue = rows.map((row) => ({ row, v: value(row, sort.key), id: rowKey(row) }));
  // An empty value (`null`, `undefined`, `''`) sorts last in either direction.
  const emptyLast = (a: unknown, b: unknown) => {
    const emptyA = a === null || a === undefined || a === '';
    const emptyB = b === null || b === undefined || b === '';
    return emptyA || emptyB ? Number(emptyA) - Number(emptyB) : undefined;
  };
  return withValue
    .sort((a, b) => {
      const empty = emptyLast(a.v, b.v);
      if (empty !== undefined) return empty !== 0 ? empty : collator.compare(a.id, b.id) * factor;
      return compareValues(a.v, b.v) * factor || collator.compare(a.id, b.id) * factor;
    })
    .map((entry) => entry.row);
}

/** How many pages `total` rows make; at least 1, so an empty table still has a first page. */
export const pageCount = (total: number, pageSize: number): number =>
  Math.max(1, Math.ceil(Math.max(0, total) / Math.max(1, pageSize)));

/** The page that exists nearest to `page` (it may have gone after a delete or a filter). */
export const clampPage = (page: number, total: number, pageSize: number): number =>
  Math.min(Math.max(0, Math.trunc(page) || 0), pageCount(total, pageSize) - 1);

/**
 * The page buttons to show: the first and the last page always, and a run of pages around the current
 * one, with a `'gap'` for the pages left out. `max` is how many entries (gaps included) at most, at least 5.
 */
export function pageWindow(page: number, pages: number, max = 7): (number | 'gap')[] {
  const limit = Math.max(5, max);
  const range = (from: number, to: number) =>
    Array.from({ length: to - from + 1 }, (_, i) => from + i);
  if (pages <= limit) return range(0, pages - 1);
  const edge = limit - 2; // pages shown next to one end, then a gap and the other end
  const middle = limit - 4; // pages shown around the current one
  if (page <= edge - 2) return [...range(0, edge - 1), 'gap', pages - 1];
  if (page >= pages - edge + 1) return [0, 'gap', ...range(pages - edge, pages - 1)];
  const start = page - Math.floor((middle - 1) / 2);
  return [0, 'gap', ...range(start, start + middle - 1), 'gap', pages - 1];
}

/** The first and last row number a page shows (1-based, for "1–20 of 134"), or zeros for an empty table. */
export function rowRange(
  page: number,
  pageSize: number,
  total: number,
): { from: number; to: number } {
  if (total <= 0) return { from: 0, to: 0 };
  const from = page * pageSize + 1;
  return { from: Math.min(from, total), to: Math.min(total, (page + 1) * pageSize) };
}

/** A column of `DataTable`. */
export interface Column<Row> {
  /** The key of the sort (`sort=<key>` in the API) and the column's identity. */
  key: string;
  /** The heading, already translated. */
  header: string;
  sortable?: boolean;
  /** The text of the cell, and what a table that sorts by itself compares. */
  value?: (row: Row) => unknown;
  /** The cell as markup instead of `value` (a link, a badge, a time). */
  cell?: Snippet<[Row]>;
  /** The cell names the row for a screen reader (`<th scope="row">`). One column at most. */
  rowHeader?: boolean;
  /** Extra classes for the heading and the cells (alignment, width). */
  class?: string;
}
