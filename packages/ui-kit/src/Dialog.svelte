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
  // What had focus when the dialog opened gets it back when it closes (the platform does this too, but the
  // button that opened a dialog is often disabled while the dialog is up, and is enabled again only
  // a moment after it has closed).
  let opener: Element | null = null;
  // Which element of the page had focus last: a button that starts a request is disabled before the
  // dialog opens, and a disabled button no longer has focus by then.
  let lastFocus: EventTarget | null = null;
  function remember(event: FocusEvent) {
    if (!element?.contains(event.target as Node)) lastFocus = event.target;
  }

  $effect(() => {
    if (!element) return;
    if (open && !element.open) {
      opener = lastFocus instanceof Element ? lastFocus : document.activeElement;
      element.showModal();
    }
    if (!open && element.open) element.close();
  });

  function closed() {
    const back = opener;
    opener = null;
    setTimeout(() => {
      if (back instanceof HTMLElement && back.isConnected) back.focus();
    }, 0);
    onclose();
  }
</script>

<svelte:document onfocusin={remember} />

<dialog bind:this={element} class="modal" aria-labelledby={titleId} onclose={closed}>
  <div class="modal-box">
    <h2 id={titleId} class="text-lg font-semibold">{title}</h2>
    <div class="mt-4">{@render children()}</div>
  </div>
</dialog>
