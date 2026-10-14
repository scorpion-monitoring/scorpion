<script lang="ts">
  import { getShell } from '@scorpion/ui-kit';
  import type { DocsData } from './docs.ts';

  let { data }: { data: DocsData } = $props();
  const { t, href, branding } = getShell();
  // Protocol syntax, not prose: the two ways to send the token.
  const headers = ['Authorization: Bearer <token>', 'X-API-Key: <token>'];
</script>

<svelte:head>
  <title>{t('docs.title')} · {branding().instanceName}</title>
</svelte:head>

<!--
  The reference and the description of the API are documents of their own, not pages of the shell, so a
  link to either must be a full load (`data-sveltekit-reload`): the client-side router would answer
  them with the shell's 404.
-->
<h1 class="mb-4 text-3xl font-bold">{t('docs.title')}</h1>
<p class="mb-4 max-w-prose">{t('docs.lead')}</p>
<p class="mb-8 max-w-prose">
  <a class="btn btn-primary" href={href('/docs/reference')} data-sveltekit-reload>
    {t('docs.reference.open')}
  </a>
</p>
<p class="mb-8 max-w-prose">{t('docs.reference.note')}</p>

<section class="mb-8" aria-labelledby="docs-token">
  <h2 id="docs-token" class="mb-3 text-2xl font-semibold">{t('docs.token.title')}</h2>
  <ol class="max-w-prose list-decimal space-y-2 ps-6">
    <li>
      <a class="link" href={href('/profile')}>{t('docs.token.profile')}</a>
      {t('docs.token.profileRest')}
    </li>
    <li>{t('docs.token.scopes')}</li>
    <li>
      {t('docs.token.send')}
      {#each headers as header, index (header)}{index > 0 ? ', ' : ''}<code class="num"
          >{header}</code
        >{/each}
    </li>
  </ol>
</section>

<section class="mb-8" aria-labelledby="docs-routes">
  <h2 id="docs-routes" class="mb-3 text-2xl font-semibold">{t('docs.routes.title')}</h2>
  {#if data.operations.length === 0}
    <p class="alert alert-info" role="status">{t('docs.empty')}</p>
  {:else}
    <div class="overflow-x-auto">
      <table class="table">
        <caption class="sr-only">{t('docs.routes.title')}</caption>
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
              <td>
                {#if operation.public}
                  {t('docs.public')}
                {:else if operation.permission}
                  <code class="num">{operation.permission}</code>
                {/if}
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  {/if}
</section>

<section class="mb-8 max-w-prose space-y-3" aria-labelledby="docs-more">
  <h2 id="docs-more" class="text-2xl font-semibold">{t('docs.more.title')}</h2>
  <p>
    {t('docs.more.document')}
    <a class="link num" href={href('/api/v1/openapi.json')} data-sveltekit-reload>
      {href('/api/v1/openapi.json')}
    </a>
  </p>
  <p>{t('docs.more.cors')}</p>
</section>
