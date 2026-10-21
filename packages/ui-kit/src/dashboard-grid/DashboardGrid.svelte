<script lang="ts">
  // The dashboard grid (M11, ADR-0042). It draws the tiles of the page on twelve columns with Snapgrid's headless
  // API, behind this directory: nothing else in the repository imports Snapgrid or dnd-kit, so a replacement is
  // these files. Below the `md` breakpoint it draws no grid at all but a stacked list in reading order.
  //
  // In view mode the tiles are plain. In edit mode every tile has a move grip, the buttons that do what dragging
  // does (so nothing needs a pointer), a remove button and a resize handle. The page owns the tiles and what they
  // contain; this component says what changed through `onchange`, and announces it.
  //
  // The five things the prototype proved necessary are marked (ADR-0042, Decision 2): the grip and the resize
  // handle are in `Tile.svelte`; the remount on a change of mode is the `{#key}` below; reduced motion is the CSS
  // rule at the end and the per-node switch in `Tile.svelte`; below `md` there is no Snapgrid.
  import { onMount, tick } from 'svelte';
  import { SvelteSet } from 'svelte/reactivity';
  import { getShell } from '../context.ts';
  import Dialog from '../Dialog.svelte';
  import Icon from '../Icon.svelte';
  import { BodyHost } from './body-host.ts';
  import { observeEmpty } from './empty.ts';
  import {
    describeChange,
    dragAnnouncements,
    moveTile,
    removeTile,
    resizeTile,
    stackedOrder,
    type GridChange,
    type GridTexts,
    type GridTile,
    type MoveDirection,
    type ResizeDirection,
  } from './layout.ts';
  import type { DashboardGridProps } from './load.ts';
  import Provider from './Provider.svelte';
  import Surface from './Surface.svelte';

  let {
    tiles,
    editing,
    label,
    tile: body,
    onchange,
    hasSettings,
    settings,
  }: DashboardGridProps = $props();

  const { t } = getShell();

  // ---- the viewport and the user's motion preference ----------------------------------------------------------
  let wide = $state(true);
  let reduced = $state(false);
  onMount(() => {
    const width = window.matchMedia('(min-width: 48rem)');
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
    wide = width.matches;
    reduced = motion.matches;
    const onWidth = () => (wide = width.matches);
    const onMotion = () => (reduced = motion.matches);
    width.addEventListener('change', onWidth);
    motion.addEventListener('change', onMotion);
    return () => {
      width.removeEventListener('change', onWidth);
      motion.removeEventListener('change', onMotion);
    };
  });

  // The bodies are drawn once, in the parking element at the end of this component, and shown by the tiles of the
  // grid that is current: a change of mode remounts the grid and must not create the widgets again (ADR-0042).
  const bodies = new BodyHost<HTMLElement>();

  // ---- tiles that draw nothing --------------------------------------------------------------------------------
  const empty = new SvelteSet<string>();
  function setEmpty(id: string, isEmpty: boolean) {
    if (isEmpty) empty.add(id);
    else empty.delete(id);
  }
  // A removed tile's body is gone with it; its last report must not keep its place in the set.
  $effect(() => {
    const present = new Set(tiles.map((tile) => tile.id));
    for (const id of [...empty]) if (!present.has(id)) empty.delete(id);
  });

  // ---- what a screen reader hears -----------------------------------------------------------------------------
  // A no-break space makes the same text twice in a row a new message for the live region.
  const NBSP = String.fromCharCode(160);
  let announcement = $state('');
  let announceCount = 0;
  /** Says `text` in the polite live region (the same text twice in a row still counts as a new message). */
  export function announce(text: string) {
    announceCount += 1;
    announcement = announceCount % 2 === 0 ? `${text}${NBSP}` : text;
  }

  const nameOf = (id: string) => label(id);
  const texts: GridTexts = {
    moved: (name, row, column) => t('kit.dashboard.moved', { name, row, column }),
    resized: (name, width, height) => t('kit.dashboard.resized', { name, width, height }),
    pickedUp: (name) => t('kit.dashboard.pickedUp', { name }),
    cancelled: (name) => t('kit.dashboard.cancelled', { name }),
    atEdge: (name) => t('kit.dashboard.edge', { name }),
    atLimit: (name) => t('kit.dashboard.limit', { name }),
    removed: (name, count) => t('kit.dashboard.removed', { name, count }),
  };

  // dnd-kit says its pick-up and cancel in English; its plugin takes the words of the page instead (`Provider.svelte`).
  // A drop is announced by `changed()` below with the new place, so the plugin stays silent for it.
  const said = dragAnnouncements(texts, nameOf);

  // ---- changes ------------------------------------------------------------------------------------------------
  function changed(next: GridTile[], change: GridChange) {
    onchange(next, change);
    const tile = next.find((candidate) => candidate.id === change.id);
    if (tile && change.kind !== 'remove') {
      announce(describeChange(texts, nameOf(tile.id), tile, change.kind));
    }
  }

  function move(id: string, direction: MoveDirection) {
    const result = moveTile(tiles, id, direction);
    if (result.ok) changed(result.tiles, { kind: 'move', id });
    else announce(texts.atEdge(nameOf(id)));
  }

  function resize(id: string, direction: ResizeDirection) {
    const result = resizeTile(tiles, id, direction);
    if (result.ok) changed(result.tiles, { kind: 'resize', id });
    else announce(texts.atLimit(nameOf(id)));
  }

  let root = $state<HTMLElement>();

  /** Puts focus on a tile's move grip (or, with no grip, its remove button); `true` when there was one. */
  export async function focusTile(id: string): Promise<boolean> {
    await tick();
    const tileElement = [
      ...(root?.querySelectorAll<HTMLElement>('[data-grid-id], [data-tile-id]') ?? []),
    ].find((element) => (element.dataset.gridId ?? element.dataset.tileId) === id);
    const target = tileElement?.querySelector<HTMLElement>('.dashboard-grip, .dashboard-remove');
    target?.focus();
    return target !== undefined;
  }

  async function remove(id: string) {
    const name = nameOf(id);
    const order = stackedOrder(tiles);
    const at = order.findIndex((tile) => tile.id === id);
    const neighbour = order[at + 1] ?? order[at - 1];
    const next = removeTile(tiles, id);
    onchange(next, { kind: 'remove', id });
    announce(texts.removed(name, next.length));
    // Focus goes to the tile that now has the removed one's place in the reading order, never to nothing.
    if (!(neighbour && (await focusTile(neighbour.id)))) {
      await tick();
      root?.focus();
    }
  }

  // After a remount (a change of mode or of viewport) the tile that had focus is new DOM: focus is put back.
  let focusedTile: string | undefined;
  function remember(event: FocusEvent) {
    const owner = (event.target as HTMLElement | null)?.closest<HTMLElement>(
      '[data-grid-id], [data-tile-id]',
    );
    focusedTile = owner?.dataset.gridId ?? owner?.dataset.tileId;
  }
  let lastKey = '';
  $effect(() => {
    const key = `${editing}:${wide}`;
    if (key === lastKey) return;
    const restore = lastKey !== '' && focusedTile !== undefined ? focusedTile : undefined;
    lastKey = key;
    if (restore === undefined) return;
    void tick().then(async () => {
      if (document.activeElement === document.body || document.activeElement === null) {
        if (!(await focusTile(restore))) root?.focus();
      }
    });
  });

  // ---- the settings dialog (the shell of it: a widget fills it) -------------------------------------------------
  let settingsFor = $state<string>();
  const settingsTile = $derived(tiles.find((tile) => tile.id === settingsFor));
