<script lang="ts">
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

  const { t, href, api, branding, locale } = getShell();

  let email = $state('');
  let busy = $state(false);
  let failure = $state<FormFailure>();
  // The answer is 202 for every address; the page says one thing whether or not an account exists.
  let done = $state(false);

  async function submit(event: SubmitEvent) {
    event.preventDefault();
    busy = true;
    failure = undefined;
    try {
      await unwrap(api.POST('/auth/password-reset', { body: { email, locale: locale() } }));
      done = true;
    } catch (error) {
      failure = failureOf(error);
    } finally {
      busy = false;
    }
  }
</script>

<svelte:head>
  <title>{t('forgot.title')} · {branding().instanceName}</title>
</svelte:head>

<div class="mx-auto flex max-w-md flex-col gap-6">
  <h1 class="text-2xl font-bold">{t('forgot.title')}</h1>
  {#if done}
    <Alert kind="success">{t('forgot.done')}</Alert>
    <a class="btn btn-primary" href={href('/login')}>{t('forgot.back')}</a>
  {:else}
    <p>{t('forgot.lead')}</p>
    {#if failure}
      {#if failure.type === LOCAL_ACCOUNTS_OFF}
        <Alert kind="error">{t('forgot.localOff')}</Alert>
      {:else if failure.status === 429}
        <Alert kind="error">{t('forgot.throttled')}</Alert>
      {:else}
        <Alert kind="error">{failure.general[0] ?? t('forgot.error')}</Alert>
      {/if}
    {/if}
    <form method="post" onsubmit={submit} class="flex flex-col gap-4">
      <TextField
        label={t('forgot.email')}
        type="email"
        name="email"
        autocomplete="email"
        bind:value={email}
        errors={failure?.fields.email ?? []}
        required
        maxlength={254}
      />
      <SubmitButton {busy}>{t('forgot.submit')}</SubmitButton>
    </form>
    <a class="link text-sm" href={href('/login')}>{t('forgot.back')}</a>
  {/if}
</div>
