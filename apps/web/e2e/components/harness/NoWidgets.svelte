<script lang="ts">
  // The harness has no modules, so no widgets: the slot draws nothing.
  let { slot }: { slot: string } = $props();
</script>

<span hidden data-slot={slot}></span>
