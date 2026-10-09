<script lang="ts">
  // "Are you sure?" for an action that is hard to undo (ending every session, deactivating an account).
  // Built on `Dialog`: focus is trapped, Escape cancels, and focus goes back to the button that opened it.
  // Cancel comes first in the page order so the dialog opens on the safe choice.
  import type { Snippet } from 'svelte';
  import Dialog from './Dialog.svelte';
  import { getShell } from './context.ts';

  let {
    open,
    title,
    message,
    confirmLabel,
    cancelLabel,
    tone = 'danger',
    busy = false,
    onconfirm,
    oncancel,
    children,
  }: {
    open: boolean;
    title: string;
    message: string;
    confirmLabel: string;
    cancelLabel?: string;
    tone?: 'danger' | 'primary';
    busy?: boolean;
    onconfirm: () => void;
    oncancel: () => void;
    /** More to read or fill in before confirming. */
    children?: Snippet;
  } = $props();
  const { t } = getShell();
</script>

<Dialog {open} {title} onclose={() => open && oncancel()}>
  <div class="flex flex-col gap-4">
    <p>{message}</p>
    {#if children}{@render children()}{/if}
    <div class="flex flex-wrap justify-end gap-2">
      <button type="button" class="btn" disabled={busy} onclick={oncancel}>
        {cancelLabel ?? t('kit.confirm.cancel')}
      </button>
      <button
        type="button"
        class="btn"
        class:btn-error={tone === 'danger'}
        class:btn-primary={tone === 'primary'}
        disabled={busy}
        aria-busy={busy}
        onclick={onconfirm}
      >
        {confirmLabel}
      </button>
    </div>
  </div>
</Dialog>
