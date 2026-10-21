<script lang="ts">
  // The signed-in person's dashboard on the start page: the widget grid, the FAB menu that adds widgets and turns
  // edit mode on, and the saving. The page's `load` read the document on the server (`GET /ui/dashboard`: the
  // server's repaired document is the only source, nothing here decides what a person may see), so opening the
  // page sends no request for it and never writes. The first `PUT` happens after a real change, one burst a second.
  // Two tabs: the last save wins; there is no revision.
  import { onDestroy, onMount, tick } from 'svelte';
  import { unwrap } from '@scorpion/contracts/client';
  import {
    Alert,
    getShell,
    Icon,
    loadDashboardGrid,
    placeNew,
    type DashboardGridComponent,
    type DashboardGridExports,
    type GridTile,
  } from '@scorpion/ui-kit';
  import {
    applyTiles,
    canAdd,
    createAutosave,
    defaultItems,
    newItem,
    placeable,
    problemOf,
    toTiles,
    type DashboardView,
    type Entry,
    type Item,
    type SaveProblem,
    type SaveState,
  } from './dashboard.ts';

  let { initial }: { initial: DashboardView } = $props();

  const { t, api, navigation, Widget } = getShell();

  // The grid's code (Snapgrid and dnd-kit, about 134 kB) is fetched here, on the start page, and nowhere else.
  let Grid = $state.raw<DashboardGridComponent>();
  let grid = $state<DashboardGridExports>();
  let loadFailed = $state(false);
  onMount(() => {
    loadDashboardGrid().then(
      (component) => (Grid = component),
      () => (loadFailed = true),
    );
  });

  // ---- what the server says may be placed -------------------------------------------------------------------------
  const entries = $derived(placeable(navigation()));
  const byId = $derived(new Map(entries.map((entry) => [entry.id, entry])));
  const nameOfEntry = (entry: Entry | undefined, fallback: string) =>
    entry?.label ? t(entry.label) : fallback;

  // ---- the dashboard -----------------------------------------------------------------------------------------------
  // svelte-ignore state_referenced_locally
  let items = $state<Item[]>(initial.items);
  let editing = $state(false);
  let open = $state(false);
  const tiles = $derived(toTiles(items, byId));
  const nameOf = (id: string) => {
    const item = items.find((candidate) => candidate.id === id);
    return nameOfEntry(item ? byId.get(item.widget) : undefined, item?.widget ?? id);
  };

  // How many tiles draw something, as the grid reports it; nothing is known until it has.
  let drawn = $state(0);

  // What the load said it left out, shown until the next successful save has written the repaired document.
  // svelte-ignore state_referenced_locally
  let notice = $state<{ dropped: number; reset: boolean }>({
    dropped: initial.dropped.length,
    reset: initial.reset,
  });

  // A tile whose widget this build has no code for draws nothing; it is counted and reported, never a crash.
  let missing = $state<string[]>([]);
  function reportMissing(widget: string) {
    if (missing.includes(widget)) return;
    missing.push(widget);
    console.warn(`The dashboard has a widget this page cannot draw: ${widget}`);
  }

  // ---- saving ------------------------------------------------------------------------------------------------------
  let saveState = $state<SaveState>('idle');
  let problem = $state<SaveProblem>();

  async function reload() {
    // A 422 named a tile the server will not keep (its widget is gone, or the right to it): the repaired
    // document is read again and shown, and the person is told.
    const view = await unwrap(api.GET('/ui/dashboard'));
    items = view.items;
    notice = { dropped: view.dropped.length, reset: view.reset };
  }

  const saver = createAutosave<Item[]>({
    save: async (value) => {
      await unwrap(api.PUT('/ui/dashboard', { body: { items: value } }));
      problem = undefined;
      notice = { dropped: 0, reset: false };
    },
    onState: (state, error) => {
      saveState = state;
      if (state === 'failed') {
        problem = problemOf(error);
        if (problem === 'repair') {
          void reload().then(
            () => {
              saveState = 'idle';
              grid?.announce(t('dashboard.error.repaired'));
            },
            () => (problem = 'failed'),
          );
        }
      }
    },
  });

  function changeItems(next: Item[]) {
    items = next;
    saver.schedule($state.snapshot(next));
  }

  // Leaving the page (a link, a closed tab, a hidden page) sends what is waiting; the component going away does
  // too, which is what a client-side navigation does.
  function hide() {
    if (document.visibilityState === 'hidden') void saver.flush();
  }
  onDestroy(() => {
    void saver.flush().finally(() => saver.dispose());
  });

  // ---- changes from the grid -----------------------------------------------------------------------------------
  function onchange(next: GridTile[]) {
    changeItems(applyTiles(items, next));
  }

  // ---- the FAB menu --------------------------------------------------------------------------------------------
  let trigger = $state<HTMLElement>();
  let fab = $state<HTMLElement>();
  const menuId = $props.id();

  function toggle() {
    if (open) {
      open = false;
    } else {
      editing = true;
      open = true;
    }
  }

  function close(focus = true) {
    open = false;
    if (focus) trigger?.focus();
  }

  function onFabKey(event: KeyboardEvent) {
    if (event.key === 'Escape' && open) {
      event.preventDefault();
      event.stopPropagation();
      close();
    }
  }

  function onTriggerKey(event: KeyboardEvent) {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      toggle();
    }
  }

  // A press outside the FAB closes the menu; focus stays where the person put it.
  function onPress(event: PointerEvent) {
    if (open && fab && !fab.contains(event.target as Node)) close(false);
  }

  async function add(entry: Entry) {
    if (!canAdd(entry, items).ok) return;
    const fresh = newItem(entry, items, placeNew(tiles));
    changeItems([...items, fresh]);
    open = false;
    const name = nameOfEntry(entry, entry.id);
    await tick();
    await grid?.focusTile(fresh.id);
    grid?.announce(t('dashboard.added', { name, row: fresh.y + 1, column: fresh.x + 1 }));
  }

  async function reset() {
    // The default is shown, not stored: it is saved with the next change (M11 plan §3).
    items = defaultItems(entries);
    open = false;
    notice = { dropped: 0, reset: false };
    await tick();
    trigger?.focus();
    grid?.announce(t('dashboard.resetDone'));
  }

  async function done() {
    editing = false;
    open = false;
    await tick();
    trigger?.focus();
    void saver.flush();
  }

  const reasonOf = (entry: Entry) => {
    const check = canAdd(entry, items);
    return check.ok ? undefined : check.reason;
  };
  const addLabel = (entry: Entry) => {
    const name = nameOfEntry(entry, entry.id);
    const reason = reasonOf(entry);
    if (reason === 'singleton') return t('dashboard.alreadyThere', { name });
    if (reason === 'full') return t('dashboard.full', { name });
    return t('dashboard.addWidget', { name });
  };

  const collapsed = $derived(!editing && tiles.length > 0 && drawn === 0);
  const hasMessage = $derived(
    notice.reset ||
      notice.dropped > 0 ||
      missing.length > 0 ||
      loadFailed ||
      (problem !== undefined && saveState === 'failed'),
  );

  const status = $derived(
    saveState === 'pending'
      ? t('dashboard.pending')
      : saveState === 'saving'
        ? t('dashboard.saving')
        : saveState === 'saved'
          ? t('dashboard.saved')
          : '',
  );
  const errorText = $derived(
    problem === 'forbidden'
      ? t('dashboard.error.forbidden')
      : problem === 'too-large'
        ? t('dashboard.error.tooLarge')
        : problem === 'failed' || problem === 'repair'
          ? t('dashboard.error.failed')
          : '',
  );
