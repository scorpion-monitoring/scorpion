<script lang="ts">
  import { getShell } from '@scorpion/ui-kit';
  import type { DocsData } from './docs.ts';

  let { data }: { data: DocsData } = $props();
  const { t, branding } = getShell();
</script>

<svelte:head>
  <title>{t('docs.title')} · {branding().instanceName}</title>
</svelte:head>

<h1 class="mb-4 text-3xl font-bold">{t('docs.title')}</h1>
<p class="mb-6 max-w-prose">{t('docs.lead')}</p>

{#if data.operations.length === 0}
  <p class="alert alert-info" role="status">{t('docs.empty')}</p>
{:else}
  <div class="overflow-x-auto">
    <table class="table">
      <caption class="sr-only">{t('docs.title')}</caption>
      <thead>
        <tr>
          <th scope="col">{t('docs.method')}</th>
          <th scope="col">{t('docs.path')}</th>
          <th scope="col">{t('docs.summary')}</th>
          <th scope="col">{t('docs.access')}</th>
        </tr>
      </thead>
      <tbody>
        {#each data.operations as operation (operation.method + operation.path)}
          <tr>
            <td class="font-mono uppercase">{operation.method}</td>
            <td class="font-mono">{operation.path}</td>
            <td>{operation.summary}</td>
            <td>{operation.public ? t('docs.public') : (operation.permission ?? '')}</td>
          </tr>
        {/each}
      </tbody>
    </table>
  </div>
{/if}
