<script lang="ts">
  // One widget of a module, by the name of its `ui.widget` entry. The code is loaded in the browser when the
  // widget appears (the bell and the cards fetch their own data there), so the page itself never waits for it.
  // On the dashboard grid a widget also receives the tile's `props` (a widget that ignores them is unchanged);
  // a name this build has no code for, or code that fails to load, draws nothing and calls `onmissing`.
  import type { Component } from 'svelte';
  import { onMount } from 'svelte';
  import type { UiWidgetProps } from '@scorpion/contracts';
  import { widgetLoaders } from '#lib/widgets.ts';
  import { uiModules } from '../../generated/ui.ts';

  let { name, props, onmissing }: { name: string; props?: UiWidgetProps; onmissing?: () => void } =
    $props();

  const loaders = widgetLoaders(uiModules);
  let Loaded = $state.raw<Component<UiWidgetProps>>();
  // Until the code has arrived (or is known not to), the widget is "loading", not "has nothing to say": the dashboard
  // keeps the tile's room for that moment instead of letting its neighbours move twice.
  let loading = $state(true);

  onMount(() => {
    const load = loaders[name];
    if (!load) {
      loading = false;
      onmissing?.();
      return;
    }
    load().then(
      (module) => {
        Loaded = module.default as Component<UiWidgetProps>;
        loading = false;
      },
      () => {
        loading = false;
        onmissing?.();
      },
    );
  });
</script>

{#if loading}<span hidden data-widget-loading></span>{/if}
{#if Loaded}
  <Loaded {...props ?? ({} as UiWidgetProps)} />
{/if}
