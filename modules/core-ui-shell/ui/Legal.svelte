<script lang="ts">
  import { getShell, SafeHtml } from '@scorpion/ui-kit';
  import type { LegalData } from './legal.ts';

  let { data }: { data: LegalData } = $props();
  const { branding } = getShell();
</script>

<svelte:head>
  <title>{data.title} · {branding().instanceName}</title>
</svelte:head>

<article class="prose-text">
  <h1 class="text-3xl font-bold">{data.title}</h1>
  <SafeHtml html={data.html} />
</article>
