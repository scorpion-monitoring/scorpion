<script lang="ts">
  // Tabs on the pattern of the ARIA authoring practices: the arrow keys move between the tabs (the
  // selection follows), Home and End go to the first and the last, and only the selected tab is in the Tab
  // order, so one Tab press goes from the list into the panel.
  import type { Snippet } from 'svelte';
  import type { TabItem } from './kit-types.ts';

  let {
    tabs,
    selected = $bindable(),
    label,
    children,
  }: {
    tabs: readonly TabItem[];
    selected?: string;
    /** The name of the tab list, for a screen reader. */
    label: string;
    /** The panel of the selected tab. */
    children: Snippet<[string]>;
  } = $props();

  const base = $props.id();
  const current = $derived(tabs.some((tab) => tab.id === selected) ? selected! : tabs[0]?.id);
  const tabId = (id: string) => `${base}-tab-${id}`;
  const panelId = (id: string) => `${base}-panel-${id}`;

  function move(event: KeyboardEvent) {
    const index = tabs.findIndex((tab) => tab.id === current);
    let target: number | undefined;
    if (event.key === 'ArrowRight') target = (index + 1) % tabs.length;
    else if (event.key === 'ArrowLeft') target = (index - 1 + tabs.length) % tabs.length;
    else if (event.key === 'Home') target = 0;
    else if (event.key === 'End') target = tabs.length - 1;
    if (target === undefined) return;
    event.preventDefault();
    selected = tabs[target]!.id;
    document.getElementById(tabId(selected))?.focus();
  }
</script>

<div class="flex flex-col gap-4">
  <div role="tablist" aria-label={label} class="tabs tabs-border" tabindex="-1" onkeydown={move}>
    {#each tabs as tab (tab.id)}
      <button
        type="button"
        role="tab"
        id={tabId(tab.id)}
        class="tab text-base-content"
        class:tab-active={tab.id === current}
        aria-selected={tab.id === current}
        aria-controls={panelId(tab.id)}
        tabindex={tab.id === current ? 0 : -1}
        onclick={() => (selected = tab.id)}
      >
        {tab.label}
      </button>
    {/each}
  </div>
  {#if current !== undefined}
    <div role="tabpanel" id={panelId(current)} aria-labelledby={tabId(current)} tabindex="0">
      {@render children(current)}
    </div>
  {/if}
</div>
