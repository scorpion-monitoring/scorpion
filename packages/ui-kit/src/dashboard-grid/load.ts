// How the page gets the grid: a dynamic import, so Snapgrid and dnd-kit (about 134 kB) are fetched on the start page
// and on no other. The component and what it exposes are typed here, so the code that uses them does not depend on
// the library behind the import (ADR-0042, Decision 2).
import type { Component, Snippet } from 'svelte';
import type { GridChange, GridTile } from './layout.ts';

export interface DashboardGridProps {
  /** Where the tiles are. The page owns them; the grid never changes them itself. */
  tiles: GridTile[];
  editing: boolean;
  /** The name of a tile for people and screen readers: its widget's label. */
  label: (id: string) => string;
  /** Draws a tile's body. */
  tile: Snippet<[GridTile]>;
  onchange: (tiles: GridTile[], change: GridChange) => void;
  /** Whether a tile has settings (it then gets a gear that opens `settings` in a dialog). Default: none. */
  hasSettings?: (id: string) => boolean;
  /** Told how many tiles draw something now (tiles whose body has no element do not count), at first and on every change. */
  ondrawn?: (count: number) => void;
  settings?: Snippet<[GridTile, () => void]>;
}

export interface DashboardGridExports {
  /** Puts focus on a tile's move grip; `false` when the tile is not there. */
  focusTile: (id: string) => Promise<boolean>;
  /** Says something in the grid's polite live region. */
  announce: (text: string) => void;
}

export type DashboardGridComponent = Component<DashboardGridProps, DashboardGridExports>;

export async function loadDashboardGrid(): Promise<DashboardGridComponent> {
  return (await import('./DashboardGrid.svelte')).default as unknown as DashboardGridComponent;
}
