<script lang="ts">
  // The notification preferences: per category, whether the person wants the mail and the item in the inbox.
  // The list of categories is what the running profile sends (`GET /notifications/preferences/categories`),
  // never a list of this page. A category whose messages are all mandatory (security notices) is shown
  // locked, with the reason. Saving replaces the stored object (`PUT /preferences/notifications.preferences`).
  import { onMount } from 'svelte';
  import {
    Alert,
    Breadcrumb,
    failureMessage,
    failureOf,
    getShell,
    SubmitButton,
  } from '@scorpion/ui-kit';
  import { unwrap } from '@scorpion/contracts/client';
  import type { PreferencesData } from './loaders.ts';
  import { describe, rowsOf, sameRows, valueOf, type Row } from './prefs.ts';

  let { data }: { data: PreferencesData } = $props();
  const { t, api, locale, refresh, toaster, guardLeave } = getShell();

  // The switches as they are on the page; they start from what is stored and go back to it on a reload.
  let edited = $state<Row[]>();
  const saved = $derived(rowsOf(data.categories, data.stored));
  const rows = $derived(edited ?? saved);
  const dirty = $derived(edited !== undefined && !sameRows(edited, saved));
  let busy = $state(false);
  let failed = $state<string>();

  onMount(() => guardLeave(() => dirty));

  function set(category: string, channel: 'email' | 'inApp', on: boolean) {
    edited = rows.map((row) => (row.category === category ? { ...row, [channel]: on } : row));
  }

  async function save(event: SubmitEvent) {
    event.preventDefault();
    busy = true;
    failed = undefined;
    try {
      await unwrap(
        api.PUT('/preferences/{key}', {
          params: { path: { key: 'notifications.preferences' } },
          body: { value: valueOf(rows, data.stored) },
        }),
      );
      toaster.success(t('prefs.saved'));
      edited = undefined;
      await refresh();
    } catch (error) {
      failed = failureMessage(failureOf(error), t);
    } finally {
      busy = false;
    }
  }

  const named = (category: string) => {
    const key = `prefs.category.${category}`;
    const text = t(key);
    return text === key ? category : text;
  };
</script>

<svelte:head><title>{t('prefs.title')}</title></svelte:head>

<div class="mx-auto flex max-w-3xl flex-col gap-6">
  <Breadcrumb items={[{ label: t('nav.section.account') }, { label: t('prefs.title') }]} />
  <h1 class="text-2xl font-bold">{t('prefs.title')}</h1>
  <p>{t('prefs.lead')}</p>
  {#if failed}<Alert kind="error">{failed}</Alert>{/if}

  <form class="flex flex-col gap-4" onsubmit={save}>
    {#each rows as row (row.category)}
      {@const category = data.categories.find((entry) => entry.category === row.category)!}
      {@const about = describe(category, locale())}
      <fieldset class="border-base-300 rounded-box border p-4">
        <legend class="px-1 font-semibold">{named(row.category)}</legend>
        {#if about}<p class="mb-2 text-sm opacity-80">{about}</p>{/if}
        {#if row.mandatory}
          <p class="mb-2 text-sm" id={`locked-${row.category}`}>{t('prefs.locked')}</p>
        {/if}
        <div class="flex flex-wrap gap-6">
          <label class="flex items-center gap-2">
            <input
              type="checkbox"
              class="toggle toggle-sm"
              checked={row.email}
              disabled={row.mandatory || busy}
              aria-describedby={row.mandatory ? `locked-${row.category}` : undefined}
              onchange={(event) => set(row.category, 'email', event.currentTarget.checked)}
            />
            <span>{t('prefs.email')}</span>
          </label>
          <label class="flex items-center gap-2">
            <input
              type="checkbox"
              class="toggle toggle-sm"
              checked={row.inApp}
              disabled={row.mandatory || busy}
              aria-describedby={row.mandatory ? `locked-${row.category}` : undefined}
              onchange={(event) => set(row.category, 'inApp', event.currentTarget.checked)}
            />
            <span>{t('prefs.inApp')}</span>
          </label>
        </div>
      </fieldset>
    {:else}
      <p>{t('prefs.none')}</p>
    {/each}
    <div class="flex gap-2">
      <SubmitButton {busy}>{t('prefs.save')}</SubmitButton>
      <button
        type="button"
        class="btn"
        disabled={busy || !dirty}
        onclick={() => (edited = undefined)}
      >
        {t('prefs.reset')}
      </button>
    </div>
  </form>
</div>
