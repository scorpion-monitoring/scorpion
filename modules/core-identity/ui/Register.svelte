<script lang="ts">
  import {
    Alert,
    failureOf,
    firstError,
    getShell,
    SubmitButton,
    TextField,
    type FormFailure,
  } from '@scorpion/ui-kit';
  import { unwrap } from '@scorpion/contracts/client';
  import { LOCAL_ACCOUNTS_OFF } from '../problem-types.ts';

  const { t, href, api, branding, locale } = getShell();

  let username = $state('');
  let email = $state('');
  let password = $state('');
  let busy = $state(false);
  let failure = $state<FormFailure>();
  // The server answers 202 for every well-formed request, whether the address is new or taken, so what the
  // page says after it is one text, written without knowing which it was.
  let done = $state(false);

  async function submit(event: SubmitEvent) {
    event.preventDefault();
    busy = true;
    failure = undefined;
    const sent = password;
    password = '';
    try {
      await unwrap(
        api.POST('/auth/register', { body: { username, email, password: sent, locale: locale() } }),
      );
      done = true;
    } catch (error) {
      failure = failureOf(error);
    } finally {
      busy = false;
    }
  }
</script>

<svelte:head>
  <title>{t('register.title')} · {branding().instanceName}</title>
</svelte:head>

<div class="mx-auto flex max-w-md flex-col gap-6">
  {#if done}
    <section class="flex flex-col gap-4" aria-labelledby="check-mail-title">
      <h1 id="check-mail-title" class="text-2xl font-bold">{t('register.done.title')}</h1>
      <p>{t('register.done.body')}</p>
      <p>{t('register.done.approval')}</p>
      <!-- Said to everybody alike: it must not tell a declined registration from a new one. -->
      <p>
        {branding().contactEmail
          ? t('register.done.help', { contact: branding().contactEmail! })
          : t('register.done.helpNone', { instance: branding().instanceName })}
      </p>
      <a class="btn btn-primary" href={href('/login')}>{t('register.done.login')}</a>
    </section>
  {:else}
    <h1 class="text-2xl font-bold">{t('register.title')}</h1>
    <p>{t('register.lead')}</p>

    {#if failure}
      {#if failure.type === LOCAL_ACCOUNTS_OFF}
        <Alert kind="error">{t('register.localOff')}</Alert>
      {:else if failure.status === 429}
        <Alert kind="error">
          {failure.retryAfterSeconds === undefined
            ? t('register.throttled.later')
            : t('register.throttled', { count: failure.retryAfterSeconds })}
        </Alert>
      {:else if failure.status === 409}
        <Alert kind="error">{t('register.usernameTaken')}</Alert>
      {:else if failure.status === 0}
        <Alert kind="error">{t('register.network')}</Alert>
      {:else if failure.general.length > 0}
        <Alert kind="error">{failure.general.join(' ')}</Alert>
      {/if}
    {/if}

    <form method="post" onsubmit={submit} class="flex flex-col gap-4">
      <TextField
        label={t('register.username')}
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
        label={t('register.email')}
        type="email"
        name="email"
        autocomplete="email"
        bind:value={email}
        errors={failure?.fields.email ?? []}
        required
        maxlength={254}
      />
      <TextField
        label={t('register.password')}
        type="password"
        name="password"
        autocomplete="new-password"
        bind:value={password}
        errors={failure?.fields.password ?? []}
        hint={firstError(failure, 'password') ? undefined : t('register.passwordHint')}
        required
        maxlength={255}
      />
      <SubmitButton {busy}>{t('register.submit')}</SubmitButton>
    </form>
    <p class="text-sm">
      {t('register.haveAccount')}
      <a class="link" href={href('/login')}>{t('register.login')}</a>
    </p>
  {/if}
</div>
