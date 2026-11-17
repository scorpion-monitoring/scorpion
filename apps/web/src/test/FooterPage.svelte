<script lang="ts">
  // Renders the footer of the shell with the branding it is given, for `footer.test.ts`.
  import Footer from '../lib/components/Footer.svelte';
  import type { Branding } from '@scorpion/contracts/client';

  let { data }: { data: Branding } = $props();
</script>

<Footer branding={data} />
