<script lang="ts">
  import { getShell } from './context.ts';
  import Icon from './Icon.svelte';

  // A person's profile picture beside their name (the header, a table row). `hash` is the SHA-256 the API gives as
  // `avatarHash`; without one, or when the file does not load, the `user` icon stands in. Always decorative: the name
  // next to it says who it is, so a screen reader does not hear it twice. Sizes are classes, never inline style (the
  // page's policy allows none, ADR-0051).
  let { hash, size = 'sm' }: { hash: string | null | undefined; size?: 'sm' | 'md' } = $props();

  const { href } = getShell();
  const box = $derived(size === 'md' ? 'h-6 w-6' : 'h-5 w-5');
  let failed = $state(false);
  let img = $state<HTMLImageElement>();
  // A new picture is a new hash: try to load it again.
  $effect(() => {
    void hash;
    failed = false;
  });
  // On a page the server rendered, the file can fail before the component is hydrated, and that `error` event is
  // gone: an image that has finished loading without any pixels failed too.
  $effect(() => {
    if (img?.complete && img.naturalWidth === 0) failed = true;
  });
</script>

{#if hash && !failed}
  <img
    bind:this={img}
    class="inline-block shrink-0 rounded-full object-cover {box}"
    src={href(`/api/internal/files/${hash}`)}
    alt=""
    loading="lazy"
    decoding="async"
    data-testid="user-avatar"
    onerror={() => (failed = true)}
  />
{:else}
  <span class="inline-flex shrink-0" data-testid="user-avatar-fallback">
    <Icon name="user" size={size === 'md' ? 18 : 16} />
  </span>
{/if}
