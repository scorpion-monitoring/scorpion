<script lang="ts">
  // Counts how often a widget body is created, for the specs: a change of mode must not create it again.
  import { onMount } from 'svelte';

  let { name }: { name: string } = $props();
  onMount(() => {
    const counts = ((window as unknown as { __mounts?: Record<string, number> }).__mounts ??= {});
    counts[name] = (counts[name] ?? 0) + 1;
  });
</script>
