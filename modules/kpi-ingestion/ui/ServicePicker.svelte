<script lang="ts">
  // The picker: a search box (by name or short name) and a select of the services the person may report for. The list comes from the server and
  // holds only those services; the choice is remembered in the address (`?service=`), so a link opens the same page. Searching and opening are
  // buttons, not `change` handlers, so a person who moves through the select with the arrow keys sends nothing per key.
  import { getShell, SubmitButton } from '@scorpion/ui-kit';
  import { PICKER_PAGE_SIZE } from './limits.ts';
  import { submitQueryString } from './query.ts';
  import type { PickerService } from './types.ts';

  let {
    services,
    selected,
    q,
  }: {
    services: readonly PickerService[];
    /** The service of the address, listed even when the search does not match it. */
    selected: { id: string; slug: string; name: string } | undefined;
    q: string | undefined;
  } = $props();
  const { t, href, goto } = getShell();

  let search = $derived(q ?? '');
  let choice = $derived(selected?.id ?? services[0]?.id ?? '');
  const options = $derived(
    selected && !services.some((service) => service.id === selected.id)
      ? [selected, ...services]
      : [...services],
  );
</script>

<div class="flex flex-wrap items-end gap-4">
  <form
    role="search"
    class="flex items-end gap-2"
    onsubmit={(event) => {
      event.preventDefault();
      void goto(href('/submit' + submitQueryString({ service: selected?.id, q: search.trim() })));
    }}
  >
    <div class="flex flex-col gap-1">
      <label class="text-sm font-medium" for="submit-search">{t('submit.picker.search')}</label>
      <input
        id="submit-search"
        type="search"
        class="input input-bordered"
        maxlength={100}
        autocomplete="off"
        aria-describedby="submit-search-hint"
        bind:value={search}
      />
      <span id="submit-search-hint" class="text-xs opacity-70"
        >{t('submit.picker.search.hint')}</span
      >
    </div>
    <SubmitButton variant="ghost">{t('submit.picker.search.submit')}</SubmitButton>
  </form>

  {#if options.length > 0}
    <form
      class="flex items-end gap-2"
      onsubmit={(event) => {
        event.preventDefault();
        if (choice) void goto(href('/submit' + submitQueryString({ service: choice, q })));
      }}
    >
      <div class="flex flex-col gap-1">
        <label class="text-sm font-medium" for="submit-service">{t('submit.picker.select')}</label>
        <select id="submit-service" class="select select-bordered" bind:value={choice}>
          {#each options as service (service.id)}
            <option value={service.id}>{service.name} ({service.slug})</option>
          {/each}
        </select>
      </div>
      <SubmitButton>{t('submit.picker.open')}</SubmitButton>
    </form>
  {/if}
</div>
{#if services.length >= PICKER_PAGE_SIZE}
  <p class="text-sm opacity-70">{t('submit.picker.more', { count: PICKER_PAGE_SIZE })}</p>
{/if}
