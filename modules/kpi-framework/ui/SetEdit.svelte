<script lang="ts">
  // One KPI set: the create form, and the editor with its details, its indicators (a paginated picker and a
  // necessity per row, saved together), its evaluation (a headline indicator and an aggregate) and the delete. The
  // necessities, aggregates and RIMO categories come from vocabularies and the aggregates a value type allows from
  // the registry. The server judges every value and refuses what does not fit; its words are shown here.
  import {
    Alert,
    Breadcrumb,
    ConfirmDialog,
    FieldShell,
    SubmitButton,
    failureMessage,
    failureOf,
    getShell,
    type FormFailure,
  } from '@scorpion/ui-kit';
  import { unwrap } from '@scorpion/contracts/client';
  import { usesOf } from './errors.ts';
  import { errorsFor, leftover } from './failure.ts';
  import type { SetData } from './loaders.ts';
  import {
    addRow,
    aggregateChoices,
    removeRow,
    rowsBody,
    rowsChanged,
    setNecessity,
    type Row,
  } from './rows.ts';
  import { labelOf, offered } from './terms.ts';

  type Data = SetData | (Omit<SetData, 'set'> & { set: undefined });
  let { data }: { data: Data } = $props();
  const { t, href, goto, api, toaster, locale, refresh } = getShell();

  const LIMITS = { name: 200, description: 4000 } as const;
  const PICKER_SIZE = 10;

  const stored = $derived(data.set);
  const creating = $derived(stored === undefined);
  const storedRows = $derived<Row[]>(
    (stored?.indicators ?? []).map((row) => ({
      indicatorId: row.indicatorId,
      name: row.name,
      necessity: row.necessity,
    })),
  );

  // ----- details -----
  // svelte-ignore state_referenced_locally
  let name = $state(stored?.name ?? '');
  // svelte-ignore state_referenced_locally
  let description = $state(stored?.description ?? '');
  // svelte-ignore state_referenced_locally
  let rimoCategory = $state(stored?.rimoCategory ?? '');
  let busy = $state(false);
  let failure = $state<FormFailure>();

  // ----- rows -----
  // svelte-ignore state_referenced_locally
  let rows = $state<Row[]>(storedRows);
  let rowsFailure = $state<FormFailure>();
  const dirty = $derived(rowsChanged(rows, storedRows));
  const defaultNecessity = $derived(data.necessity.find((term) => term.active)?.key ?? '');
  const headlineRemoved = $derived(
    stored?.evaluation
      ? !rows.some((row) => row.indicatorId === stored.evaluation!.indicatorId)
      : false,
  );

  // ----- evaluation -----
  // svelte-ignore state_referenced_locally
  let headline = $state(stored?.evaluation?.indicatorId ?? '');
  // svelte-ignore state_referenced_locally
  let aggregate = $state(stored?.evaluation?.aggregate ?? '');
  let evaluationFailure = $state<FormFailure>();
  const headlineType = $derived(
    data.types.find(
      (type) =>
        type.id === stored?.indicators.find((row) => row.indicatorId === headline)?.valueType,
    ),
  );
  const aggregates = $derived(
    aggregateChoices(
      headlineType?.aggregates ?? [],
      data.aggregates,
      stored?.evaluation?.indicatorId === headline ? stored?.evaluation?.aggregate : undefined,
    ),
  );

  $effect(() => {
    // A reload (after a save) brings the editor back in step with the stored record.
    if (stored) {
      name = stored.name;
      description = stored.description ?? '';
      rimoCategory = stored.rimoCategory ?? '';
      rows = storedRows;
      headline = stored.evaluation?.indicatorId ?? '';
      aggregate = stored.evaluation?.aggregate ?? '';
    }
  });

  const asFailure = (error: unknown): FormFailure => {
    const base = failureOf(error);
    if (base.status === 403) return { ...base, general: [t('kpi.set.forbidden')] };
    if (Object.keys(base.fields).length === 0 && base.general.length === 0)
      return { ...base, general: [failureMessage(base, t)] };
    return base;
  };

  async function saveDetails(event: SubmitEvent) {
    event.preventDefault();
    failure = undefined;
    busy = true;
    const body = { name, description, rimoCategory: rimoCategory || null };
    try {
      if (!stored) {
        const created = await unwrap(api.POST('/kpi/sets', { body }));
        toaster.success(t('kpi.set.form.created', { name: created.name }));
        await goto(href(`/kpi/sets/${created.id}`));
      } else {
        await unwrap(api.PUT('/kpi/sets/{id}', { params: { path: { id: stored.id } }, body }));
        toaster.success(t('kpi.set.form.saved'));
        await refresh();
      }
    } catch (error) {
      failure = asFailure(error);
    } finally {
      busy = false;
    }
  }

  async function saveRows(event: SubmitEvent) {
    event.preventDefault();
    if (!stored) return;
    rowsFailure = undefined;
    busy = true;
    try {
      await unwrap(
        api.PUT('/kpi/sets/{id}/indicators', {
          params: { path: { id: stored.id } },
          body: rowsBody(rows),
        }),
      );
      toaster.success(t('kpi.set.rows.saved'));
      await refresh();
    } catch (error) {
      rowsFailure = asFailure(error);
    } finally {
      busy = false;
    }
  }

  async function saveEvaluation(event: SubmitEvent) {
    event.preventDefault();
    if (!stored) return;
    evaluationFailure = undefined;
    busy = true;
    try {
      await unwrap(
        api.PUT('/kpi/sets/{id}/evaluation', {
          params: { path: { id: stored.id } },
          body: { indicatorId: headline, aggregate },
        }),
      );
      toaster.success(t('kpi.set.evaluation.saved'));
      await refresh();
    } catch (error) {
      evaluationFailure = asFailure(error);
    } finally {
      busy = false;
    }
  }

  // ----- the picker -----
  let pickerSearch = $state('');
  let pickerQuery = $state('');
  let pickerPage = $state(0);
  let picker = $state<{ id: string; name: string }[]>([]);
  let pickerTotal = $state(0);
  let pickerFailed = $state(false);
  const pickerPages = $derived(Math.max(1, Math.ceil(pickerTotal / PICKER_SIZE)));

  async function loadPicker() {
    pickerFailed = false;
    try {
      const answer = await unwrap(
        api.GET('/kpi/indicators', {
          params: {
            query: {
              page: String(pickerPage),
              pageSize: String(PICKER_SIZE),
              ...(pickerQuery && { q: pickerQuery }),
            },
          },
        }),
      );
      picker = answer.result.map((row) => ({ id: row.id, name: row.name }));
      pickerTotal = answer.metadata.totalCount;
    } catch {
      pickerFailed = true;
    }
  }

  $effect(() => {
    // Loads the first page when the editor opens, and again when the page or the search changes.
    if (stored) void loadPicker();
  });

  // ----- delete -----
  let confirming = $state(false);
  let failedDelete = $state<string>();
  const useWords = (uses: NonNullable<ReturnType<typeof usesOf>>) =>
    uses
      .map((use) =>
        use.what === 'sets' || use.what === 'evaluations' || use.what === 'services'
          ? t(`kpi.use.${use.what}`, { count: use.count })
          : t('kpi.use.other', { count: use.count, what: use.what }),
      )
      .join(', ');

  async function remove() {
    if (!stored) return;
    busy = true;
    failedDelete = undefined;
    try {
      await unwrap(api.DELETE('/kpi/sets/{id}', { params: { path: { id: stored.id } } }));
      toaster.success(t('kpi.set.delete.done', { name: stored.name }));
      await goto(href('/kpi/sets'));
    } catch (error) {
      const uses = usesOf(error);
      failedDelete = uses
        ? uses.length > 0
          ? t('kpi.set.delete.inUse', { uses: useWords(uses) })
          : t('kpi.set.delete.inUse.unnamed')
        : failureMessage(failureOf(error), t, { 404: t('kpi.set.delete.gone') });
      confirming = false;
    } finally {
      busy = false;
    }
  }

  const categories = $derived(offered(data.categories, rimoCategory ? [rimoCategory] : []));
  const necessities = (current: string) => offered(data.necessity, [current]);
  const detailsSummary = $derived(leftover(failure, ['name', 'description', 'rimoCategory']));
  const rowsSummary = $derived(leftover(rowsFailure, []));
  const evaluationSummary = $derived(leftover(evaluationFailure, ['indicatorId', 'aggregate']));
  const pickerTitleId = 'set-picker-title';
