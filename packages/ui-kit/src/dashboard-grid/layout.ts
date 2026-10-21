// The pure rules of the dashboard grid: what a button move or resize does, where a new tile goes, the reading
// order of the stacked layout, instance ids and the texts a screen reader hears. No Svelte, no Snapgrid: the
// component imports these, and a replacement of the grid library keeps them (M11 sprint 2, ADR-0042).
import { compactUp, overlaps, pack, type TileBox } from '@scorpion/contracts/dashboard-layout';

/** Columns of the grid (the stored document is one desktop layout of twelve, M11 decision 8). */
export const GRID_COLUMNS = 12;
/** The grid's row height and the gap between tiles, in CSS pixels. The only place the numbers are written. */
export const GRID_ROW_HEIGHT = 64;
export const GRID_GAP = 16;
/** The lowest row a tile may be moved to by a button (the document's own limit is far below it). */
export const GRID_MAX_ROW = 1000;

/** A tile as the grid sees it: where it is, how big, and the limits of its widget. */
export interface GridTile extends TileBox {
  id: string;
  minW?: number | undefined;
  maxW?: number | undefined;
  minH?: number | undefined;
  maxH?: number | undefined;
}

export type MoveDirection = 'left' | 'right' | 'up' | 'down';
export type ResizeDirection = 'wider' | 'narrower' | 'taller' | 'shorter';

/** What the grid tells the page it changed. `id` is the tile the person acted on. */
export interface GridChange {
  kind: 'move' | 'resize' | 'remove';
  id: string;
}

export type MoveResult<T extends GridTile> =
  | { ok: true; tiles: T[]; tile: T }
  | { ok: false; reason: 'edge' | 'limit' | 'unknown'; tile: T | undefined };

const byReadingOrder = (a: TileBox, b: TileBox) => a.y - b.y || a.x - b.x;

/** The tiles in the order a person reads them: by row, then column, then as given. Stable. */
export function stackedOrder<T extends TileBox>(tiles: readonly T[]): T[] {
  return tiles
    .map((tile, index) => ({ tile, index }))
    .sort((a, b) => byReadingOrder(a.tile, b.tile) || a.index - b.index)
    .map(({ tile }) => tile);
}

/**
 * Pushes the other tiles down around the one the person just placed (it keeps its place, the others yield),
 * then lets everything rise as the grid does after a drag. The same shared packer the server's repair uses.
 */
export function settle<T extends GridTile>(tiles: readonly T[], anchorId: string): T[] {
  const at = tiles.findIndex((tile) => tile.id === anchorId);
  return compactUp(pack(tiles, at >= 0 ? at : undefined));
}

const STEPS: Record<MoveDirection, readonly [number, number]> = {
  left: [-1, 0],
  right: [1, 0],
  up: [0, -1],
  down: [0, 1],
};

/**
 * Where a tile goes when a button asks for one cell in `direction`. A tile in the way is passed, not pushed
 * sideways: left and right jump past it to the next free place of the row (nothing there is a refusal), up and
 * down jump past it in the column and the grid settles, so the two swap places as they do when dragged.
 */
function target(
  tiles: readonly GridTile[],
  tile: GridTile,
  direction: MoveDirection,
  columns: number,
): { x: number; y: number } | undefined {
  const others = tiles.filter((candidate) => candidate.id !== tile.id);
  const [dx, dy] = STEPS[direction];
  let x = tile.x + dx;
  const y = tile.y + dy;
  for (let guard = 0; guard <= columns; guard += 1) {
    if (x < 0 || x + tile.w > columns || y < 0 || y > GRID_MAX_ROW) return undefined;
    const blocking = others.filter((other) => overlaps({ ...tile, x, y }, other));
    if (blocking.length === 0) return { x, y };
    if (direction === 'down')
      return { x, y: Math.max(...blocking.map((other) => other.y + other.h)) };
    if (direction === 'up')
      return { x, y: Math.max(0, Math.min(...blocking.map((other) => other.y)) - tile.h) };
    x =
      direction === 'right'
        ? Math.max(...blocking.map((other) => other.x + other.w))
        : Math.min(...blocking.map((other) => other.x)) - tile.w;
  }
  return undefined;
}

/** Moves a tile one cell. It stays inside the grid; a tile in the way is passed; `ok: false` says why nothing moved. */
export function moveTile<T extends GridTile>(
  tiles: readonly T[],
  id: string,
  direction: MoveDirection,
  columns = GRID_COLUMNS,
): MoveResult<T> {
  const tile = tiles.find((candidate) => candidate.id === id);
  if (!tile) return { ok: false, reason: 'unknown', tile: undefined };
  const to = target(tiles, tile, direction, columns);
  if (!to) return { ok: false, reason: 'edge', tile };
  const next = settle(
    tiles.map((candidate) => (candidate.id === id ? { ...candidate, ...to } : candidate)),
    id,
  );
  const moved = next.find((candidate) => candidate.id === id)!;
  // Moving down off the last row is undone by the rise: nothing happened.
  if (moved.x === tile.x && moved.y === tile.y) return { ok: false, reason: 'edge', tile };
  return { ok: true, tiles: next, tile: moved };
}

