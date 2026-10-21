<script lang="ts">
  // A dashboard of four tiles: a chart, a card with a link, a card that has nothing to say, and one with settings.
  // The scene is the page that owns the tiles, as the shell's start page is. `?edit` starts in edit mode.
  import { onMount } from 'svelte';
  import Counted from '../Counted.svelte';
  import {
    Chart,
    loadDashboardGrid,
    type DashboardGridComponent,
    type DashboardGridExports,
    type GridTile,
  } from '@scorpion/ui-kit';

  const names: Record<string, string> = {
    trends: 'Trends',
    cards: 'Service cards',
    quiet: 'Quiet card',
    tuned: 'Tuned card',
  };
  let tiles = $state<GridTile[]>([
    { id: 'trends', x: 0, y: 0, w: 6, h: 4, minW: 3, minH: 2, maxW: 8, maxH: 6 },
    { id: 'cards', x: 6, y: 0, w: 6, h: 3, minW: 3, minH: 2, maxW: 12, maxH: 6 },
    { id: 'quiet', x: 0, y: 4, w: 4, h: 3, minW: 3, minH: 2 },
    { id: 'tuned', x: 4, y: 4, w: 4, h: 3, minW: 3, minH: 2 },
  ]);
  const query = new URLSearchParams(window.location.search);
  let editing = $state(query.has('edit'));
  const withSettings = query.has('settings');
  let Grid = $state.raw<DashboardGridComponent>();
  let grid = $state<DashboardGridExports>();
  onMount(() => void loadDashboardGrid().then((component) => (Grid = component)));
  const changes = $state<string[]>([]);
</script>

<h1 class="mb-4 text-2xl font-bold">Dashboard</h1>
<div class="mb-4 flex gap-2">
  <button id="mode" type="button" class="btn btn-primary" onclick={() => (editing = !editing)}>
    {editing ? 'Done' : 'Customise'}
  </button>
  <button type="button" class="btn" onclick={() => grid?.announce('A message from the page')}>
    Announce
  </button>
</div>

{#if Grid}
  <Grid
    bind:this={grid}
    {tiles}
    {editing}
    label={(id: string) => names[id] ?? id}
    onchange={(next, change) => {
      tiles = next;
      changes.push(`${change.kind}:${change.id}`);
    }}
    hasSettings={(id: string) => withSettings && id === 'tuned'}
  >
    {#snippet tile(one: GridTile)}
      {#if one.id === 'trends'}
        <section class="card bg-base-100 border-base-300 border" aria-labelledby="h-trends">
          <div class="card-body gap-2 p-3">
            <h2 id="h-trends" class="card-title text-base">Trends</h2>
            <Chart
              size="sm"
              label="Services per year"
              spec={{
                type: 'line',
                categories: ['2022', '2023', '2024'],
                series: [{ name: 'Services', values: [3, 7, 12] }],
              }}
            />
          </div>
        </section>
      {:else if one.id === 'cards'}
        <section class="card bg-base-100 border-base-300 border" aria-labelledby="h-cards">
          <div class="card-body gap-2 p-3">
            <h2 id="h-cards" class="card-title text-base">Service cards</h2>
            <Counted name="cards" />
            <p class="text-3xl font-bold">42</p>
            <a class="link text-sm" href="#services">All services</a>
          </div>
        </section>
      {:else if one.id === 'tuned'}
        <section class="card bg-base-100 border-base-300 border" aria-labelledby="h-tuned">
          <div class="card-body gap-2 p-3">
            <h2 id="h-tuned" class="card-title text-base">Tuned card</h2>
            <p class="text-sm">Settings live behind the gear.</p>
          </div>
        </section>
      {/if}
    {/snippet}
    {#snippet settings(one: GridTile, close: () => void)}
      <p>The settings of {names[one.id]} would be here.</p>
      <button type="button" class="btn mt-4" onclick={close}>Close the settings</button>
    {/snippet}
  </Grid>
{:else}
  <p>Loading</p>
{/if}

<pre data-testid="layout" class="mt-4 text-xs">{JSON.stringify(
    tiles.map((tile) => [tile.id, tile.x, tile.y, tile.w, tile.h]),
  )}</pre>
<pre data-testid="changes" class="text-xs">{changes.join(' ')}</pre>
