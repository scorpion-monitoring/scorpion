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
  import { ACCOUNT_PENDING, LOCAL_ACCOUNTS_OFF } from '../problem-types.ts';
  import type { LoginData } from './loaders.ts';
  import PendingApproval from './PendingApproval.svelte';

  let { data }: { data: LoginData } = $props();
  const { t, href, api, session, branding, goto, refresh, localPath } = getShell();

  let username = $state('');
  let password = $state('');
  let busy = $state(false);
  let failure = $state<FormFailure>();
  let pending = $state(false);
  let providerFailed = $state(false);
  const who = $derived(session());

  async function submit(event: SubmitEvent) {
    event.preventDefault();
    busy = true;
    failure = undefined;
    const sent = password;
    // The password never stays in the page: it is cleared as soon as it has been sent.
    password = '';
    try {
      await unwrap(api.POST('/auth/login', { body: { username, password: sent } }));
      // Who is signed in, and the CSRF token of the new session, come from the server again.
      await refresh();
      await goto(localPath(data.returnTo) ?? href('/'), { replace: true });
    } catch (error) {
      failure = failureOf(error);
      pending = failure.type === ACCOUNT_PENDING;
    } finally {
      busy = false;
    }
  }

  async function withProvider(id: string) {
    providerFailed = false;
    try {
      const { authorizationUrl } = await unwrap(
        api.POST('/auth/oidc/{provider}/start', { params: { path: { provider: id } } }),
      );
      window.location.assign(authorizationUrl);
    } catch {
      providerFailed = true;
    }
  }
</script>

<svelte:head>
  <title>{t('login.title')} · {branding().instanceName}</title>
</svelte:head>

<div class="mx-auto flex max-w-md flex-col gap-6">
  {#if pending}
    <PendingApproval />
  {:else}
    <h1 class="text-2xl font-bold">{t('login.title')}</h1>

    {#if data.notice === 'check-mail'}
      <Alert kind="info">{t('login.notice.checkMail')}</Alert>
    {:else if data.notice === 'password-changed'}
      <Alert kind="success">{t('login.notice.passwordChanged')}</Alert>
    {:else if data.notice === 'signed-out'}
      <Alert kind="info">{t('login.notice.signedOut')}</Alert>
    {/if}

    {#if who}
      <Alert kind="info">{t('login.alreadySignedIn', { name: who.user.username })}</Alert>
      <a class="btn btn-primary" href={href('/')}>{t('login.goHome')}</a>
    {:else}
      {#if failure}
        {#if failure.status === 429}
          <Alert kind="error">
            {failure.retryAfterSeconds === undefined
              ? t('login.throttled.later')
              : t('login.throttled', { count: failure.retryAfterSeconds })}
          </Alert>
        {:else if failure.type === LOCAL_ACCOUNTS_OFF}
          <Alert kind="error">{t('login.localOff')}</Alert>
        {:else if failure.status === 401}
          <Alert kind="error">{t('login.failed')}</Alert>
        {:else if failure.status === 0}
          <Alert kind="error">{t('login.network')}</Alert>
        {:else}
          <Alert kind="error">{failure.general[0] ?? t('login.error')}</Alert>
        {/if}
      {/if}

      <form method="post" onsubmit={submit} class="flex flex-col gap-4">
        <TextField
          label={t('login.username')}
          name="username"
          autocomplete="username"
          bind:value={username}
          required
          maxlength={64}
          autocapitalize="none"
          spellcheck={false}
        />
        <TextField
          label={t('login.password')}
          type="password"
          name="password"
          autocomplete="current-password"
          bind:value={password}
          required
          maxlength={255}
        />
        <SubmitButton {busy}>{t('login.submit')}</SubmitButton>
      </form>

      {#if data.providers.length > 0}
        <div class="divider">{t('login.or')}</div>
        {#if providerFailed}
          <Alert kind="error">{t('login.providerFailed')}</Alert>
        {/if}
        <ul class="flex flex-col gap-2">
          {#each data.providers as provider (provider.id)}
            <li>
              <button
                type="button"
                class="btn btn-outline w-full gap-2"
                onclick={() => withProvider(provider.id)}
              >
                {#if provider.iconHash}
                  <img
                    class="h-5 w-5"
                    src={href(`/api/internal/files/${provider.iconHash}`)}
                    alt=""
                  />
                {/if}
                {t('login.withProvider', { name: provider.displayName })}
              </button>
            </li>
          {/each}
        </ul>
      {/if}

      <p class="flex flex-wrap justify-between gap-2 text-sm">
        <a class="link" href={href('/forgot-password')}>{t('login.forgot')}</a>
        <a class="link" href={href('/register')}>{t('login.register')}</a>
      </p>
    {/if}
  {/if}
</div>
