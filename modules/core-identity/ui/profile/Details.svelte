<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import {
    Alert,
    failureOf,
    getShell,
    ReauthCancelled,
    SubmitButton,
    TextArea,
    TextField,
    type FormFailure,
  } from '@scorpion/ui-kit';
  import { unwrap } from '@scorpion/contracts/client';
  import type { ProfileData } from '../loaders.ts';

  let { profile }: { profile: ProfileData['profile'] } = $props();
  const { t, api, session, refresh, withReauth, takeIntent } = getShell();

  let displayName = $state(untrack(() => profile.displayName ?? ''));
  let email = $state(untrack(() => profile.email ?? ''));
  let bio = $state(untrack(() => profile.bio ?? ''));
  let busy = $state(false);
  let failure = $state<FormFailure>();
  let saved = $state(false);
  let resent = $state<'sent' | 'confirmed' | 'failed'>();
  const roles = $derived(session()?.roles ?? []);

  async function save(values: {
    displayName?: string | null;
    bio?: string | null;
    email?: string;
  }) {
    busy = true;
    failure = undefined;
    saved = false;
    try {
      // A new address needs a recent authentication: the dialog asks, and the change is made again.
      await withReauth(() => unwrap(api.PATCH('/account/profile', { body: values })), {
        id: 'profile.save',
        payload: values,
      });
      saved = true;
      await refresh();
    } catch (error) {
      if (!(error instanceof ReauthCancelled)) failure = failureOf(error);
    } finally {
      busy = false;
    }
  }

  function submit(event: SubmitEvent) {
    event.preventDefault();
    // Only what changed is sent: the API refuses a request that changes nothing.
    const values: { displayName?: string | null; bio?: string | null; email?: string } = {};
    if (displayName.trim() !== (profile.displayName ?? ''))
      values.displayName = displayName.trim() || null;
    if (bio.trim() !== (profile.bio ?? '')) values.bio = bio.trim() || null;
    if (email.trim() !== (profile.email ?? '')) values.email = email.trim();
    if (Object.keys(values).length === 0) {
      failure = undefined;
      saved = false;
      return;
    }
    void save(values);
  }

  async function resend() {
    resent = undefined;
    try {
      await unwrap(api.POST('/account/email/verification'));
      resent = 'sent';
    } catch (error) {
      resent = failureOf(error).status === 409 ? 'confirmed' : 'failed';
    }
  }

  // Back from the provider that confirmed the identity: the change the person asked for is made now.
  onMount(() => {
    const returned = takeIntent('profile.save');
    if (returned) {
      const values = returned.payload as {
        displayName?: string | null;
        bio?: string | null;
        email?: string;
      };
      if (values.email !== undefined) email = values.email;
      void save(values);
    }
  });
</script>

<section class="card bg-base-100 border-base-300 border" aria-labelledby="details-title">
  <form method="post" onsubmit={submit} class="card-body gap-4">
    <h2 id="details-title" class="card-title">{t('profile.details.title')}</h2>
    {#if saved}<Alert kind="success">{t('profile.details.saved')}</Alert>{/if}
    {#if failure}
      {#if failure.status === 429}
        <Alert kind="error">{t('profile.details.throttled')}</Alert>
      {:else if failure.status === 0}
        <Alert kind="error">{t('profile.network')}</Alert>
      {:else if failure.general.length > 0}
        <Alert kind="error">{failure.general.join(' ')}</Alert>
      {/if}
    {/if}

    <dl class="grid grid-cols-[max-content_1fr] items-center gap-x-4 gap-y-1">
      <dt class="text-sm opacity-70">{t('profile.details.username')}</dt>
      <dd class="font-medium">{profile.username}</dd>
      <dt class="text-sm opacity-70">{t('profile.details.roles')}</dt>
      <dd class="flex flex-wrap gap-1">
        {#each roles as role (role)}<span class="badge badge-outline">{role}</span>{/each}
      </dd>
    </dl>

    <TextField
      label={t('profile.details.displayName')}
      name="displayName"
      autocomplete="name"
      bind:value={displayName}
      errors={failure?.fields.displayName ?? []}
      maxlength={100}
    />
    <TextField
      label={t('profile.details.email')}
      type="email"
      name="email"
      autocomplete="email"
      bind:value={email}
      errors={failure?.fields.email ?? []}
      maxlength={254}
    />
    {#if profile.pendingEmail}
      <Alert kind="info">{t('profile.details.pendingEmail', { email: profile.pendingEmail })}</Alert
      >
    {:else if profile.email && !profile.emailVerified}
      <Alert kind="warning">
        <span>{t('profile.details.unverified')}</span>
        <button type="button" class="btn btn-sm btn-ghost" onclick={resend}>
          {t('profile.details.resend')}
        </button>
      </Alert>
    {/if}
    {#if resent === 'sent'}
      <Alert kind="success">{t('profile.details.resent')}</Alert>
    {:else if resent === 'confirmed'}
      <Alert kind="info">{t('profile.details.alreadyConfirmed')}</Alert>
    {:else if resent === 'failed'}
      <Alert kind="error">{t('profile.details.resendFailed')}</Alert>
    {/if}
    <TextArea
      label={t('profile.details.bio')}
      name="bio"
      bind:value={bio}
      errors={failure?.fields.bio ?? []}
      hint={t('profile.details.bioHint')}
      rows={4}
      maxlength={2000}
    />
    <div class="card-actions">
      <SubmitButton {busy}>{t('profile.details.save')}</SubmitButton>
    </div>
  </form>
</section>
