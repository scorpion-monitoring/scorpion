<script lang="ts">
  // Shown when the sign-in answers that the account waits for approval (the API's answer decides, never
  // the page): the person got the right password, and an administrator has not yet looked at the account.
  import { getShell } from '@scorpion/ui-kit';

  const { t, href, branding } = getShell();
  const contact = $derived(branding().contactEmail);
</script>

<svelte:head>
  <title>{t('pending.title')} · {branding().instanceName}</title>
</svelte:head>

<section class="flex flex-col gap-4" aria-labelledby="pending-title">
  <h1 id="pending-title" class="text-2xl font-bold">{t('pending.title')}</h1>
  <p>{t('pending.body')}</p>
  {#if contact}
    <p>{t('pending.contact', { contact })}</p>
  {/if}
  <a class="btn btn-primary" href={href('/')}>{t('pending.home')}</a>
</section>
