<script lang="ts">
  // A service picker for a widget's settings: a search box (by name or short name) and a select of the services the person may read, with
  // "Choose a service" for none. Reading is open to every holder of the plain permission (M10, decision 4), so the list is the catalogue's, not
  // the list of the services the person may report for. The search is a button (and Enter), not a request per key. The service the widget has
  // now is always an option, found by its id, even when the search does not list it.
  import { onMount } from 'svelte';
  import { unwrap } from '@scorpion/contracts/client';
  import { getShell } from './context.ts';
  import { getAnalyticsReads } from './read-store.ts';

  let {
    value,
    onchange,
    invalid = false,
  }: {
    /** The id of the chosen service, or `null`. */
    value: string | null;
    onchange: (id: string | null) => void;
    invalid?: boolean;
  } = $props();

  const { t, api } = getShell();
  const reads = getAnalyticsReads();
  const PAGE = 50;
  const id = $props.id();

  interface Option {
    id: string;
    name: string;
    slug: string;
  }
  let listed = $state<Option[]>([]);
  let current = $state<Option>();
  let search = $state('');
  let failed = $state(false);
  let loading = $state(true);

  async function load(q: string) {
    loading = true;
    failed = false;
    try {
      const page = await unwrap(
        api.GET('/services', {
          params: { query: { pageSize: String(PAGE), ...(q ? { q } : {}) } },
        }),
      );
      listed = page.result.map(({ id, name, slug }) => ({ id, name, slug }));
    } catch {
      failed = true;
    } finally {
      loading = false;
    }
  }

  onMount(() => {
    void load('');
  });

  // The service the widget has now, found by id, so it is an option however the list looks.
  $effect(() => {
    const wanted = value;
    if (wanted === null) {
      current = undefined;
      return;
    }
    reads.service(wanted).then(
      (found) => {
        if (value === wanted) current = found;
      },
      () => undefined,
    );
  });

  // The current service is listed once: the search may or may not have it, and either can arrive first.
  const options = $derived(
    current && !listed.some((option) => option.id === current!.id) ? [current, ...listed] : listed,
  );
</script>

<div class="flex flex-col gap-2">
  <div class="flex flex-col gap-1">
    <label class="text-sm font-medium" for="{id}-search">{t('kit.widget.service.search')}</label>
    <div class="flex gap-2">
      <input
        id="{id}-search"
        type="search"
        class="input input-bordered w-full"
        maxlength={100}
        autocomplete="off"
        bind:value={search}
        onkeydown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            void load(search.trim());
          }
        }}
      />
      <button type="button" class="btn btn-ghost" onclick={() => void load(search.trim())}>
        {t('kit.widget.service.searchButton')}
      </button>
    </div>
  </div>
  <div class="flex flex-col gap-1">
    <label class="text-sm font-medium" for="{id}-select">{t('kit.widget.service')}</label>
    <select
      id="{id}-select"
      class="select select-bordered w-full"
      class:select-error={invalid}
      aria-invalid={invalid ? 'true' : undefined}
      value={value ?? ''}
      onchange={(event) => onchange(event.currentTarget.value || null)}
    >
      <option value="">{t('kit.widget.service.none')}</option>
      {#each options as option (option.id)}
        <option value={option.id}>{option.name} ({option.slug})</option>
      {/each}
    </select>
  </div>
  {#if failed}
    <p class="text-error text-sm" role="alert">{t('kit.widget.service.failed')}</p>
  {:else if !loading && listed.length === 0}
    <p class="text-sm opacity-70" role="status">{t('kit.widget.service.noMatch')}</p>
  {:else if listed.length >= PAGE}
    <p class="text-sm opacity-70">{t('kit.widget.service.more', { count: PAGE })}</p>
  {/if}
</div>
