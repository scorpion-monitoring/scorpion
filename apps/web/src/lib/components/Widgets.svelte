<script lang="ts">
  // The widgets the caller may see in one slot of the page (`header`, `dashboard`): the list comes from the
  // server, which has already left out what the caller's role may not open (`GET /ui/navigation`).
  import { getShell } from '@scorpion/ui-kit';
  import Widget from './Widget.svelte';

  let { slot }: { slot: string } = $props();
  const { navigation } = getShell();
  const shown = $derived(navigation().widgets.filter((widget) => widget.slot === slot));
</script>

{#each shown as widget (widget.id)}
  <Widget name={widget.component} />
{/each}
