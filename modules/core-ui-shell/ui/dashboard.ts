// The dashboard page's own logic, apart from Svelte so that it can be tested: how the tiles of the grid and the
// items of the stored document map to each other, what may be added, what a failed save means, and the autosave
// (one `PUT` a second after the last change, never a loop). The server's repaired document is the only source of
// what is shown; nothing here decides what a person may see.
import { newInstanceId, type GridTile } from '@scorpion/ui-kit/dashboard-layout';
import type { Navigation } from '@scorpion/contracts/client';
import { failureOf } from '@scorpion/ui-kit/forms';
import { DASHBOARD_SLOT, DEFAULT_SIZE, MAX_ITEMS } from '../grid.ts';
import { defaultDashboard, type PlaceableWidget } from '../service/dashboard/document.ts';

/** One tile of the stored document (`GET /ui/dashboard`, `PUT /ui/dashboard`). */
export interface Item {
  id: string;
  widget: string;
  x: number;
  y: number;
  w: number;
  h: number;
  config: Record<string, unknown>;
}

/** What `GET /ui/dashboard` answers: the server's repaired document, and what the repair left out. */
export interface DashboardView {
  items: Item[];
  dropped: { id: string; reason: string }[];
  reset: boolean;
  resetReason?: string | undefined;
  isDefault: boolean;
}

export type Entry = Navigation['widgets'][number];

/** The widgets that can be placed as tiles: the entries of the dashboard slot the server listed for this caller. */
export const placeable = (navigation: Navigation): Entry[] =>
  navigation.widgets.filter((entry) => entry.slot === DASHBOARD_SLOT);

const sizeOf = (entry: Entry) => ({
  w: entry.grid?.w ?? DEFAULT_SIZE.w,
  h: entry.grid?.h ?? DEFAULT_SIZE.h,
});

/** The grid's tiles for the items: positions, and the limits of each tile's widget. */
export function toTiles(items: readonly Item[], entries: ReadonlyMap<string, Entry>): GridTile[] {
  return items.map((item) => {
    const grid = entries.get(item.widget)?.grid;
    return {
      id: item.id,
      x: item.x,
      y: item.y,
      w: item.w,
      h: item.h,
      minW: grid?.minW,
      maxW: grid?.maxW,
      minH: grid?.minH,
      maxH: grid?.maxH,
    };
  });
}

/** The items with the positions of the tiles; an item whose tile is gone is gone. */
export function applyTiles(items: readonly Item[], tiles: readonly GridTile[]): Item[] {
  const at = new Map(tiles.map((tile) => [tile.id, tile]));
  return items.flatMap((item) => {
    const tile = at.get(item.id);
    return tile ? [{ ...item, x: tile.x, y: tile.y, w: tile.w, h: tile.h }] : [];
  });
}

export type AddCheck = { ok: true } | { ok: false; reason: 'full' | 'singleton' };

/** Whether a widget can be added now: not past 20 tiles, and a `singleton` only once. */
export function canAdd(entry: Entry, items: readonly Item[]): AddCheck {
  if (entry.grid?.singleton === true && items.some((item) => item.widget === entry.id)) {
    return { ok: false, reason: 'singleton' };
  }
  if (items.length >= MAX_ITEMS) return { ok: false, reason: 'full' };
  return { ok: true };
}

/** A new tile of this widget at its default size, at the left edge below the lowest tile. Its id is drawn from `crypto`. */
export function newItem(
  entry: Entry,
  items: readonly Item[],
  place: { x: number; y: number },
  fill?: (bytes: Uint8Array) => void,
): Item {
  const id = newInstanceId(new Set(items.map((item) => item.id)), fill);
  return { id, widget: entry.id, ...place, ...sizeOf(entry), config: {} };
}

/**
 * What "Reset to default" shows: the placements of the widgets this caller may add, in the server's own function
 * (`defaultDashboard`; the instance ids are a hash of the widget id, so they match the server's). A widget with
 * a configuration gets `{}` here and its defaults from the server on the next save and read.
 */