/** Changes a tile's size by one cell, inside the grid and the limits of its widget. */
export function resizeTile<T extends GridTile>(
  tiles: readonly T[],
  id: string,
  direction: ResizeDirection,
  columns = GRID_COLUMNS,
): MoveResult<T> {
  const tile = tiles.find((candidate) => candidate.id === id);
  if (!tile) return { ok: false, reason: 'unknown', tile: undefined };
  const minW = tile.minW ?? 1;
  const maxW = Math.min(tile.maxW ?? columns, columns - tile.x);
  const minH = tile.minH ?? 1;
  const maxH = tile.maxH ?? GRID_MAX_ROW;
  const w = tile.w + (direction === 'wider' ? 1 : direction === 'narrower' ? -1 : 0);
  const h = tile.h + (direction === 'taller' ? 1 : direction === 'shorter' ? -1 : 0);
  if (w < minW || w > maxW || h < minH || h > maxH) return { ok: false, reason: 'limit', tile };
  const next = settle(
    tiles.map((candidate) => (candidate.id === id ? { ...candidate, w, h } : candidate)),
    id,
  );
  return { ok: true, tiles: next, tile: next.find((candidate) => candidate.id === id)! };
}

/** The place for a new tile of this size: the left edge, below the lowest tile. */
export function placeNew(tiles: readonly TileBox[]): { x: number; y: number } {
  return { x: 0, y: tiles.reduce((bottom, tile) => Math.max(bottom, tile.y + tile.h), 0) };
}

/** Removes a tile and lets the others rise, as the grid does. */
export function removeTile<T extends GridTile>(tiles: readonly T[], id: string): T[] {
  return compactUp(tiles.filter((tile) => tile.id !== id));
}

/**
 * The layout the grid draws in view mode: a tile that draws nothing takes no room (it has no height), so the tiles below
 * it rise into its place. Tiles never move sideways: a tile that is empty only while it loads would otherwise make its
 * neighbours jump twice. Tiles keep their own size and place in the document; this is only what is drawn.
 */
export function visibleLayout<T extends GridTile>(
  tiles: readonly T[],
  empty: ReadonlySet<string>,
): T[] {
  return compactUp(tiles.map((tile) => (empty.has(tile.id) ? { ...tile, h: 0 } : tile)));
}

// ---- instance ids -----------------------------------------------------------------------------------------

const ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';
/** The length of a generated instance id (the document allows 4 to 12 lower-case letters and digits). */
export const INSTANCE_ID_LENGTH = 8;

/**
 * A new instance id from random bytes, never from `Math.random`. A collision with an existing id draws again.
 * Bytes above the largest multiple of 36 are discarded, so every letter and digit is equally likely.
 */
export function newInstanceId(
  taken: ReadonlySet<string>,
  fill: (bytes: Uint8Array<ArrayBuffer>) => void = (bytes) => void crypto.getRandomValues(bytes),
): string {
  const limit = 256 - (256 % ALPHABET.length);
  for (let attempt = 0; attempt < 100; attempt += 1) {
    let id = '';
    while (id.length < INSTANCE_ID_LENGTH) {
      const bytes = new Uint8Array(new ArrayBuffer(16));
      fill(bytes);
      for (const byte of bytes) {
        if (byte < limit && id.length < INSTANCE_ID_LENGTH) id += ALPHABET[byte % ALPHABET.length];
      }
    }
    if (!taken.has(id)) return id;
  }
  throw new Error('No free instance id after 100 draws.');
}

// ---- what a screen reader hears -----------------------------------------------------------------------------

export interface GridTexts {
  /** Interpolated by the caller's translator: `name`, `row` and `column` are 1-based words for people. */
  moved: (name: string, row: number, column: number) => string;
  resized: (name: string, width: number, height: number) => string;
  pickedUp: (name: string) => string;
  cancelled: (name: string) => string;
  atEdge: (name: string) => string;
  atLimit: (name: string) => string;
  removed: (name: string, left: number) => string;
}

/** The sentence for a change of the layout (rows and columns count from 1 for people). */
export function describeChange(
  texts: GridTexts,
  name: string,
  tile: TileBox,
  kind: 'move' | 'resize',
): string {
  return kind === 'move'
    ? texts.moved(name, tile.y + 1, tile.x + 1)
    : texts.resized(name, tile.w, tile.h);
}

/** The two things dnd-kit's live region says for a keyboard drag: the pick-up and a cancel. A drop is said by `describeChange`. */
export function dragAnnouncements(
  texts: Pick<GridTexts, 'pickedUp' | 'cancelled'>,
  nameOf: (id: string) => string,
) {
  return {
    dragstart: ({ operation: { source } }: { operation: { source?: { id: unknown } | null } }) =>
      source ? texts.pickedUp(nameOf(String(source.id))) : undefined,
    dragend: ({
      operation: { source },
      canceled,
    }: {
      operation: { source?: { id: unknown } | null };
      canceled: boolean;
    }) => (source && canceled ? texts.cancelled(nameOf(String(source.id))) : undefined),
  };
}
