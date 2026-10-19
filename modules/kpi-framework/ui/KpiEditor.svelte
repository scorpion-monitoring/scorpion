<script lang="ts">
  // The KPIs of one service, as one editor for the two places that change them: the wizard step (before the service
  // exists) and the service page (after). A select for the KPI set, the effective list below it (the set's rows are
  // locked, each with its necessity; an extra can be removed) and a search to add indicators the set does not have. It
  // holds no value of its own: the parent gives the set and the extras and hears every change. The rule that says what
  // is in the list is the one the server applies (`mergeEffective`).
  import { unwrap } from '@scorpion/contracts/client';
  import { getShell } from '@scorpion/ui-kit';
  import { mergeEffective } from '../service/merge.ts';
  import type { Known, KpisValue } from './kpi-types.ts';
  import { labelOf, type Term } from './terms.ts';
  import { vocabularyTerms } from './vocabulary.ts';

  let {
    id,
    sets,
    setId,
    extras,
    known,
    onchange,
    disabled = false,
    errors = [],
  }: {
    id: string;
    sets: readonly { id: string; name: string }[];
    setId: string | null;
    extras: readonly string[];
    /** The indicators the parent already knows (the extras of a stored service). */
    known: readonly Known[];
    onchange: (next: KpisValue) => void;
    disabled?: boolean;
    errors?: readonly string[];
  } = $props();

  const { t, api, locale } = getShell();
  const PAGE_SIZE = 8;

  // What this editor has learned of indicators (the parent's, and each one the person added).
  // svelte-ignore state_referenced_locally
  let learned = $state<Record<string, Known>>(
    Object.fromEntries(known.map((k) => [k.indicatorId, k])),
  );
  $effect(() => {
    for (const entry of known) learned[entry.indicatorId] ??= entry;
  });

  // ----- the rows of the chosen set --------------------------------------------------------------------
  let setRows = $state<
    { indicatorId: string; name: string; unit: string | null; necessity: string }[]
  >([]);
  let setFailed = $state(false);
  let necessity = $state<Term[]>([]);
  let units = $state<Term[]>([]);

  $effect(() => {
    const wanted = setId;
    setFailed = false;
    if (!wanted) {
      setRows = [];
      return;
    }
    let current = true;
    unwrap(api.GET('/kpi/sets/{id}', { params: { path: { id: wanted } } })).then(
      (answer) => {
        if (current)
          setRows = answer.indicators.map((row) => ({
            indicatorId: row.indicatorId,
            name: row.name,
            unit: row.unit,
            necessity: row.necessity,
          }));
      },
      () => {
        if (current) {
          setRows = [];
          setFailed = true;
        }
      },
    );
    return () => {
      current = false;
    };
  });

  const rows = $derived(
    mergeEffective(
      setRows,
      extras.flatMap((extra) => (learned[extra] ? [learned[extra]] : [])),
    ),
  );

  $effect(() => {
    // The words of the necessity and the unit come from the vocabularies, read once per session and only when a row needs them.
    if (rows.length === 0) return;
    void vocabularyTerms(api, 'necessity').then(
      (terms) => (necessity = terms),
      () => {},
    );
    void vocabularyTerms(api, 'kpi.unit').then(
      (terms) => (units = terms),
      () => {},
    );
  });

  // ----- the search for extras ---------------------------------------------------------------------------
  let search = $state('');
  let query = $state('');
  let page = $state(0);
  let results = $state<Known[]>([]);
  let total = $state(0);
  let searchFailed = $state(false);
  // Nothing is asked until the person searches: the step costs no call while it is only looked at.
  let searched = $state(false);
  const pages = $derived(Math.max(1, Math.ceil(total / PAGE_SIZE)));

  $effect(() => {
    if (!searched) return;
    const asked = { q: query, page };
    let current = true;
    searchFailed = false;
    unwrap(
      api.GET('/kpi/indicators', {
        params: {
          query: {
            page: String(asked.page),
            pageSize: String(PAGE_SIZE),
            ...(asked.q && { q: asked.q }),
          },
        },
      }),
    ).then(
      (answer) => {
        if (!current) return;
        results = answer.result.map((row) => ({
          indicatorId: row.id,
          name: row.name,
          unit: row.unit,
        }));
        total = answer.metadata.totalCount;
      },
      () => {
        if (current) searchFailed = true;
      },
    );
    return () => {
      current = false;
    };
  });

  const inList = (indicatorId: string) => rows.some((row) => row.indicatorId === indicatorId);

  function add(entry: Known) {
    learned[entry.indicatorId] = entry;
    onchange({ setId, extras: [...extras, entry.indicatorId] });
  }
  function remove(indicatorId: string) {
    onchange({ setId, extras: extras.filter((extra) => extra !== indicatorId) });
  }
  const unitLabel = (key: string | null) => (key ? labelOf(units, key, locale()) : '');
  const hintId = $derived(`${id}-hint`);
  const errorId = $derived(`${id}-error`);
</script>

