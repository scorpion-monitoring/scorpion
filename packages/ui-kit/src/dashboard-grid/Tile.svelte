<script lang="ts">
  // One tile of the wide grid: the headless Snapgrid item, the move grip, the buttons that do what dragging does,
  // the resize handle and the tile's body. It is the part of the adapter that touches a tile's DOM; the rules of
  // a move live in `layout.ts`. See ADR-0042, Decision 2, for why each piece is the way it is.
  import { createGridItem, createGridResizeHandle } from '@snapgridjs/svelte';
  import { getShell } from '../context.ts';
  import Icon from '../Icon.svelte';
  import type { BodyHost } from './body-host.ts';
  import type { GridTile, MoveDirection, ResizeDirection } from './layout.ts';

  let {
    tile,
    group,
    name,
    editing,
    reducedMotion,
    empty,
    hasSettings,
    host,
    onmove,
    onresize,
    onremove,
    onsettings,
  }: {
    tile: GridTile;
    /** The grid's id: Snapgrid resolves the controller by it. */
    group: string;
    name: string;
    editing: boolean;
    reducedMotion: () => boolean;
    /** The body draws nothing. In view mode the tile then takes no room; in edit mode it stays, so it can be removed. */
    empty: boolean;
    hasSettings: boolean;
    /** Where the tile's body is drawn once and shown; see `body-host.ts`. */
    host: BodyHost<HTMLElement>;
    onmove: (direction: MoveDirection) => void;
    onresize: (direction: ResizeDirection) => void;
    onremove: () => void;
    onsettings: () => void;
  } = $props();

  const { t } = getShell();

  // The tile's id and the grid's are fixed for the life of the component (the grid keys its tiles by id).
  // svelte-ignore state_referenced_locally
  const item = createGridItem({ id: tile.id, group });
  // svelte-ignore state_referenced_locally
  const resize = createGridResizeHandle({ id: tile.id, handle: 'se', group });

  // Snapgrid moves a tile with the Web Animations API when it can. Under reduced motion it must not: with no
  // `animate` on the element it falls back to an instant move (and the CSS rule of DashboardGrid stops the
  // size transition).
  function attachTile(node: HTMLElement) {
    const cleanup = item.attach(node);
    if (reducedMotion())
      Object.defineProperty(node, 'animate', { value: undefined, configurable: true });
    return () => {
      cleanup?.();
      delete (node as { animate?: unknown }).animate;
    };
  }

  // dnd-kit gives a draggable's activator a role, a tabindex and the keyboard sensor only where it has none,
  // so the handle is a named, unfocusable-by-Tab element before it is attached.
  function attachResize(node: HTMLElement) {
    node.setAttribute('role', 'presentation');
    node.setAttribute('tabindex', '-1');
    node.setAttribute('aria-hidden', 'true');
    return resize.attach(node);
  }

  const buttons: { direction: MoveDirection; key: string; icon: string }[] = [
    { direction: 'left', key: 'kit.dashboard.moveLeft', icon: 'arrowLeft' },
    { direction: 'right', key: 'kit.dashboard.moveRight', icon: 'arrowRight' },
    { direction: 'up', key: 'kit.dashboard.moveUp', icon: 'arrowUp' },
    { direction: 'down', key: 'kit.dashboard.moveDown', icon: 'arrowDown' },
  ];
  const sizes: { direction: ResizeDirection; key: string; icon: string }[] = [
    { direction: 'wider', key: 'kit.dashboard.wider', icon: 'wider' },
    { direction: 'narrower', key: 'kit.dashboard.narrower', icon: 'narrower' },
    { direction: 'taller', key: 'kit.dashboard.taller', icon: 'taller' },
    { direction: 'shorter', key: 'kit.dashboard.shorter', icon: 'shorter' },
  ];
  const button = 'btn btn-xs btn-square btn-ghost';
</script>

<div
  {@attach attachTile}
  data-grid-id={tile.id}
  data-dragging={item.isDragging || undefined}
  class={[
    'snapgrid-item dashboard-tile box-border data-[dragging]:z-[5] data-[dragging]:opacity-90 motion-reduce:transition-none!',
    editing &&
      'dashboard-tile-editing outline-primary rounded-box bg-base-100 p-1 outline-2 outline-offset-2 outline-dashed',
    empty && !editing && 'hidden',
  ]}
  role={editing ? 'group' : undefined}
  aria-label={editing ? name : undefined}
  style={item.style}
>
  <div class="flex h-full min-h-0 flex-col gap-2">
    {#if editing}
      <div
        class="bg-base-200 flex flex-wrap items-center gap-1 rounded p-1"
        role="group"
        aria-label={t('kit.dashboard.group', { name })}
      >
        <button
          type="button"
          class="{button} dashboard-grip cursor-grab"
          aria-label={t('kit.dashboard.move', { name })}
          aria-roledescription={t('kit.dashboard.roleDescription')}
          {@attach item.attachHandle}
        >
          <Icon name="move" size={16} />
        </button>
        <span role="group" class="flex" aria-label={t('kit.dashboard.positionGroup', { name })}>
          {#each buttons as { direction, key, icon } (direction)}
            <button
              type="button"
              class={button}
              aria-label={t(key, { name })}
              onclick={() => onmove(direction)}
            >
              <Icon name={icon} size={16} />
            </button>
          {/each}
        </span>
        <span role="group" class="flex" aria-label={t('kit.dashboard.sizeGroup', { name })}>
          {#each sizes as { direction, key, icon } (direction)}
            <button
              type="button"
              class={button}
              aria-label={t(key, { name })}
              onclick={() => onresize(direction)}
            >
              <Icon name={icon} size={16} />
            </button>
          {/each}
        </span>
        {#if hasSettings}
          <button
            type="button"
            class={button}
            aria-label={t('kit.dashboard.settings', { name })}
            onclick={onsettings}
          >
            <Icon name="cog" size={16} />
          </button>
        {/if}
        <button
          type="button"
          class="{button} ms-auto"
          aria-label={t('kit.dashboard.remove', { name })}
          onclick={onremove}
        >
          <Icon name="trash" size={16} />
        </button>
      </div>
    {:else}
      <!-- View mode: the draggable still needs its activator, and dnd-kit gives that element a role and a tab stop. A
           handle that is not drawn takes them, so the tile (and the links in it) stay what they are. -->
      <span hidden {@attach item.attachHandle}></span>
    {/if}
    <div
      class="min-h-0 flex-1 overflow-auto"
      {@attach (node: HTMLElement) => host.slot(tile.id, node)}
    ></div>
    {#if editing && empty}
      <!-- The body's own state (nothing to draw) is judged from its elements, so this note is a sibling. -->
      <p class="text-base-content/70 text-sm">{t('kit.dashboard.nothing')}</p>
    {/if}
  </div>
  {#if editing}
    <span
      {@attach attachResize}
      {...resize.handleProps}
      class="dashboard-resize border-primary rounded-ee-box absolute end-0 bottom-0 z-[4] size-6 cursor-nwse-resize touch-none border-e-[3px] border-b-[3px]"
      data-resizing={resize.isResizing || undefined}
    ></span>
  {/if}
</div>
