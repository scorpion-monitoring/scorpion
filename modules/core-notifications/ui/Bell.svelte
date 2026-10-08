<script lang="ts">
  // The bell in the header: how many inbox items are unread, a dropdown with the latest ones, "Mark all read"
  // and a link to the whole inbox. The count is live while the stream of ADR-0028 is open and polled once a
  // minute when it is not (`feed.ts`); the list is fetched through the ordinary route when the menu opens and
  // whenever the count changes while it is open, so the stream itself carries no content.
  import { onMount } from 'svelte';
  import { getShell } from '@scorpion/ui-kit';
  import { unwrap } from '@scorpion/contracts/client';
  import { createInboxFeed } from './feed.ts';
  import { linkOf } from './prefs.ts';

  interface Item {
    id: string;
    title: string;
    text: string;
    link: string | null;
    createdAt: string;
    readAt: string | null;
  }

  const { t, href, api } = getShell();
  let count = $state<number>();
  let open = $state(false);
  let items = $state<Item[]>();
  let failed = $state(false);
  let busy = $state(false);
  let root = $state<HTMLElement>();
  const menuId = $props.id();

  async function loadItems() {
    try {
      const answer = await unwrap(
        api.GET('/notifications/inbox', { params: { query: { pageSize: '5' } } }),
      );
      items = answer.result;
      failed = false;
    } catch {
      failed = true;
    }
  }

  onMount(() => {
    const feed = createInboxFeed({
      openStream: ({ count: said, fail }) => {
        if (typeof EventSource === 'undefined') {
          fail();
          return () => undefined;
        }
        const source = new EventSource(href('/api/internal/inbox/stream'));
        source.addEventListener('unread', (event) => {
          const parsed = JSON.parse((event as MessageEvent<string>).data) as { count?: unknown };
          if (typeof parsed.count === 'number') said(parsed.count);
        });
        // The browser would reconnect by itself; the feed decides instead (poll now, stream again later).
        source.onerror = () => fail();
        return () => source.close();
      },
      poll: async () => (await unwrap(api.GET('/notifications/inbox/unread-count'))).count,
      onCount: (n) => {
        const changed = count !== undefined && n !== count;
        count = n;
        if (changed && open) void loadItems();
      },
    });
    feed.start();
    return () => feed.stop();
  });

  async function toggle() {
    open = !open;
    if (open) await loadItems();
  }

  async function markRead(item: Item) {
    busy = true;
    try {
      await unwrap(
        api.POST('/notifications/inbox/{id}/read', { params: { path: { id: item.id } } }),
      );
      await loadItems();
      count = Math.max(0, (count ?? 1) - (item.readAt === null ? 1 : 0));
    } catch {
      failed = true;
    } finally {
      busy = false;
    }
  }

  async function markAll() {
    busy = true;
    try {
      await unwrap(api.POST('/notifications/inbox/read-all'));
      count = 0;
      await loadItems();
    } catch {
      failed = true;
    } finally {
      busy = false;
    }
  }

  function outside(event: MouseEvent) {
    if (open && root && !root.contains(event.target as Node)) open = false;
  }

  function onkeydown(event: KeyboardEvent) {
    if (event.key === 'Escape' && open) {
      open = false;
      root?.querySelector('button')?.focus();
    }
  }

  const label = $derived(count ? t('inbox.bell.labelCount', { count }) : t('inbox.bell.label'));
  const origin = () =>
    typeof window === 'undefined' ? 'http://localhost' : window.location.origin;
</script>

<svelte:window onclick={outside} {onkeydown} />

<div class="relative" bind:this={root}>
  <button
    type="button"
    class="btn btn-ghost btn-sm relative"
    aria-haspopup="true"
    aria-expanded={open}
    aria-controls={menuId}
    aria-label={label}
    onclick={toggle}
  >
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.75"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      <path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15zM10 20a2 2 0 0 0 4 0" />
    </svg>
    {#if count}
      <span class="badge badge-primary badge-sm absolute -end-1 -top-1" aria-hidden="true">
        {count > 99 ? '99+' : count}
      </span>
    {/if}
  </button>
  <!-- A polite announcement when the number changes while the person is on the page. -->
  <span class="sr-only" aria-live="polite">{count ? t('inbox.bell.announce', { count }) : ''}</span>
  {#if open}
    <div
      id={menuId}
      role="region"
      aria-label={t('inbox.title')}
      class="bg-base-100 border-base-300 absolute end-0 z-30 mt-2 w-80 max-w-[90vw] rounded-box border p-2 shadow-lg"
    >
      <div class="flex items-center justify-between px-2 py-1">
        <h2 class="font-semibold">{t('inbox.title')}</h2>
        <button
          type="button"
          class="btn btn-ghost btn-xs"
          disabled={busy || !count}
          onclick={markAll}
        >
          {t('inbox.markAll')}
        </button>
      </div>
      {#if failed}
        <p class="text-error px-2 py-2 text-sm" role="alert">{t('inbox.loadFailed')}</p>
      {:else if items === undefined}
        <p class="px-2 py-2 text-sm">{t('inbox.loading')}</p>
      {:else if items.length === 0}
        <p class="px-2 py-2 text-sm">{t('inbox.empty')}</p>
      {:else}
        <ul class="flex flex-col">
          {#each items as item (item.id)}
            <!-- A link of an item is an address of this site (it already holds the base path) or an outside one. -->
            {@const link = linkOf(item.link, origin())}
            <li class="border-base-200 border-t px-2 py-2 first:border-t-0">
              <p class:font-semibold={item.readAt === null}>{item.title}</p>
              <p class="line-clamp-2 text-sm opacity-80">{item.text}</p>
              <div class="mt-1 flex gap-2">
                {#if link}
                  <a
                    class="link text-sm"
                    href={link.href}
                    rel={link.external ? 'noopener noreferrer' : undefined}
                    target={link.external ? '_blank' : undefined}
                  >
                    {t('inbox.open')}
                  </a>
                {/if}
                {#if item.readAt === null}
                  <button
                    type="button"
                    class="btn btn-ghost btn-xs"
                    disabled={busy}
                    aria-label={t('inbox.markReadNamed', { title: item.title })}
                    onclick={() => markRead(item)}
                  >
                    {t('inbox.markRead')}
                  </button>
                {/if}
              </div>
            </li>
          {/each}
        </ul>
      {/if}
      <div class="border-base-200 border-t px-2 pt-2">
        <a class="link text-sm" href={href('/inbox')} onclick={() => (open = false)}>
          {t('inbox.seeAll')}
        </a>
      </div>
    </div>
  {/if}
</div>