<div class="flex flex-col gap-4">
  <div class="flex flex-col gap-1">
    <label class="text-sm font-medium" for="{id}-set">{t('kpi.editor.set')}</label>
    <select
      id="{id}-set"
      class="select select-bordered w-full max-w-md"
      {disabled}
      aria-invalid={errors.length > 0 ? 'true' : undefined}
      aria-describedby={errors.length > 0 ? errorId : undefined}
      value={setId ?? ''}
      onchange={(event) =>
        onchange({ setId: event.currentTarget.value || null, extras: [...extras] })}
    >
      <option value="">{t('kpi.editor.noSet')}</option>
      {#each sets as option (option.id)}
        <option value={option.id}>{option.name}</option>
      {/each}
    </select>
    {#if errors.length > 0}<p id={errorId} class="text-error text-sm">{errors.join(' ')}</p>{/if}
    {#if setFailed}<p class="text-error text-sm" role="alert">{t('kpi.editor.setFailed')}</p>{/if}
  </div>

  <div class="flex flex-col gap-2">
    <h3 class="font-semibold">{t('kpi.editor.rows')}</h3>
    {#if rows.length === 0}
      <p class="text-sm opacity-70">{t('kpi.editor.rows.empty')}</p>
    {:else}
      <div class="overflow-x-auto">
        <table class="table table-sm">
          <caption class="sr-only">{t('kpi.editor.rows')}</caption>
          <thead>
            <tr>
              <th scope="col">{t('kpi.editor.col.name')}</th>
              <th scope="col">{t('kpi.editor.col.unit')}</th>
              <th scope="col">{t('kpi.editor.col.necessity')}</th>
              <th scope="col">{t('kpi.editor.col.source')}</th>
            </tr>
          </thead>
          <tbody>
            {#each rows as row (row.indicatorId)}
              <tr>
                <td>{row.name}</td>
                <td>{unitLabel(row.unit)}</td>
                <td
                  ><span class="badge badge-outline"
                    >{labelOf(necessity, row.necessity, locale())}</span
                  ></td
                >
                <td>
                  {#if row.source === 'set'}
                    <span class="opacity-70">{t('kpi.editor.source.set')}</span>
                  {:else}
                    <span class="me-2 opacity-70">{t('kpi.editor.source.extra')}</span>
                    <button
                      type="button"
                      class="btn btn-xs"
                      {disabled}
                      aria-label={t('kpi.editor.remove', { name: row.name })}
                      onclick={() => remove(row.indicatorId)}
                    >
                      {t('kpi.editor.removeShort')}
                    </button>
                  {/if}
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    {/if}
  </div>

  <fieldset class="flex flex-col gap-2" {disabled}>
    <legend class="font-semibold">{t('kpi.editor.extras')}</legend>
    <p id={hintId} class="text-sm opacity-70">{t('kpi.editor.extras.help')}</p>
    <form
      class="flex flex-wrap items-end gap-2"
      onsubmit={(event) => {
        event.preventDefault();
        query = search.trim();
        page = 0;
        searched = true;
      }}
    >
      <div class="flex flex-col gap-1">
        <label class="text-sm font-medium" for="{id}-search">{t('kpi.editor.search')}</label>
        <input
          id="{id}-search"
          class="input input-bordered"
          type="search"
          maxlength="100"
          aria-describedby={hintId}
          bind:value={search}
        />
      </div>
      <button type="submit" class="btn">{t('kpi.editor.search.submit')}</button>
    </form>
    {#if !searched}
      <p class="text-sm opacity-70">{t('kpi.editor.results.hint')}</p>
    {:else if searchFailed}
      <p class="text-error text-sm" role="alert">{t('kpi.editor.loadFailed')}</p>
    {:else if results.length === 0}
      <p class="text-sm opacity-70">{t('kpi.editor.results.empty')}</p>
    {:else}
      <ul class="list-none">
        {#each results as entry (entry.indicatorId)}
          <li class="flex items-center justify-between gap-2 py-1">
            <span>{entry.name}</span>
            {#if inList(entry.indicatorId)}
              <span class="text-sm opacity-70">{t('kpi.editor.added')}</span>
            {:else}
              <button
                type="button"
                class="btn btn-xs"
                aria-label={t('kpi.editor.add', { name: entry.name })}
                onclick={() => add(entry)}
              >
                {t('kpi.editor.addShort')}
              </button>
            {/if}
          </li>
        {/each}
      </ul>
      <div class="flex items-center gap-2">
        <button type="button" class="btn btn-xs" disabled={page === 0} onclick={() => (page -= 1)}>
          {t('kpi.editor.prev')}
        </button>
        <span class="text-sm">{t('kpi.editor.page', { page: page + 1, pages })}</span>
        <button
          type="button"
          class="btn btn-xs"
          disabled={page + 1 >= pages}
          onclick={() => (page += 1)}
        >
          {t('kpi.editor.next')}
        </button>
      </div>
    {/if}
  </fieldset>
</div>
