<script lang="ts">
  import type { PageProps } from './$types';

  let { data }: PageProps = $props();
  const Page = $derived(data.component);
</script>

<Page data={data.data} params={data.params} />
