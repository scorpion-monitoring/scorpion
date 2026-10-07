<script lang="ts">
  // Where the page sits in the site. Every item but the last is a link (build them with `href()`); the
  // last one is the page itself and says so (`aria-current`).
  import { getShell } from './context.ts';
  import type { Crumb } from './kit-types.ts';
  import { crumbViews } from './tabs.ts';

  let { items }: { items: readonly Crumb[] } = $props();
  const { t } = getShell();
  const views = $derived(crumbViews(items));
</script>

<nav aria-label={t('kit.breadcrumb.label')} class="breadcrumbs text-sm">
  <ol>
    {#each views as view, index (index)}
      <li>
        {#if view.href}
          <a href={view.href}>{view.label}</a>
        {:else}
          <span aria-current={view.current ? 'page' : undefined}>{view.label}</span>
        {/if}
      </li>
    {/each}
  </ol>
</nav>
