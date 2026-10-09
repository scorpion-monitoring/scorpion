<script lang="ts">
  // One widget of a module, by the name of its `ui.widget` entry. The code is loaded in the browser when the
  // widget appears (the bell and the cards fetch their own data there), so the page itself never waits for it.
  import type { Component } from 'svelte';
  import { onMount } from 'svelte';
  import { widgetLoaders } from '#lib/widgets.ts';
  import { uiModules } from '../../generated/ui.ts';

  let { name }: { name: string } = $props();

  const loaders = widgetLoaders(uiModules);
  let Loaded = $state.raw<Component<Record<string, never>>>();

  onMount(() => {
    const load = loaders[name];
    if (!load) return;
    void load().then((module) => {
      Loaded = module.default;
    });
  });
</script>

{#if Loaded}<Loaded />{/if}
