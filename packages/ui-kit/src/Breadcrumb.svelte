<script lang="ts">
  // Where the page sits in the site. Every item but the last is a link (build them with `href()`); the
  // last one is the page itself and says so (`aria-current`).
  import { getShell } from './context.ts';
  import type { Crumb } from './kit-types.ts';

  let { items }: { items: readonly Crumb[] } = $props();
  const { t } = getShell();
</script>

<nav aria-label={t('kit.breadcrumb.label')} class="breadcrumbs text-sm">
  <ol>
    {#each items as item, index (index)}
      <li>
        {#if item.href && index < items.length - 1}
          <a href={item.href}>{item.label}</a>
        {:else}
          <span aria-current={index === items.length - 1 ? 'page' : undefined}>{item.label}</span>
        {/if}
      </li>
    {/each}
  </ol>
</nav>
