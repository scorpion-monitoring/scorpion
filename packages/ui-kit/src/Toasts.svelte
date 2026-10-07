<script lang="ts">
  // The toasts of the page: short messages that appear when something has happened (a save worked, a
  // request failed) and go by themselves, except an error, which stays until it is closed. The region
  // is always in the page, so a screen reader that has seen it announces what is added; an error is
  // announced at once (`role="alert"`), the rest politely.
  import type { Toaster, Toast } from './toaster.ts';
  import { getShell } from './context.ts';

  let { toaster }: { toaster: Toaster } = $props();
  const { t } = getShell();

  let toasts = $state<readonly Toast[]>([]);
  $effect(() => toaster.subscribe((next) => (toasts = next)));
</script>

<div
  class="pointer-events-none fixed end-4 bottom-4 z-50 flex w-full max-w-sm flex-col gap-2"
  role="region"
  aria-label={t('kit.toast.region')}
>
  <div aria-live="polite" aria-atomic="false" class="flex flex-col gap-2">
    {#each toasts.filter((toast) => toast.kind !== 'error') as toast (toast.id)}
      <div
        class="alert pointer-events-auto"
        class:alert-success={toast.kind === 'success'}
        class:alert-info={toast.kind === 'info'}
      >
        <span>{toast.text}</span>
        <button
          type="button"
          class="btn btn-ghost btn-xs"
          aria-label={t('kit.toast.dismiss')}
          onclick={() => toaster.dismiss(toast.id)}
        >
          <span aria-hidden="true">×</span>
        </button>
      </div>
    {/each}
  </div>
  {#each toasts.filter((toast) => toast.kind === 'error') as toast (toast.id)}
    <div class="alert alert-error pointer-events-auto" role="alert">
      <span>{toast.text}</span>
      <button
        type="button"
        class="btn btn-ghost btn-xs"
        aria-label={t('kit.toast.dismiss')}
        onclick={() => toaster.dismiss(toast.id)}
      >
        <span aria-hidden="true">×</span>
      </button>
    </div>
  {/each}
</div>
