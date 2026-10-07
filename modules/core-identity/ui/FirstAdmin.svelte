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

  const { t, href, api, branding, goto, refresh } = getShell();

  let token = $state('');
  let username = $state('');
  let email = $state('');
  let password = $state('');
  let busy = $state(false);
  let failure = $state<FormFailure>();

  async function submit(event: SubmitEvent) {
    event.preventDefault();
    busy = true;
    failure = undefined;
    const sentPassword = password;
    password = '';
    try {
      await unwrap(
        api.POST('/bootstrap/first-admin', {
          body: { token, username, email, password: sentPassword },
        }),
      );
      // An administrator exists now: the form is gone and the start page is the ordinary one.
      await refresh();
      await goto(href('/login'));
    } catch (error) {
      failure = failureOf(error);
    } finally {
      busy = false;
    }
  }
</script>

<svelte:head>
  <title>{t('first.title')} · {branding().instanceName}</title>
</svelte:head>

<div class="mx-auto flex max-w-md flex-col gap-6">
  <h1 class="text-2xl font-bold">{t('first.title')}</h1>
  <p>{t('first.lead')}</p>
  <p class="text-sm opacity-80">{t('first.token.lead')}</p>

  {#if failure}
    {#if failure.status === 401}
      <Alert kind="error">{t('first.tokenInvalid')}</Alert>
    {:else if failure.status === 409}
      <Alert kind="error">{t('first.taken')}</Alert>
    {:else if failure.status === 429}
      <Alert kind="error">{t('first.throttled')}</Alert>
    {:else if failure.status === 0}
      <Alert kind="error">{t('first.network')}</Alert>
    {:else if failure.general.length > 0}
      <Alert kind="error">{failure.general.join(' ')}</Alert>
    {/if}
  {/if}

  <form method="post" onsubmit={submit} class="flex flex-col gap-4">
    <TextField
      label={t('first.token')}
      name="token"
      autocomplete="one-time-code"
      bind:value={token}
      errors={failure?.fields.token ?? []}
      required
      maxlength={128}
      spellcheck={false}
      autocapitalize="none"
    />
    <TextField
      label={t('first.username')}
      name="username"
      autocomplete="username"
      bind:value={username}
      errors={failure?.fields.username ?? []}
      required
      maxlength={64}
      autocapitalize="none"
      spellcheck={false}
    />
    <TextField
      label={t('first.email')}
      type="email"
      name="email"
      autocomplete="email"
      bind:value={email}
      errors={failure?.fields.email ?? []}
      required
      maxlength={254}
    />
    <TextField
      label={t('first.password')}
      type="password"
      name="password"
      autocomplete="new-password"
      bind:value={password}
      errors={failure?.fields.password ?? []}
      required
      maxlength={255}
    />
    <SubmitButton {busy}>{t('first.submit')}</SubmitButton>
  </form>
</div>
