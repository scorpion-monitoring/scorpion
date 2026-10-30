<script lang="ts">
  import { getShell } from '@scorpion/ui-kit';
  import type { AboutData } from './about.ts';

  let { data }: { data: AboutData } = $props();
  const { t, branding } = getShell();
  const core = $derived(data.modules.filter((module) => module.kind === 'core'));
  const optional = $derived(data.modules.filter((module) => module.kind === 'optional'));
  const groups = $derived([
    { id: 'core', title: t('about.core'), modules: core },
    { id: 'optional', title: t('about.optional'), modules: optional },
  ]);
</script>

<svelte:head>
  <title>{t('about.title')} · {branding().instanceName}</title>
</svelte:head>

<h1 class="mb-4 text-3xl font-bold">{t('about.title')}</h1>
<p class="mb-6 max-w-prose">{t('about.lead')}</p>

<dl
  class="mb-8 grid max-w-prose grid-cols-[max-content_1fr] gap-x-6 gap-y-2"
  data-testid="about-instance"
>
  <dt class="font-semibold">{t('about.profile')}</dt>
  <dd data-testid="about-profile"><code class="num">{data.profile}</code></dd>
  <dt class="font-semibold">{t('about.version')}</dt>
  <dd data-testid="about-version"><code class="num">{data.version}</code></dd>
</dl>

{#each groups as group (group.id)}
  <section class="mb-8" aria-labelledby={`about-${group.id}`}>
    <h2 id={`about-${group.id}`} class="mb-3 text-2xl font-semibold">{group.title}</h2>
    {#if group.modules.length === 0}
      <p class="alert alert-info" role="status">{t('about.none')}</p>
    {:else}
      <div class="overflow-x-auto">
        <table class="table">
          <caption class="sr-only">{group.title}</caption>
          <thead>
            <tr>
              <th scope="col">{t('about.module')}</th>
              <th scope="col">{t('about.id')}</th>
              <th scope="col">{t('about.moduleVersion')}</th>
            </tr>
          </thead>
          <tbody>
            {#each group.modules as module (module.id)}
              <tr>
                <td>{module.displayName}</td>
                <td><code class="num">{module.id}</code></td>
                <td><code class="num">{module.version}</code></td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    {/if}
  </section>
{/each}
