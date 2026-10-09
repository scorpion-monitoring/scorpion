<script lang="ts">
  import { onMount } from 'svelte';
  import {
    Alert,
    failureOf,
    getShell,
    SubmitButton,
    TextField,
    type FormFailure,
  } from '@scorpion/ui-kit';
  import { unwrap } from '@scorpion/contracts/client';
  import { LOCAL_ACCOUNTS_OFF } from '../problem-types.ts';
  import { tokenFromFragment } from './fragment.ts';

  const { t, href, api, branding, replaceUrl } = getShell();

  // The token is read from the address fragment once, kept in this page only, and the address is replaced
  // so that it is not in the history either. A reload therefore asks for a new link.
  let token = $state<string>();
  let ready = $state(false);
  onMount(() => {
    token = tokenFromFragment(window.location.hash);
    replaceUrl(href('/reset-password'));
    ready = true;
  });

  let password = $state('');
  let busy = $state(false);
  let failure = $state<FormFailure>();
  let done = $state(false);
  let expired = $state(false);

  async function submit(event: SubmitEvent) {
    event.preventDefault();
    if (!token) return;
    busy = true;
    failure = undefined;
    const sent = password;
    password = '';
    try {
      await unwrap(api.POST('/auth/password-reset/confirm', { body: { token, password: sent } }));
      token = undefined;
      done = true;
    } catch (error) {
      failure = failureOf(error);
      // 400: the link is not valid, was used, or has lived its 10 minutes; a new password cannot fix that.
      if (failure.status === 400) {
        token = undefined;
        expired = true;
      }
    } finally {
      busy = false;
    }
  }
</script>

<svelte:head>
  <title>{t('reset.title')} · {branding().instanceName}</title>
</svelte:head>

<div class="mx-auto flex max-w-md flex-col gap-6">
  <h1 class="text-2xl font-bold">{t('reset.title')}</h1>
  {#if done}
    <Alert kind="success">{t('reset.done')}</Alert>
    <a class="btn btn-primary" href={href('/login')}>{t('reset.login')}</a>
  {:else if ready && (expired || !token)}
    <Alert kind="error">{t('reset.expired')}</Alert>
    <a class="btn btn-primary" href={href('/forgot-password')}>{t('reset.askAgain')}</a>
  {:else}
    <p>{t('reset.lead')}</p>
    {#if failure}
      {#if failure.type === LOCAL_ACCOUNTS_OFF}
        <Alert kind="error">{t('reset.localOff')}</Alert>
      {:else if failure.status === 429}
        <Alert kind="error">{t('reset.throttled')}</Alert>
      {:else if failure.status === 0}
        <Alert kind="error">{t('reset.network')}</Alert>
      {:else if failure.general.length > 0}
        <Alert kind="error">{failure.general.join(' ')}</Alert>
      {/if}
    {/if}
    <form method="post" onsubmit={submit} class="flex flex-col gap-4">
      <TextField
        label={t('reset.password')}
        type="password"
        name="password"
        autocomplete="new-password"
        bind:value={password}
        errors={failure?.fields.password ?? []}
        required
        maxlength={255}
      />
      <SubmitButton busy={busy || !token}>{t('reset.submit')}</SubmitButton>
    </form>
  {/if}
</div>
