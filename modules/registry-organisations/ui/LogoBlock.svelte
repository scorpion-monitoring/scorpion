<script lang="ts">
  // The logo of one organisation: shows the stored file, uploads a new one, replaces it and removes it,
  // through `PUT` and `DELETE /organisations/{id}/logo`. Shared by the administrator's editor and (sprint 5)
  // the manager's form: what the caller may do is decided by the server, and a 403 is shown in words.
  import { Alert, getShell, failureMessage, failureOf } from '@scorpion/ui-kit';
  import { unwrap } from '@scorpion/contracts/client';
  import { MAX_LOGO_BYTES, MAX_LOGO_MIB } from './limits.ts';

  let {
    organisation,
    editable = true,
    onchanged,
  }: {
    organisation: { id: string; name: string; logoUrl?: string | undefined };
    editable?: boolean;
    /** Called with the new logo URL (absent after a removal). */
    onchanged?: (logoUrl: string | undefined) => void;
  } = $props();
  const { t, api, toaster } = getShell();

  const id = $props.id();
  let busy = $state(false);
  let failed = $state<string>();
  let input = $state<HTMLInputElement>();
  // The logo shown: what the server said last, else what the page was given.
  let current = $state<string | undefined>();
  const logo = $derived(current ?? organisation.logoUrl);
  let removed = $state(false);
  const shown = $derived(removed ? undefined : logo);

  const words = (error: unknown) =>
    failureMessage(failureOf(error), t, {
      413: t('organisation.logo.tooBig', { count: MAX_LOGO_MIB }),
      422: t('organisation.logo.invalid'),
      403: t('organisation.logo.forbidden'),
    });

  async function upload(event: Event) {
    const file = (event.currentTarget as HTMLInputElement).files?.[0];
    failed = undefined;
    if (!file) return;
    if (file.size > MAX_LOGO_BYTES) {
      failed = t('organisation.logo.tooBig', { count: MAX_LOGO_MIB });
      if (input) input.value = '';
      return;
    }
    busy = true;
    try {
      // The image is the request body as it is; the server checks it, re-encodes it and answers with the
      // stored file, which is what the page shows (not the file the person picked).
      const saved = await unwrap(
        api.PUT('/organisations/{id}/logo', {
          params: { path: { id: organisation.id } },
          body: file as unknown as string,
          bodySerializer: (body: unknown) => body as BodyInit,
          headers: { 'content-type': 'application/octet-stream' },
        }),
      );
      current = saved.logoUrl;
      removed = false;
      toaster.success(t('organisation.logo.saved'));
      onchanged?.(saved.logoUrl);
    } catch (error) {
      failed = words(error);
    } finally {
      busy = false;
      if (input) input.value = '';
    }
  }

  async function remove() {
    failed = undefined;
    busy = true;
    try {
      await unwrap(
        api.DELETE('/organisations/{id}/logo', { params: { path: { id: organisation.id } } }),
      );
      current = undefined;
      removed = true;
      toaster.success(t('organisation.logo.removed'));
      onchanged?.(undefined);
    } catch (error) {
      failed = words(error);
    } finally {
      busy = false;
    }
  }
</script>

<section class="card bg-base-100 border-base-300 border" aria-labelledby="{id}-title">
  <div class="card-body gap-3">
    <h2 id="{id}-title" class="card-title">{t('organisation.logo.title')}</h2>
    {#if shown}
      <img
        class="bg-base-200 h-20 w-auto max-w-xs self-start rounded p-2"
        src={shown}
        alt={t('organisation.logo.alt', { name: organisation.name })}
      />
    {:else}
      <p class="opacity-70">{t('organisation.logo.none')}</p>
    {/if}
    {#if failed}<Alert kind="error">{failed}</Alert>{/if}
    {#if editable}
      <div class="flex flex-col gap-1">
        <label class="text-sm font-medium" for="{id}-file">{t('organisation.logo.choose')}</label>
        <input
          id="{id}-file"
          bind:this={input}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml"
          class="file-input file-input-bordered"
          disabled={busy}
          aria-describedby="{id}-hint"
          onchange={upload}
        />
        <p id="{id}-hint" class="text-sm opacity-70">
          {t('organisation.logo.hint', { count: MAX_LOGO_MIB })}
        </p>
      </div>
      {#if shown}
        <div class="card-actions">
          <button type="button" class="btn btn-ghost btn-sm" disabled={busy} onclick={remove}>
            {t('organisation.logo.remove')}
          </button>
        </div>
      {/if}
    {/if}
  </div>
</section>
