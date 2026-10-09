<script lang="ts">
  // A moment in the person's language and time zone. The server renders the date in UTC, the browser
  // replaces it once the page is interactive, so the markup the two produce is the same and hydration
  // never meets a different text.
  import { onMount } from 'svelte';
  import { getShell } from './context.ts';

  let { iso }: { iso: string } = $props();
  const { locale } = getShell();

  let local = $state<string>();
  onMount(() => {
    local = new Intl.DateTimeFormat(locale(), { dateStyle: 'medium', timeStyle: 'short' }).format(
      new Date(iso),
    );
  });
</script>

<time datetime={iso}>{local ?? iso.slice(0, 10)}</time>
