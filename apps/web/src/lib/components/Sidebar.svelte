<script lang="ts">
  import { page } from '$app/state';
  import { getShell } from '@scorpion/ui-kit';
  import Icon from './Icon.svelte';

  let {
    collapsed,
    open,
    onclose,
    ontoggle,
  }: { collapsed: boolean; open: boolean; onclose: () => void; ontoggle: () => void } = $props();

  const { t, href, navigation } = getShell();

  // The entries arrive sorted: sections in the order of their first entry, then by `order`.
  const sections = $derived.by(() => {
    const groups: { id: string; items: ReturnType<typeof navigation>['nav'] }[] = [];
    for (const item of navigation().nav) {
      let group = groups.find((candidate) => candidate.id === item.section);
      if (!group) groups.push((group = { id: item.section, items: [] }));
      group.items.push(item);
    }
    return groups;
  });
  let closed = $state<Record<string, boolean>>({});
  const current = (path: string) =>
    path === '/' ? page.url.pathname === '/' : page.url.pathname.startsWith(path);
</script>

{#if open}
  <!-- The backdrop of the small-screen drawer: a click outside closes it (the close button does too). -->
  <button
    type="button"
    class="fixed inset-0 z-20 bg-black/40 lg:hidden"
    aria-label={t('app.menu.close')}
    tabindex="-1"
    onclick={onclose}
  ></button>
{/if}

<aside
  id="sidebar"
  class="bg-base-200 border-base-300 fixed inset-y-0 start-0 z-30 flex flex-col border-e transition-transform lg:static lg:translate-x-0
    {open ? 'translate-x-0' : '-translate-x-full'} {collapsed ? 'w-16' : 'w-64'}"
>
  <div class="flex items-center justify-end gap-1 p-2 lg:hidden">
    <button
      type="button"
      class="btn btn-ghost btn-sm"
      aria-label={t('app.menu.close')}
      onclick={onclose}
    >
      <Icon name="close" />
    </button>
  </div>
  <nav aria-label={t('app.mainNav')} class="flex-1 overflow-y-auto p-2">
    {#each sections as section (section.id)}
      <div class="mb-2">
        {#if !collapsed}
          <button
            type="button"
            class="text-base-content/70 flex w-full items-center justify-between px-3 py-2 text-xs font-semibold uppercase tracking-wide"
            aria-expanded={!closed[section.id]}
            aria-controls="section-{section.id}"
            onclick={() => (closed[section.id] = !closed[section.id])}
          >
            {t(`nav.section.${section.id}`)}
            <Icon name={closed[section.id] ? 'chevronRight' : 'chevronDown'} size={14} />
          </button>
        {:else}
          <hr class="border-base-300 my-2" />
        {/if}
        <ul
          id="section-{section.id}"
          class="menu w-full gap-1 p-0"
          hidden={!collapsed && closed[section.id]}
        >
          {#each section.items as item (item.id)}
            <li>
              <a
                href={href(item.path)}
                class="{current(item.path) ? 'menu-active' : ''} {collapsed
                  ? 'tooltip tooltip-right justify-center'
                  : ''}"
                data-tip={collapsed ? t(item.label) : undefined}
                aria-current={current(item.path) ? 'page' : undefined}
                onclick={onclose}
              >
                <Icon name={item.icon ?? 'dot'} />
                <span class={collapsed ? 'sr-only' : ''}>{t(item.label)}</span>
              </a>
            </li>
          {/each}
        </ul>
      </div>
    {/each}
  </nav>
  <div class="border-base-300 hidden border-t p-2 lg:block">
    <button
      type="button"
      class="btn btn-ghost btn-sm w-full {collapsed ? 'px-0' : 'justify-start'}"
      aria-label={collapsed ? t('app.sidebar.expand') : t('app.sidebar.collapse')}
      aria-expanded={!collapsed}
      aria-controls="sidebar"
      onclick={ontoggle}
    >
      <Icon name={collapsed ? 'chevronRight' : 'chevronLeft'} />
      {#if !collapsed}{t('app.sidebar.collapse')}{/if}
    </button>
  </div>
</aside>
