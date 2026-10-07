<script lang="ts">
  import { getShell } from '@scorpion/ui-kit';

  const { t, branding, session, href } = getShell();
  const who = $derived(session());
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
