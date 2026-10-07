<script lang="ts">
  import { onMount } from 'svelte';
  import { Alert, failureOf, getShell } from '@scorpion/ui-kit';
  import { unwrap } from '@scorpion/contracts/client';
  import { tokenFromFragment } from './fragment.ts';

  const { t, href, api, branding, replaceUrl, session, refresh } = getShell();

  let phase = $state<'working' | 'done' | 'invalid' | 'failed'>('working');
  const who = $derived(session());

  // The token is read from the address fragment once, posted, and the address replaced.
  onMount(async () => {
    const token = tokenFromFragment(window.location.hash);
    replaceUrl(href('/verify-email'));
    if (!token) {
      phase = 'invalid';
      return;
    }
    try {
      await unwrap(api.POST('/auth/verify-email', { body: { token } }));
      phase = 'done';
      // The person may be signed in here: their page now shows the address as confirmed.
      if (who) await refresh();
    } catch (error) {
      phase = failureOf(error).status === 400 ? 'invalid' : 'failed';
    }
  });
</script>

<svelte:head>
  <title>{t('verify.title')} · {branding().instanceName}</title>
</svelte:head>

<div class="mx-auto flex max-w-md flex-col gap-6">
  <h1 class="text-2xl font-bold">{t('verify.title')}</h1>
  {#if phase === 'working'}
    <p aria-live="polite">{t('verify.working')}</p>
  {:else if phase === 'done'}
    <Alert kind="success">{t('verify.done')}</Alert>
    <a class="btn btn-primary" href={href(who ? '/profile' : '/login')}>
      {who ? t('verify.profile') : t('verify.login')}
    </a>
  {:else if phase === 'invalid'}
    <Alert kind="error">{t('verify.invalid')}</Alert>
    <a class="btn btn-primary" href={href(who ? '/profile' : '/login')}>
      {who ? t('verify.profile') : t('verify.login')}
    </a>
  {:else}
    <Alert kind="error">{t('verify.failed')}</Alert>
  {/if}
</div>
