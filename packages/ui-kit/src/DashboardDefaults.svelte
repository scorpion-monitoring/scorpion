<script lang="ts">
  // "Dashboard defaults" (FEATURES §3.8): the service, range and thematic category a **new** widget starts with. It edits the preference
  // `kpi.analytics.defaults` through the generic preference route and offers the same vocabularies as the widgets' own filters (the categories
  // come from the defaults route, the one list the reads use). Widgets already on the dashboard keep their settings.
  import { onMount } from 'svelte';
  import { unwrap } from '@scorpion/contracts/client';
  import Alert from './Alert.svelte';
  import { getShell } from './context.ts';
  import Dialog from './Dialog.svelte';
  import { failureMessage, failureOf } from './forms.ts';
  import { getAnalyticsReads } from './read-store.ts';
  import SettingsFields from './SettingsFields.svelte';
  import type { SettingsField } from './widget-settings.ts';

  let {
    ranges,
    onclose,
  }: {
    /** The ranges the widgets offer (the module's own list). */
    ranges: readonly string[];
    onclose: () => void;
  } = $props();

  const { t, api } = getShell();
  const reads = getAnalyticsReads();
  const PREFERENCE = 'kpi.analytics.defaults';

  const fields = $derived<SettingsField[]>([
    { kind: 'service', name: 'service' },
    { kind: 'range', name: 'range', options: [...ranges] },
    { kind: 'category', name: 'category' },
  ]);

  let draft = $state<Record<string, unknown>>({ service: null, range: '1y', category: 'all' });
  let loaded = $state(false);
  let loadFailed = $state(false);
  let saving = $state(false);
  let error = $state('');

  onMount(() => {
    reads.defaults().then(
      (own) => {
        draft = { service: own.service, range: own.range, category: own.category };
        loaded = true;
      },
      () => (loadFailed = true),
    );
  });

  async function save(event: SubmitEvent) {
    event.preventDefault();
    saving = true;
    error = '';
    try {
      const value: Record<string, unknown> = { range: draft.range, category: draft.category };
      if (typeof draft.service === 'string') value.service = draft.service;
      await unwrap(
        api.PUT('/preferences/{key}', { params: { path: { key: PREFERENCE } }, body: { value } }),
      );
      reads.invalidate('defaults');
      onclose();
    } catch (failure) {
      error = failureMessage(failureOf(failure), t);
    } finally {
      saving = false;
    }
  }
</script>

<Dialog open={true} title={t('kit.defaults.title')} {onclose}>
  <form class="flex flex-col gap-4" onsubmit={save} novalidate>
    <p class="text-sm">{t('kit.defaults.intro')}</p>
    {#if loadFailed}
      <Alert kind="error">{t('kit.defaults.loadFailed')}</Alert>
    {:else if !loaded}
      <p role="status">{t('kit.widget.loading')}</p>
    {:else}
      <SettingsFields {fields} bind:draft />
    {/if}
    {#if error}<Alert kind="error">{error}</Alert>{/if}
    <div class="flex justify-end gap-2">
      <button type="button" class="btn" onclick={onclose}>{t('kit.widget.cancel')}</button>
      <button type="submit" class="btn btn-primary" disabled={!loaded || saving} aria-busy={saving}>
        {t('kit.defaults.save')}
      </button>
    </div>
  </form>
</Dialog>
