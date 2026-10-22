// The pure layout rules of the dashboard grid that the server (the stored document, `core.ui-shell`) and the
// browser (`DashboardGrid`, its button moves) must agree on. One implementation here, so a layout the browser
// sends is the layout the server's repair leaves alone. No Svelte, no I/O.

/** The box of a tile in grid units. */
export interface TileBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Whether two boxes share a cell. */
export const overlaps = (a: TileBox, b: TileBox): boolean =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/**
 * Moves overlapping tiles down until none overlaps, and returns the tiles by row, then column. A tile
 * stays where it is unless an earlier one (by row, then column, then position) is in its way, so a layout
 * that has no overlap comes back unchanged, and packing a packed layout changes nothing. Gaps are kept:
 * the grid compacts what a person drags, the document does not rewrite a layout they chose.
 *
 * `first` is the position of a tile that has just been placed by a person: it keeps its place and the
 * others make room for it, whatever their rows.
 */
export function pack<T extends TileBox>(items: readonly T[], first?: number): T[] {
  const order = items
    .map((item, index) => ({ item, index }))
    .sort(
      (a, b) =>
        Number(b.index === first) - Number(a.index === first) ||
        a.item.y - b.item.y ||
        a.item.x - b.item.x ||
        a.index - b.index,
    );
  const placed: T[] = [];
  for (const { item } of order) {
    let y = item.y;
    for (;;) {
      const here = { ...item, y };
      const blocking = placed.filter((other) => overlaps(here, other));
      if (blocking.length === 0) break;
      y = Math.max(...blocking.map((other) => other.y + other.h));
    }
    placed.push(y === item.y ? item : { ...item, y });
  }
  return placed.sort((a, b) => a.y - b.y || a.x - b.x);
}

/**
 * What the grid's vertical compaction does to a layout without overlaps: every tile rises as far as it can
 * without meeting one that is already placed (by row, then column). The grid applies it after a drag, so the
 * button moves apply it too and a layout looks the same whichever way it was changed. Idempotent.
 */
export function compactUp<T extends TileBox>(items: readonly T[]): T[] {
  const order = items
    .map((item, index) => ({ item, index }))
    .sort((a, b) => a.item.y - b.item.y || a.item.x - b.item.x || a.index - b.index);
  const placed: T[] = [];
  for (const { item } of order) {
    let y = item.y;
    while (y > 0 && !placed.some((other) => overlaps({ ...item, y: y - 1 }, other))) y -= 1;
    placed.push(y === item.y ? item : { ...item, y });
  }
  return placed.sort((a, b) => a.y - b.y || a.x - b.x);
}
