<script lang="ts">
  import { Alert, failureOf, getShell, type FormFailure } from '@scorpion/ui-kit';
  import { unwrap } from '@scorpion/contracts/client';
  import { MAX_AVATAR_BYTES } from '../limits.ts';
  import type { ProfileData } from '../loaders.ts';

  let { profile }: { profile: ProfileData['profile'] } = $props();
  const { t, href, api, refresh } = getShell();

  let busy = $state(false);
  let tooBig = $state(false);
  let failure = $state<FormFailure>();
  let input = $state<HTMLInputElement>();

  async function upload(event: Event) {
    const file = (event.currentTarget as HTMLInputElement).files?.[0];
    failure = undefined;
    tooBig = false;
    if (!file) return;
    // A look at the size saves a long upload that the server would refuse; the server decides everything else.
    if (file.size > MAX_AVATAR_BYTES) {
      tooBig = true;
      if (input) input.value = '';
      return;
    }
    busy = true;
    try {
      // The image is the request body as it is; the server checks it, re-encodes it and answers with the
      // stored file, which the page shows below (not the file the person picked).
      await unwrap(
        api.PUT('/account/avatar', {
          body: file as unknown as string,
          bodySerializer: (body: unknown) => body as BodyInit,
          headers: { 'content-type': 'application/octet-stream' },
        }),
      );
      await refresh();
    } catch (error) {
      failure = failureOf(error);
    } finally {
      busy = false;
      if (input) input.value = '';
    }
  }

  async function remove() {
    busy = true;
    failure = undefined;
    try {
      await unwrap(api.DELETE('/account/avatar'));
      await refresh();
    } catch (error) {
      failure = failureOf(error);
    } finally {
      busy = false;
    }
  }
</script>

<section class="card bg-base-100 border-base-300 border" aria-labelledby="avatar-title">
  <div class="card-body gap-4">
    <h2 id="avatar-title" class="card-title">{t('profile.avatar.title')}</h2>
    <div class="flex items-center gap-4">
      {#if profile.avatarHash}
        <img
          class="h-24 w-24 rounded-full object-cover"
          src={href(`/api/internal/files/${profile.avatarHash}`)}
          alt={t('profile.avatar.alt', { name: profile.username })}
        />
      {:else}
        <p class="opacity-70">{t('profile.avatar.none')}</p>
      {/if}
    </div>
    {#if tooBig}
      <Alert kind="error"
        >{t('profile.avatar.tooBig', { count: Math.floor(MAX_AVATAR_BYTES / 1048576) })}</Alert
      >
    {/if}
    {#if failure}
      {#if failure.status === 413}
        <Alert kind="error">{t('profile.avatar.refusedSize')}</Alert>
      {:else if failure.status === 0}
        <Alert kind="error">{t('profile.network')}</Alert>
      {:else}
        <Alert kind="error">{failure.general[0] ?? t('profile.avatar.refused')}</Alert>
      {/if}
    {/if}
    <div class="flex flex-wrap items-center gap-2">
      <label class="btn btn-outline btn-sm" class:btn-disabled={busy}>
        {t('profile.avatar.choose')}
        <input
          bind:this={input}
          class="sr-only"
          type="file"
          name="avatar"
          accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml"
          disabled={busy}
          onchange={upload}
        />
      </label>
      {#if profile.avatarHash}
        <button type="button" class="btn btn-ghost btn-sm" disabled={busy} onclick={remove}>
          {t('profile.avatar.remove')}
        </button>
      {/if}
    </div>
    <p class="text-sm opacity-70">{t('profile.avatar.hint')}</p>
  </div>
</section>