</script>

<!-- The page's tiles; a tile with a settings snippet gets a dialog. Focus returns to the gear on close. -->
<div bind:this={root} tabindex="-1" class="outline-none" onfocusin={remember}>
  {#key `${editing}:${wide}`}
    {#if wide}
      <Provider announcements={said} instructions={t('kit.dashboard.instructions')}>
        <Surface
          {tiles}
          {editing}
          {empty}
          reducedMotion={() => reduced}
          {label}
          host={bodies}
          hasSettings={(id: string) => settings !== undefined && (hasSettings?.(id) ?? false)}
          onchange={changed}
          onmove={move}
          onresize={resize}
          onremove={remove}
          onsettings={(id: string) => (settingsFor = id)}
        />
      </Provider>
    {:else}
      <!-- Below `md`: no grid, no dragging, no handles. The tiles are stacked in reading order. -->
      <ul class="flex flex-col gap-4">
        {#each stackedOrder(tiles) as tile (tile.id)}
          <li
            class="flex flex-col gap-2"
            class:hidden={empty.has(tile.id) && !editing}
            data-tile-id={tile.id}
          >
            <div
              class="flex flex-col gap-2"
              role={editing ? 'group' : undefined}
              aria-label={editing ? nameOf(tile.id) : undefined}
            >
              {#if editing}
                <div class="bg-base-200 flex items-center justify-between rounded p-1">
                  <span class="px-1 text-sm font-medium">{nameOf(tile.id)}</span>
                  <button
                    type="button"
                    class="dashboard-remove btn btn-xs btn-square btn-ghost"
                    aria-label={t('kit.dashboard.remove', { name: nameOf(tile.id) })}
                    onclick={() => remove(tile.id)}
                  >
                    <Icon name="trash" size={16} />
                  </button>
                </div>
              {/if}
              <div {@attach (node: HTMLElement) => bodies.slot(tile.id, node)}></div>
              {#if editing && empty.has(tile.id)}
                <p class="text-base-content/70 text-sm">{t('kit.dashboard.nothing')}</p>
              {/if}
            </div>
          </li>
        {/each}
      </ul>
    {/if}
  {/key}
</div>

<!-- Where the bodies wait, and are drawn once; the tiles of the current grid show them (see `body-host.ts`). -->
<div hidden {@attach (node: HTMLElement) => bodies.home(node)}>
  {#each tiles as tile (tile.id)}
    <div
      class="h-full *:h-full"
      {@attach (node: HTMLElement) => bodies.stage(tile.id, node)}
      {@attach observeEmpty((isEmpty) => setEmpty(tile.id, isEmpty))}
    >
      {@render body(tile)}
    </div>
  {/each}
</div>

<div class="sr-only" role="status" aria-live="polite" aria-atomic="true">{announcement}</div>

{#if settings && settingsTile}
  <Dialog
    open={true}
    title={t('kit.dashboard.settingsTitle', { name: nameOf(settingsTile.id) })}
    onclose={() => (settingsFor = undefined)}
  >
    {@render settings(settingsTile, () => (settingsFor = undefined))}
  </Dialog>
{/if}