</script>

<svelte:head>
  <title>{stored ? stored.name : t('kpi.set.new')}</title>
</svelte:head>

<div class="flex max-w-4xl flex-col gap-6">
  <Breadcrumb
    items={[
      { label: t('nav.section.admin') },
      { label: t('kpi.sets.title'), href: href('/kpi/sets') },
      { label: stored ? stored.name : t('kpi.set.new') },
    ]}
  />
  <h1 class="text-2xl font-bold">{stored ? stored.name : t('kpi.set.new')}</h1>

  {#if failedDelete}<Alert kind="error">{failedDelete}</Alert>{/if}

  <section class="card bg-base-100 border-base-300 border" aria-labelledby="set-form-title">
    <div class="card-body gap-4">
      <h2 id="set-form-title" class="card-title">{t('kpi.set.form.title')}</h2>
      {#if detailsSummary.length > 0}
        <Alert kind="error">
          <ul class="list-disc pl-5">
            {#each detailsSummary as message (message)}<li>{message}</li>{/each}
          </ul>
        </Alert>
      {/if}
      <form class="flex flex-col gap-4" onsubmit={saveDetails} novalidate>
        <FieldShell
          label={t('kpi.set.form.name')}
          hint={t('kpi.set.form.name.help', { max: LIMITS.name })}
          errors={errorsFor(failure, 'name')}
          required
          requiredText={t('kit.form.required')}
        >
          {#snippet children({ id, describedBy, invalid })}
            <input
              {id}
              class="input input-bordered w-full"
              class:input-error={invalid}
              aria-invalid={invalid ? 'true' : undefined}
              aria-describedby={describedBy}
              maxlength={LIMITS.name}
              bind:value={name}
            />
          {/snippet}
        </FieldShell>
        <FieldShell
          label={t('kpi.set.form.description')}
          hint={t('kpi.set.form.description.help', { max: LIMITS.description })}
          errors={errorsFor(failure, 'description')}
        >
          {#snippet children({ id, describedBy, invalid })}
            <textarea
              {id}
              class="textarea textarea-bordered w-full"
              class:textarea-error={invalid}
              rows="3"
              aria-invalid={invalid ? 'true' : undefined}
              aria-describedby={describedBy}
              maxlength={LIMITS.description}
              bind:value={description}></textarea>
          {/snippet}
        </FieldShell>
        <FieldShell
          label={t('kpi.set.form.category')}
          hint={t('kpi.set.form.category.help')}
          errors={errorsFor(failure, 'rimoCategory')}
        >
          {#snippet children({ id, describedBy, invalid })}
            <select
              {id}
              class="select select-bordered w-full"
              class:select-error={invalid}
              aria-invalid={invalid ? 'true' : undefined}
              aria-describedby={describedBy}
              bind:value={rimoCategory}
            >
              <option value="">{t('kpi.set.form.category.none')}</option>
              {#each categories as term (term.key)}
                <option value={term.key}>{labelOf(data.categories, term.key, locale())}</option>
              {/each}
            </select>
          {/snippet}
        </FieldShell>
        <div>
          <SubmitButton {busy}>
            {creating ? t('kpi.set.form.create') : t('kpi.set.form.save')}
          </SubmitButton>
        </div>
      </form>
    </div>
  </section>

  {#if stored}
    <section class="card bg-base-100 border-base-300 border" aria-labelledby="set-rows-title">
      <div class="card-body gap-4">
        <h2 id="set-rows-title" class="card-title">{t('kpi.set.rows.title')}</h2>
        <p>{t('kpi.set.rows.lead')}</p>
        {#if rowsSummary.length > 0}
          <Alert kind="error">
            <p class="font-medium">{t('kpi.set.rows.problems')}</p>
            <ul class="list-disc pl-5">
              {#each rowsSummary as message (message)}<li>{message}</li>{/each}
            </ul>
          </Alert>
        {/if}

        <form class="flex flex-col gap-3" onsubmit={saveRows} novalidate>
          {#if rows.length === 0}
            <p class="opacity-70">{t('kpi.set.rows.empty')}</p>
          {:else}
            <div class="overflow-x-auto">
              <table class="table">
                <caption class="sr-only">{t('kpi.set.rows.title')}</caption>
                <thead>
                  <tr>
                    <th scope="col">{t('kpi.set.rows.indicator')}</th>
                    <th scope="col">{t('kpi.set.rows.necessity')}</th>
                    <th scope="col"
                      ><span class="sr-only">{t('kpi.set.rows.remove', { name: '' })}</span></th
                    >
                  </tr>
                </thead>
                <tbody>
                  {#each rows as row, index (row.indicatorId)}
                    <tr>
                      <th scope="row" class="font-medium">{row.name}</th>
                      <td>
                        <select
                          class="select select-bordered select-sm"
                          aria-label={t('kpi.set.rows.necessityOf', { name: row.name })}
                          aria-invalid={errorsFor(rowsFailure, `indicators[${index}].necessity`)
                            .length > 0
                            ? 'true'
                            : undefined}
                          value={row.necessity}
                          onchange={(event) =>
                            (rows = setNecessity(rows, row.indicatorId, event.currentTarget.value))}
                        >
                          {#each necessities(row.necessity) as term (term.key)}
                            <option value={term.key}>
                              {labelOf(data.necessity, term.key, locale())}
                            </option>
                          {/each}
                        </select>
                      </td>
                      <td class="text-right">
                        <button
                          type="button"
                          class="btn btn-ghost btn-sm"
                          aria-label={t('kpi.set.rows.remove', { name: row.name })}
                          onclick={() => (rows = removeRow(rows, row.indicatorId))}
                        >
                          ✕
                        </button>
                      </td>
                    </tr>
                  {/each}
                </tbody>
              </table>
            </div>
          {/if}
          {#if headlineRemoved}
            <p class="text-warning text-sm" role="status">{t('kpi.set.rows.evaluationRemoved')}</p>
          {/if}
          {#if dirty}<p class="text-sm opacity-70" role="status">
              {t('kpi.set.rows.unsaved')}
            </p>{/if}
          <div>
            <SubmitButton {busy}>{t('kpi.set.rows.save')}</SubmitButton>
          </div>
        </form>

        <div class="border-base-300 flex flex-col gap-3 border-t pt-4">
          <h3 id={pickerTitleId} class="font-semibold">{t('kpi.set.picker.title')}</h3>
          <form
            role="search"
            class="flex items-end gap-2"
            onsubmit={(event) => {
              event.preventDefault();
              pickerQuery = pickerSearch.trim();
              pickerPage = 0;
            }}
          >
            <div class="flex flex-col gap-1">
              <label class="text-sm font-medium" for="picker-search">
                {t('kpi.set.picker.search')}
              </label>
              <input
                id="picker-search"
                type="search"
                class="input input-bordered"
                maxlength={100}
                autocomplete="off"
                bind:value={pickerSearch}
              />
            </div>
            <button type="submit" class="btn">{t('kpi.set.picker.searchSubmit')}</button>
          </form>
          {#if pickerFailed}
            <Alert kind="error">{t('kpi.set.picker.failed')}</Alert>
          {:else if picker.length === 0}
            <p class="opacity-70">{t('kpi.set.picker.empty')}</p>
          {:else}
            <ul class="flex flex-col gap-1" aria-labelledby={pickerTitleId}>
              {#each picker as candidate (candidate.id)}
                <li class="flex items-center justify-between gap-2">
                  <span>{candidate.name}</span>
                  {#if rows.some((row) => row.indicatorId === candidate.id)}
                    <span class="badge badge-outline">{t('kpi.set.picker.added')}</span>
                  {:else}
                    <button
                      type="button"
                      class="btn btn-sm"
                      aria-label={t('kpi.set.picker.add', { name: candidate.name })}
                      onclick={() => (rows = addRow(rows, candidate, defaultNecessity))}
                    >
                      +
                    </button>
                  {/if}
                </li>
              {/each}
            </ul>
            <nav class="flex items-center gap-2" aria-label={t('kpi.set.picker.title')}>
              <button
                type="button"
                class="btn btn-sm"
                disabled={pickerPage === 0}
                onclick={() => (pickerPage -= 1)}
              >
                {t('kpi.set.picker.previous')}
              </button>
              <span class="text-sm" aria-live="polite">
                {t('kpi.set.picker.page', { page: pickerPage + 1, pages: pickerPages })}
              </span>
              <button
                type="button"
                class="btn btn-sm"
                disabled={pickerPage + 1 >= pickerPages}
                onclick={() => (pickerPage += 1)}
              >
                {t('kpi.set.picker.next')}
              </button>
            </nav>
          {/if}
        </div>
      </div>
    </section>

    <section class="card bg-base-100 border-base-300 border" aria-labelledby="set-evaluation-title">
      <div class="card-body gap-4">
        <h2 id="set-evaluation-title" class="card-title">{t('kpi.set.evaluation.title')}</h2>
        <p>{t('kpi.set.evaluation.lead')}</p>
        {#if evaluationSummary.length > 0}
          <Alert kind="error">
            <p class="font-medium">{t('kpi.set.evaluation.problems')}</p>
            <ul class="list-disc pl-5">
              {#each evaluationSummary as message (message)}<li>{message}</li>{/each}
            </ul>
          </Alert>
        {/if}
        {#if storedRows.length === 0}
          <p class="opacity-70">{t('kpi.set.evaluation.noRows')}</p>
        {:else}
          {#if dirty}<p class="text-sm opacity-70" role="status">
              {t('kpi.set.evaluation.unsavedRows')}
            </p>{/if}
          <form class="flex flex-col gap-4" onsubmit={saveEvaluation} novalidate>
            <FieldShell
              label={t('kpi.set.evaluation.indicator')}
              errors={errorsFor(evaluationFailure, 'indicatorId')}
            >
              {#snippet children({ id, describedBy, invalid })}
                <select
                  {id}
                  class="select select-bordered w-full"
                  class:select-error={invalid}
                  aria-invalid={invalid ? 'true' : undefined}
                  aria-describedby={describedBy}
                  bind:value={headline}
                  onchange={() => (aggregate = '')}
                >
                  <option value="">{t('kpi.set.evaluation.indicator.choose')}</option>
                  {#each storedRows as row (row.indicatorId)}
                    <option value={row.indicatorId}>{row.name}</option>
                  {/each}
                </select>
              {/snippet}
            </FieldShell>
            <FieldShell
              label={t('kpi.set.evaluation.aggregate')}
              hint={headline && aggregates.length === 0
                ? t('kpi.set.evaluation.aggregate.none')
                : undefined}
              errors={errorsFor(evaluationFailure, 'aggregate')}
            >
              {#snippet children({ id, describedBy, invalid })}
                <select
                  {id}
                  class="select select-bordered w-full"
                  class:select-error={invalid}
                  aria-invalid={invalid ? 'true' : undefined}
                  aria-describedby={describedBy}
                  disabled={!headline || aggregates.length === 0}
                  bind:value={aggregate}
                >
                  <option value="">{t('kpi.set.evaluation.aggregate.choose')}</option>
                  {#each aggregates as key (key)}
                    <option value={key}>{labelOf(data.aggregates, key, locale())}</option>
                  {/each}
                </select>
              {/snippet}
            </FieldShell>
            <div>
              <SubmitButton {busy}>{t('kpi.set.evaluation.save')}</SubmitButton>
            </div>
          </form>
        {/if}
      </div>
    </section>

    <section class="card bg-base-100 border-base-300 border" aria-labelledby="set-ids-title">
      <div class="card-body gap-2">
        <h2 id="set-ids-title" class="card-title">{t('kpi.set.slug')}</h2>
        <p><code>{stored.slug}</code></p>
        <p class="text-sm">
          <span class="font-medium">{t('kpi.set.iri')}:</span>
          <code class="break-all">{stored.iri}</code>
        </p>
      </div>
    </section>

    <section class="card bg-base-100 border-base-300 border" aria-labelledby="set-delete-title">
      <div class="card-body gap-3">
        <h2 id="set-delete-title" class="card-title">{t('kpi.set.delete.title')}</h2>
        <p>{t('kpi.set.delete.lead')}</p>
        <div class="card-actions">
          <button
            type="button"
            class="btn btn-error btn-outline btn-sm"
            onclick={() => (confirming = true)}
          >
            {t('kpi.set.delete.button')}
          </button>
        </div>
      </div>
    </section>
  {:else}
    <p class="opacity-70">{t('kpi.set.afterCreate')}</p>
  {/if}
</div>

{#if stored}
  <ConfirmDialog
    open={confirming}
    title={t('kpi.set.delete.confirmTitle', { name: stored.name })}
    message={t('kpi.set.delete.confirmMessage')}
    confirmLabel={t('kpi.set.delete.confirm')}
    {busy}
    onconfirm={remove}
    oncancel={() => (confirming = false)}
  />
{/if}
