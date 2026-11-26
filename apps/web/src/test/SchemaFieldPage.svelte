<script lang="ts">
  // A stand-in page that draws one field of a `SchemaForm` with its value, for a server-side test of how a field is drawn (a form
  // draws its fields only in the browser).
  import { describeRoot, type JsonSchema } from '@scorpion/ui-kit';
  import SchemaField from '../../../../packages/ui-kit/src/SchemaField.svelte';

  let { data }: { data: { schema: JsonSchema; value: unknown } } = $props();
  // svelte-ignore state_referenced_locally
  let value = $state(data.value);
  const root = $derived(describeRoot(data.schema));
</script>

<SchemaField node={root} bind:value errors={new Map()} root />
