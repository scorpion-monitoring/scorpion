<script lang="ts">
  import { untrack } from 'svelte';
  import { Alert, getShell, SubmitButton } from '@scorpion/ui-kit';
  import { unwrap } from '@scorpion/contracts/client';
  import { LOCALE_PREFERENCE } from '../loaders.ts';

  let { locale: stored }: { locale: string | null } = $props();
  const { t, api, refresh } = getShell();

  // "" is "as the browser says": the preference is removed.
  let choice = $state(untrack(() => stored ?? ''));
  let busy = $state(false);
  let saved = $state(false);
  let failed = $state(false);
  const id = $props.id();

  async function submit(event: SubmitEvent) {
    event.preventDefault();
    busy = true;
    saved = false;
    failed = false;
    try {
      if (choice === '') {
        await unwrap(
          api.DELETE('/preferences/{key}', { params: { path: { key: LOCALE_PREFERENCE } } }),
        );
      } else {
        await unwrap(
          api.PUT('/preferences/{key}', {
            params: { path: { key: LOCALE_PREFERENCE } },
            body: { value: choice },
          }),
        );
      }
      saved = true;
      // The page's own language follows the preference at once.
      await refresh();
    } catch {
      failed = true;
    } finally {
      busy = false;
    }
  }
</script>

<section class="card bg-base-100 border-base-300 border" aria-labelledby="prefs-title">
  <form method="post" onsubmit={submit} class="card-body gap-4">
    <h2 id="prefs-title" class="card-title">{t('profile.prefs.title')}</h2>
    {#if saved}<Alert kind="success">{t('profile.prefs.saved')}</Alert>{/if}
    {#if failed}<Alert kind="error">{t('profile.prefs.failed')}</Alert>{/if}
    <div class="flex flex-col gap-1">
      <label class="text-sm font-medium" for="{id}-locale">{t('profile.prefs.locale')}</label>
      <select id="{id}-locale" class="select select-bordered w-full" bind:value={choice}>
        <option value="">{t('profile.prefs.locale.browser')}</option>
        <option value="en">{t('profile.prefs.locale.en')}</option>
        <option value="de">{t('profile.prefs.locale.de')}</option>
      </select>
      <p class="text-sm opacity-70">{t('profile.prefs.localeHint')}</p>
    </div>
    <p class="text-sm opacity-70">{t('profile.prefs.themeHint')}</p>
    <div class="card-actions"><SubmitButton {busy}>{t('profile.prefs.save')}</SubmitButton></div>
  </form>
</section>
