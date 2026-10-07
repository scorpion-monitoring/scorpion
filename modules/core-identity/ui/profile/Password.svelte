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
  import { LOCAL_ACCOUNTS_OFF } from '../../problem-types.ts';

  const { t, href, api, refresh, goto } = getShell();

  let current = $state('');
  let next = $state('');
  let busy = $state(false);
  let failure = $state<FormFailure>();

  async function submit(event: SubmitEvent) {
    event.preventDefault();
    busy = true;
    failure = undefined;
    const sentCurrent = current;
    const sentNext = next;
    current = '';
    next = '';
    try {
      await unwrap(
        api.POST('/account/password', {
          body: { currentPassword: sentCurrent, newPassword: sentNext },
        }),
      );
      // Every session of the account is over, this one too: the person signs in again.
      await refresh();
      await goto(href('/login?notice=password-changed'));
    } catch (error) {
      failure = failureOf(error);
    } finally {
      busy = false;
    }
  }
</script>

<section class="card bg-base-100 border-base-300 border" aria-labelledby="password-title">
  <form method="post" onsubmit={submit} class="card-body gap-4">
    <h2 id="password-title" class="card-title">{t('profile.password.title')}</h2>
    <p>{t('profile.password.lead')}</p>
    {#if failure}
      {#if failure.status === 409}
        <Alert kind="info">{t('profile.password.none')}</Alert>
      {:else if failure.type === LOCAL_ACCOUNTS_OFF}
        <Alert kind="error">{t('profile.password.localOff')}</Alert>
      {:else if failure.status === 429}
        <Alert kind="error">
          {failure.retryAfterSeconds === undefined
            ? t('profile.password.throttled.later')
            : t('profile.password.throttled', { count: failure.retryAfterSeconds })}
        </Alert>
      {:else if failure.status === 0}
        <Alert kind="error">{t('profile.network')}</Alert>
      {:else if failure.general.length > 0}
        <Alert kind="error">{failure.general.join(' ')}</Alert>
      {/if}
    {/if}
    <TextField
      label={t('profile.password.current')}
      type="password"
      name="currentPassword"
      autocomplete="current-password"
      bind:value={current}
      errors={failure?.fields.currentPassword ?? []}
      required
      maxlength={255}
    />
    <TextField
      label={t('profile.password.new')}
      type="password"
      name="newPassword"
      autocomplete="new-password"
      bind:value={next}
      errors={failure?.fields.newPassword ?? []}
      required
      maxlength={255}
    />
    <div class="card-actions">
      <SubmitButton {busy}>{t('profile.password.submit')}</SubmitButton>
    </div>
  </form>
</section>
