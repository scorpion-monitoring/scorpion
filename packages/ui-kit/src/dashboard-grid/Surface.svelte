<script lang="ts">
  // The wide grid inside the dnd-kit provider: the Snapgrid container, its tiles and the translation between the
  // controlled layout and the page's tiles. It must sit under `<DragDropProvider>` (the factories resolve the
  // manager from the context), which is why it is not part of `DashboardGrid.svelte`.
  import {
    createContainerWidth,
    createGridContainer,
    verticalCompactor,
    type Layout,
    type LayoutItem,
  } from '@snapgridjs/svelte';
  import type { BodyHost } from './body-host.ts';
  import Tile from './Tile.svelte';
  import {
    GRID_COLUMNS,
    GRID_GAP,
    GRID_MAX_ROW,
    GRID_ROW_HEIGHT,
    stackedOrder,
    visibleLayout,
    type GridChange,
    type GridTile,
    type MoveDirection,
    type ResizeDirection,
  } from './layout.ts';

  let {
    tiles,
    editing,
    empty,
    reducedMotion,
    label,
    host,
    hasSettings,
    onchange,
    onmove,
    onresize,
    onremove,
    onsettings,
  }: {
    tiles: GridTile[];
    editing: boolean;
    empty: ReadonlySet<string>;
    reducedMotion: () => boolean;
    label: (id: string) => string;
    host: BodyHost<HTMLElement>;
    hasSettings: (id: string) => boolean;
    /** A drag or a resize by pointer or keyboard ended with a different layout. */
    onchange: (tiles: GridTile[], change: GridChange) => void;
    onmove: (id: string, direction: MoveDirection) => void;
    onresize: (id: string, direction: ResizeDirection) => void;
    onremove: (id: string) => void;
    onsettings: (id: string) => void;
  } = $props();

  const measure = createContainerWidth();

  // What is drawn: in view mode a tile that draws nothing has no height, so the ones below rise into its place.
  const shown = $derived(editing ? tiles : visibleLayout(tiles, empty));
  // In the DOM the tiles are in reading order, which is the order a keyboard visits them in.
  const ordered = $derived(
    stackedOrder(shown).map((placed) => tiles.find((tile) => tile.id === placed.id)!),
  );
  const layout = $derived<Layout>(
    shown.map((tile): LayoutItem => {
      const item: LayoutItem = { i: tile.id, x: tile.x, y: tile.y, w: tile.w, h: tile.h };
      if (tile.minW !== undefined) item.minW = tile.minW;
      if (tile.maxW !== undefined) item.maxW = tile.maxW;
      if (tile.minH !== undefined) item.minH = tile.minH;
      if (tile.maxH !== undefined) item.maxH = tile.maxH;
      return item;
    }),
  );

  // What the person is doing by pointer or keyboard. The grid reports a layout on every commit, and the page
  // must not treat anything but a drag or a resize as a change (a read never writes).
  let active: GridChange | undefined;
  const begin =
    (kind: GridChange['kind']) =>
    (_layout: Layout, old: LayoutItem | null, next: LayoutItem | null) => {
      const item = next ?? old;
      if (item) active = { kind, id: item.i };
    };

  function committed(next: Layout) {
    const change = active;
    active = undefined;
    if (!change) return;
    const moved = tiles.map((tile) => {
      const item = next.find((candidate) => candidate.i === tile.id);
      return item ? { ...tile, x: item.x, y: item.y, w: item.w, h: item.h } : tile;
    });
    const same = moved.every(
      (tile, index) =>
        tile.x === tiles[index]!.x &&
        tile.y === tiles[index]!.y &&
        tile.w === tiles[index]!.w &&
        tile.h === tiles[index]!.h,
    );
    if (!same) onchange(moved, change);
  }

  const container = createGridContainer(() => ({
    width: measure.width,
    layout,
    onLayoutChange: committed,
    gridConfig: {
      cols: GRID_COLUMNS,
      rowHeight: GRID_ROW_HEIGHT,
      margin: [GRID_GAP, GRID_GAP],
      containerPadding: [0, 0],
      maxRows: GRID_MAX_ROW,
    },
    compactor: verticalCompactor,
    isDraggable: editing,
    isResizable: editing,
    dragConfig: { enabled: editing },
    resizeConfig: { enabled: editing, handles: ['se'] },
    autoSize: true,
    onDragStart: begin('move'),
    onResizeStart: begin('resize'),
  }));
</script>

<div class="w-full" {@attach measure.attach}>
  {#if measure.mounted}
    <div
      {@attach container.attach}
      class="snapgrid dashboard-grid"
      class:dashboard-grid-editing={editing}
      style={container.style}
      data-drop-target={container.isDropTarget || undefined}
    >
      {#each ordered as tile (tile.id)}
        <Tile
          {tile}
          group={container.group}
          name={label(tile.id)}
          {editing}
          {reducedMotion}
          empty={empty.has(tile.id)}
          hasSettings={hasSettings(tile.id)}
          {host}
          onmove={(direction: MoveDirection) => onmove(tile.id, direction)}
          onresize={(direction: ResizeDirection) => onresize(tile.id, direction)}
          onremove={() => onremove(tile.id)}
          onsettings={() => onsettings(tile.id)}
        />
      {/each}
    </div>
  {/if}
</div>
