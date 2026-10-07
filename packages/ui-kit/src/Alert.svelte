<script lang="ts">
  // A message in the page. An error is announced at once (`role="alert"`), the rest politely (`status`).
  import type { Snippet } from 'svelte';

  let {
    kind = 'info',
    children,
  }: { kind?: 'info' | 'success' | 'warning' | 'error'; children: Snippet } = $props();
</script>

<div
  class="alert"
  class:alert-info={kind === 'info'}
  class:alert-success={kind === 'success'}
  class:alert-warning={kind === 'warning'}
  class:alert-error={kind === 'error'}
  role={kind === 'error' ? 'alert' : 'status'}
>
  <div>{@render children()}</div>
</div>
