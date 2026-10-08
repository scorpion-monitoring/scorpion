<script lang="ts">
  import { getShell } from '@scorpion/ui-kit';

  const { t, branding, session, href, navigation, Widgets } = getShell();
  const who = $derived(session());
  // The cards the modules offer this caller; the server has already left out the ones they may not see.
  const cards = $derived(navigation().widgets.some((widget) => widget.slot === 'dashboard'));
</script>

<svelte:head>
  <title>{branding().instanceName}</title>
</svelte:head>

<section class="hero bg-base-200 rounded-box py-12">
  <div class="hero-content flex-col text-center">
    <h1 class="text-4xl font-bold">{branding().productName}</h1>
    <p class="max-w-xl text-lg">{t('home.lead', { name: branding().instanceName })}</p>
    {#if who}
      <p>{t('home.signedIn', { name: who.user.username })}</p>
    {:else}
      <a class="btn btn-primary" href={href('/login')}>{t('app.account.signIn')}</a>
    {/if}
  </div>
</section>

{#if who && cards}
  <section class="mt-8 flex flex-col gap-4" aria-labelledby="dashboard-title">
    <h2 id="dashboard-title" class="text-xl font-semibold">{t('home.dashboard')}</h2>
    <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      <Widgets slot="dashboard" />
    </div>
  </section>
{/if}
