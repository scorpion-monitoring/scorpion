<script lang="ts">
  // The widget `license`: a searchable list of the SPDX licences (`GET /licenses`, which matches the id and
  // the name). Each result says in words whether it is OSI approved and whether it is deprecated (a
  // deprecated id is accepted for a service, and marked). The value is the SPDX id. The server checks the id
  // again; an id it does not know is a 422 on this field.
  import { unwrap } from '@scorpion/contracts/client';
  import { FieldShell, getShell, type WidgetProps } from '@scorpion/ui-kit';

  let { node, value, onchange, errors, disabled }: WidgetProps = $props();
  const { t, api } = getShell();

  interface Licence {
    id: string;
    name: string;
    osiApproved: boolean;
    deprecated: boolean;
  }
  const LIMIT = 20;
  const DELAY_MS = 250;

  let query = $state('');
  let results = $state<Licence[]>([]);
  let searched = $state(false);
  let failed = $state(false);
  // The licence chosen in this session carries its name; a value that arrives otherwise (the console) shows its id.
  let known = $state<Licence | undefined>();

  const chosenId = $derived(typeof value === 'string' && value !== '' ? value : undefined);
  const chosenName = $derived(known && known.id === chosenId ? known.name : chosenId);

  let timer: ReturnType<typeof setTimeout> | undefined;
  let latest = 0;
  async function search(text: string) {
    const mine = ++latest;
    try {
      const found = await unwrap(
        api.GET('/licenses', { params: { query: { q: text, limit: LIMIT } } }),
      );
      if (mine !== latest) return;
      results = found.result;
      failed = false;
    } catch {
      if (mine !== latest) return;
      results = [];
      failed = true;
    }
    searched = true;
  }
  function typed(text: string) {
    query = text;
    clearTimeout(timer);
    if (text.trim() === '') {
      latest += 1;
      results = [];
      searched = false;
      return;
    }
    timer = setTimeout(() => void search(text.trim()), DELAY_MS);
  }
  $effect(() => () => clearTimeout(timer));

  // The widget is drawn again each time the person comes back to its step, and a value can arrive from the
  // console: the name of a chosen id is asked of the list when this widget does not know it.
  $effect(() => {
    const id = chosenId;
    if (id === undefined || known?.id === id) return;
    void (async () => {
      try {
        const found = await unwrap(
          api.GET('/licenses', { params: { query: { q: id, limit: 5 } } }),
        );
        const hit = found.result.find((licence) => licence.id.toLowerCase() === id.toLowerCase());
        if (hit && chosenId === id) known = hit;
      } catch {
        // The id is shown as it is; the server judges it on create.
      }
    })();
  });

  function choose(licence: Licence) {
    known = licence;
    onchange(licence.id);
  }
  const status = $derived(
    failed
      ? t('services.license.failed')
      : !searched
        ? ''
        : results.length === 0
          ? t('services.license.none')
          : t(
              results.length === 1 ? 'services.license.found.one' : 'services.license.found.other',
              {
                count: results.length,
              },
            ),
  );
</script>

<FieldShell
  label={node.label}
  hint={node.description}
  {errors}
  required={node.required}
  requiredText={t('kit.form.required')}
>
  {#snippet children({ id, describedBy, invalid })}
    {#if chosenId}
      <p class="flex flex-wrap items-center gap-2">
        <span>{t('services.license.chosen', { name: chosenName ?? '' })}</span>
        {#if known && known.id === chosenId}
          {#if known.osiApproved}<span class="badge badge-ghost">{t('services.license.osi')}</span
            >{/if}
          {#if known.deprecated}<span class="badge badge-warning"
              >{t('services.license.deprecated')}</span
            >{/if}
        {/if}
        <button
          type="button"
          class="btn btn-ghost btn-sm"
          {disabled}
          onclick={() => onchange(undefined)}
        >
          {t('services.license.clear')}
        </button>
      </p>
    {/if}
    <input
      {id}
      type="search"
      class="input input-bordered w-full"
      class:input-error={invalid}
      autocomplete="off"
      placeholder={t('services.license.placeholder')}
      aria-describedby={describedBy}
      aria-invalid={invalid ? 'true' : undefined}
      {disabled}
      value={query}
      oninput={(event) => typed(event.currentTarget.value)}
    />
    <p class="text-sm opacity-70" role="status">{status}</p>
    {#if results.length > 0}
      <ul class="menu bg-base-200 rounded-box max-h-64 flex-nowrap overflow-y-auto">
        {#each results as licence (licence.id)}
          <li>
            <button
              type="button"
              {disabled}
              aria-pressed={chosenId === licence.id}
              onclick={() => choose(licence)}
            >
              <span class="font-medium">{licence.name}</span>
              <span class="opacity-70">{licence.id}</span>
              {#if licence.osiApproved}<span class="badge badge-ghost"
                  >{t('services.license.osi')}</span
                >{/if}
              {#if licence.deprecated}<span class="badge badge-warning"
                  >{t('services.license.deprecated')}</span
                >{/if}
            </button>
          </li>
        {/each}
      </ul>
    {/if}
  {/snippet}
</FieldShell>
