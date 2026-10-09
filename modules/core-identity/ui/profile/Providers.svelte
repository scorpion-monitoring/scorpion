<script lang="ts">
  import { onMount } from 'svelte';
  import { Alert, failureOf, getShell, ReauthCancelled } from '@scorpion/ui-kit';
  import { unwrap } from '@scorpion/contracts/client';
  import type { PublicProvider } from '../loaders.ts';

  let { providers }: { providers: PublicProvider[] } = $props();
  const { t, href, api, withReauth, takeIntent } = getShell();

  let failed = $state<'start' | 'none' | undefined>();

  async function link(id: string) {
    failed = undefined;
    try {
      // Starting a link needs a recent authentication; after it the browser goes to the provider.
      const { authorizationUrl } = await withReauth(
        () =>
          unwrap(api.POST('/auth/oidc/{provider}/link', { params: { path: { provider: id } } })),
        { id: 'provider.link', payload: { provider: id } },
      );
      window.location.assign(authorizationUrl);
    } catch (error) {
      if (error instanceof ReauthCancelled) return;
      failed = failureOf(error).status === 404 ? 'none' : 'start';
    }
  }

  onMount(() => {
    const returned = takeIntent('provider.link');
    const id = (returned?.payload as { provider?: string } | undefined)?.provider;
    if (id) void link(id);
  });
</script>

<section class="card bg-base-100 border-base-300 border" aria-labelledby="providers-title">
  <div class="card-body gap-4">
    <h2 id="providers-title" class="card-title">{t('profile.providers.title')}</h2>
    {#if providers.length === 0}
      <p>{t('profile.providers.none')}</p>
    {:else}
      <p>{t('profile.providers.lead')}</p>
      {#if failed}
        <Alert kind="error"
          >{t(failed === 'none' ? 'profile.providers.unknown' : 'profile.providers.failed')}</Alert
        >
      {/if}
      <ul class="flex flex-wrap gap-2">
        {#each providers as provider (provider.id)}
          <li>
            <button
              type="button"
              class="btn btn-outline btn-sm gap-2"
              onclick={() => link(provider.id)}
            >
              {#if provider.iconHash}
                <img
                  class="h-4 w-4"
                  src={href(`/api/internal/files/${provider.iconHash}`)}
                  alt=""
                />
              {/if}
              {t('profile.providers.link', { name: provider.displayName })}
            </button>
          </li>
        {/each}
      </ul>
    {/if}
  </div>
</section>
