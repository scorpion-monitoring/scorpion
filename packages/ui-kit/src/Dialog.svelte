<script lang="ts">
  // A modal dialog on the platform's `<dialog>`: the browser traps focus, makes the rest of the page
  // inert, closes on Escape, and returns focus to what opened it. `onclose` runs for every way it closes.
  import type { Snippet } from 'svelte';

  let {
    open,
    title,
    onclose,
    children,
  }: { open: boolean; title: string; onclose: () => void; children: Snippet } = $props();

  let element = $state<HTMLDialogElement>();
  const titleId = $props.id();

  $effect(() => {
    if (!element) return;
    if (open && !element.open) element.showModal();
    if (!open && element.open) element.close();
  });
</script>

<dialog bind:this={element} class="modal" aria-labelledby={titleId} {onclose}>
  <div class="modal-box">
    <h2 id={titleId} class="text-lg font-semibold">{title}</h2>
    <div class="mt-4">{@render children()}</div>
  </div>
</dialog>