export function defaultItems(entries: readonly Entry[]): Item[] {
  const placeables = entries.map((entry): PlaceableWidget => ({
    id: entry.id,
    slot: entry.slot,
    order: entry.order,
    permission: 'listed-by-the-server',
    grid: entry.grid,
  }));
  return defaultDashboard(placeables, () => true);
}

// ---- a failed save -------------------------------------------------------------------------------------------

export type SaveProblem =
  /** The caller may not save (a role without the permission): the layout stays on this page only. */
  | 'forbidden'
  /** The document does not fit the store: remove a tile or simplify a setting. */
  | 'too-large'
  /** A tile is no longer valid (its widget is gone, or the caller lost the right to it): the server's repair is read again. */
  | 'repair'
  | 'failed';

export function problemOf(error: unknown): SaveProblem {
  const failure = failureOf(error);
  if (failure.status === 403) return 'forbidden';
  if (failure.status === 422) {
    const names = Object.keys(failure.fields);
    const only = (name: string) => name === 'items';
    return names.length > 0 && names.every(only) ? 'too-large' : 'repair';
  }
  return 'failed';
}

// ---- the autosave --------------------------------------------------------------------------------------------

export type SaveState = 'idle' | 'pending' | 'saving' | 'saved' | 'failed';

export interface Autosave<T> {
  /** A change was made: save it one `delay` after the last one. A change after a failure starts a new attempt. */
  schedule: (value: T) => void;
  /** Saves now what is waiting (the person is leaving, or pressed Done). Resolves when it is stored or has failed. */
  flush: () => Promise<void>;
  /** Tries the last failed value again, once. */
  retry: () => Promise<void>;
  dispose: () => void;
  readonly state: SaveState;
}

export interface AutosaveOptions<T> {
  save: (value: T) => Promise<void>;
  /** The burst length: the time with no change after which the save is sent. */
  delayMs?: number;
  onState?: (state: SaveState, error?: unknown) => void;
  setTimer?: (run: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
}

/**
 * One save a second after the last change. A change while a save is running waits for it, then is saved in its own
 * burst. A failure stops: nothing is retried by itself (no loop); the next change of the person, or `retry()`, is
 * the next attempt. A value is never lost on failure: it stays the one `retry()` sends.
 */
export function createAutosave<T>(options: AutosaveOptions<T>): Autosave<T> {
  const delay = options.delayMs ?? 1000;
  const setTimer = options.setTimer ?? ((run, ms) => setTimeout(run, ms));
  const clearTimer = options.clearTimer ?? ((handle) => clearTimeout(handle as number));
  let state: SaveState = 'idle';
  let timer: unknown;
  let waiting: { value: T } | undefined;
  let running: Promise<void> | undefined;
  let disposed = false;

  const set = (next: SaveState, error?: unknown) => {
    state = next;
    options.onState?.(next, error);
  };

  async function run(): Promise<void> {
    timer = undefined;
    if (disposed || waiting === undefined) return;
    if (running) return running.then(() => (waiting !== undefined && !timer ? run() : undefined));
    const sending = waiting;
    waiting = undefined;
    set('saving');
    running = options
      .save(sending.value)
      .then(() => {
        // A change made while this was in flight keeps the state `pending` and has its own timer.
        if (waiting === undefined) set('saved');
      })
      .catch((error: unknown) => {
        // Keep the value for `retry()`, unless a newer one is waiting.
        waiting ??= sending;
        set('failed', error);
      })
      .finally(() => {
        running = undefined;
      });
    await running;
  }

  return {
    schedule(value) {
      if (disposed) return;
      waiting = { value };
      if (timer !== undefined) clearTimer(timer);
      set('pending');
      timer = setTimer(() => void run(), delay);
    },
    async flush() {
      if (timer !== undefined) clearTimer(timer);
      timer = undefined;
      if (waiting !== undefined && state !== 'failed') await run();
      else await running;
    },
    async retry() {
      if (timer !== undefined) clearTimer(timer);
      timer = undefined;
      await run();
    },
    dispose() {
      disposed = true;
      if (timer !== undefined) clearTimer(timer);
      timer = undefined;
    },
    get state() {
      return state;
    },
  };
}
