<script lang="ts">
  import { getShell } from '@scorpion/ui-kit';
  import JsonLd from './JsonLd.svelte';
  import type { OrganisationData } from './loaders.ts';

  let { data }: { data: OrganisationData } = $props();
  const { t } = getShell();
</script>

<svelte:head>
  <title>{data.organisation.name}</title>
</svelte:head>
<JsonLd profile={data.profile} />

<h1>{data.organisation.name}</h1>
<p>{t('organisation.title')}</p>
