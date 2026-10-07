<script lang="ts">
  // The submit button of a form. It stays disabled until the page has been made interactive, so a form
  // can never be sent by the browser itself before the script that handles it is there: a native
  // submit would put the fields (a password) in the address. It is also disabled while a request runs.
  import { onMount, type Snippet } from 'svelte';

  let {
    busy = false,
    variant = 'primary',
    children,
  }: { busy?: boolean; variant?: 'primary' | 'error' | 'ghost'; children: Snippet } = $props();

  let ready = $state(false);
  onMount(() => {
    ready = true;
  });
</script>

<button
  type="submit"
  class="btn"
  class:btn-primary={variant === 'primary'}
  class:btn-error={variant === 'error'}
  class:btn-ghost={variant === 'ghost'}
  disabled={!ready || busy}
  aria-busy={busy}
>
  {@render children()}
</button>
