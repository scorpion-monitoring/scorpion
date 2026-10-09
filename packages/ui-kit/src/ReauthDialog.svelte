<script lang="ts">
  // The dialog of a change that needs a recent authentication (ADR-0025): the password first, and the
  // buttons of the providers when the answer says the account has no password. The layout mounts one.
  import { onMount, untrack } from 'svelte';
  import Alert from './Alert.svelte';
  import { getShell } from './context.ts';
  import Dialog from './Dialog.svelte';
  import SubmitButton from './SubmitButton.svelte';
  import TextField from './TextField.svelte';
  import type { ReauthController, ReauthState } from './reauth.ts';

  let { controller }: { controller: ReauthController } = $props();
  const { t } = getShell();

  let view = $state<ReauthState>(untrack(() => controller.state));
  onMount(() => controller.subscribe((next) => (view = next)));

  let password = $state('');
  // A password is never kept: it is cleared as soon as it has been sent, and when the dialog closes.
  $effect(() => {
    if (!view.open) password = '';
  });

  async function submit(event: SubmitEvent) {
    event.preventDefault();
    const sent = password;
    password = '';
    await controller.submitPassword(sent);
  }
</script>

<Dialog open={view.open} title={t('reauth.title')} onclose={() => controller.cancel()}>
  <!-- Nothing is in the page while the dialog is closed: no second password field for a form to find. -->
  {#if !view.open}
    <!-- closed -->
  {:else if view.step === 'password'}
    <form method="post" onsubmit={submit} class="flex flex-col gap-4">
      <p>{t('reauth.password.lead')}</p>
      {#if view.problem === 'wrong'}
        <Alert kind="error">{t('reauth.password.wrong')}</Alert>
      {:else if view.problem === 'throttled'}
        <Alert kind="error">
          {view.retryAfterSeconds === undefined
            ? t('reauth.throttled.later')
            : t('reauth.throttled', { count: view.retryAfterSeconds })}
        </Alert>
      {:else if view.problem === 'failed'}
        <Alert kind="error">{t('reauth.failed')}</Alert>
      {/if}
      <TextField
        label={t('reauth.password.label')}
        type="password"
        autocomplete="current-password"
        name="password"
        bind:value={password}
        required
        maxlength={255}
      />
      <div class="modal-action">
        <button type="button" class="btn btn-ghost" onclick={() => controller.cancel()}>
          {t('reauth.cancel')}
        </button>
        <SubmitButton busy={view.busy}>{t('reauth.confirm')}</SubmitButton>
      </div>
    </form>
  {:else}
    <div class="flex flex-col gap-4">
      <p>{t('reauth.provider.lead')}</p>
      {#if view.problem === 'noSignIn'}
        <Alert kind="error">{t('reauth.provider.noSignIn')}</Alert>
      {:else if view.problem === 'failed'}
        <Alert kind="error">{t('reauth.failed')}</Alert>
      {/if}
      {#if view.providers.length === 0}
        <Alert kind="warning">{t('reauth.provider.none')}</Alert>
      {/if}
      <ul class="flex flex-col gap-2">
        {#each view.providers as provider (provider.id)}
          <li>
            <button
              type="button"
              class="btn btn-outline w-full"
              disabled={view.busy}
              onclick={() => controller.startProvider(provider.id)}
            >
              {t('reauth.provider.signIn', { name: provider.displayName })}
            </button>
          </li>
        {/each}
      </ul>
      <div class="modal-action">
        <button type="button" class="btn btn-ghost" onclick={() => controller.cancel()}>
          {t('reauth.cancel')}
        </button>
      </div>
    </div>
  {/if}
</Dialog>