</script>

<svelte:window
  onpointerdown={onPress}
  onvisibilitychange={hide}
  onpagehide={() => void saver.flush()}
/>

<!-- With nothing to draw (every widget has nothing to say, or none has loaded yet) and no edit in progress, the heading and
     the grid are not shown, as the start page never showed an empty "What needs your attention". The grid is still
     there, hidden, so it knows when a widget has something to say. Messages (what was left out, a failed save) stay. -->
<section
  class={['flex flex-col gap-4', collapsed ? (hasMessage ? 'mt-8' : 'hidden') : 'mt-8 pb-28']}
  aria-labelledby="dashboard-title"
>
  <div class={['flex flex-wrap items-baseline justify-between gap-2', collapsed && 'hidden']}>
    <h2 id="dashboard-title" class="text-xl font-semibold">{t('home.dashboard')}</h2>
    <p class="text-base-content/70 text-sm" role="status" aria-live="polite">{status}</p>
  </div>

  {#if editing}
    <p class="text-sm">{t('dashboard.editing')}</p>
  {/if}

  {#if notice.reset}
    <Alert kind="warning">{t('dashboard.notice.reset')}</Alert>
  {:else if notice.dropped > 0}
    <Alert kind="warning">{t('dashboard.notice.dropped', { count: notice.dropped })}</Alert>
  {/if}
  {#if missing.length > 0}
    <Alert kind="warning">{t('dashboard.notice.missing', { count: missing.length })}</Alert>
  {/if}
  {#if problem !== undefined && saveState === 'failed'}
    <Alert kind="error">
      <span>{errorText}</span>
      <button type="button" class="btn btn-sm ms-2" onclick={() => void saver.retry()}>
        {t('dashboard.retry')}
      </button>
    </Alert>
  {/if}

  {#if loadFailed}
    <Alert kind="error">{t('dashboard.error.failed')}</Alert>
  {:else if Grid}
    {#if tiles.length === 0}
      <p class="text-base-content/70">{t('dashboard.empty')}</p>
    {/if}
    <div class={[collapsed && 'hidden']}>
      <Grid
        bind:this={grid}
        {tiles}
        {editing}
        label={nameOf}
        {onchange}
        ondrawn={(count) => (drawn = count)}
      >
        {#snippet tile(one: GridTile)}
          {@const item = items.find((candidate) => candidate.id === one.id)}
          {#if item}
            <Widget
              name={byId.get(item.widget)?.component ?? ''}
              props={{
                instance: item.id,
                config: item.config,
                editing,
                setConfig: (next) =>
                  changeItems(
                    items.map((it) => (it.id === item.id ? { ...it, config: next } : it)),
                  ),
                size: { w: item.w, h: item.h },
              }}
              onmissing={() => reportMissing(item.widget)}
            />
          {/if}
        {/snippet}
      </Grid>
    </div>
  {/if}
</section>

<!-- Space is reserved at the end of the section (`pb-28`) so the button never covers what it edits. -->
<div
  bind:this={fab}
  class="fab dashboard-fab"
  data-open={open || undefined}
  onkeydown={onFabKey}
  role="presentation"
>
  <div
    bind:this={trigger}
    role="button"
    tabindex="0"
    class="btn btn-primary btn-lg btn-circle"
    aria-label={t('dashboard.customise')}
    aria-haspopup="true"
    aria-expanded={open}
    aria-controls={menuId}
    onclick={toggle}
    onkeydown={onTriggerKey}
  >
    <Icon name="edit" size={24} />
  </div>
  <div id={menuId} role="group" aria-label={t('dashboard.menu')} class="flex-col !items-end">
    {#each entries as entry (entry.id)}
      {@const reason = reasonOf(entry)}
      <button
        type="button"
        class="btn btn-neutral btn-sm"
        disabled={reason !== undefined}
        onclick={() => add(entry)}
      >
        {#if entry.icon}<Icon name={entry.icon} size={16} />{/if}
        {addLabel(entry)}
      </button>
    {:else}
      <p class="bg-base-100 rounded p-2 text-sm">{t('dashboard.nothingToAdd')}</p>
    {/each}
    <button type="button" class="btn btn-neutral btn-sm" onclick={reset}>
      <Icon name="refresh" size={16} />
      {t('dashboard.reset')}
    </button>
    <button type="button" class="btn btn-primary btn-sm" onclick={done}>
      <Icon name="check" size={16} />
      {t('dashboard.done')}
    </button>
  </div>
</div>

<style>
  /* daisyUI's FAB shows its buttons while focus is inside it and has no way to close with the focus kept on the
     trigger, so the menu follows `data-open` (Escape, Done and a press outside close it). */
  .dashboard-fab > :global(:nth-child(n + 2)) {
    visibility: hidden;
    opacity: 0;
    pointer-events: none;
  }
  .dashboard-fab[data-open] > :global(:nth-child(n + 2)) {
    visibility: visible;
    opacity: 1;
    scale: 100%;
    pointer-events: auto;
  }
  .dashboard-fab > :global([tabindex]:first-child) {
    pointer-events: auto;
  }
  @media (prefers-reduced-motion: reduce) {
    .dashboard-fab,
    .dashboard-fab > :global(*) {
      transition: none !important;
    }
  }
</style>
