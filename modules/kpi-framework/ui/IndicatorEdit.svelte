<script lang="ts">
  // One indicator: the create form and the editor with every RIMO field, and the delete (which asks first and says
  // what still uses the indicator when the server refuses). The value types, units, categories, means and tools
  // come from the registry and the vocabularies; the form only keeps from offering what the server will refuse
  // (a qualitative indicator is a text one without bounds, only a numeric type has bounds). The server judges
  // every value; its words are shown on the fields.
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
  import {
    QUALITATIVE_TYPE,
    bodyFromForm,
    emptyForm,
    formFromIndicator,
    showsBounds,
    type IndicatorForm,
  } from './form.ts';
  import type { IndicatorData } from './loaders.ts';
  import TermChecks from './TermChecks.svelte';
  import { labelOf, offered } from './terms.ts';

  type Data = IndicatorData | (Omit<IndicatorData, 'indicator'> & { indicator: undefined });
  let { data }: { data: Data } = $props();
  const { t, href, goto, api, toaster, locale, refresh } = getShell();

  const LIMITS = { name: 200, description: 4000, example: 1000 } as const;

  const stored = $derived(data.indicator);
  const creating = $derived(stored === undefined);
  // The form starts from the stored record (or empty) and is reset when the page loads another one.
  // svelte-ignore state_referenced_locally
  let form = $state<IndicatorForm>(
    stored ? formFromIndicator(stored) : emptyForm(data.types[0]?.id ?? '', ''),
  );
  let busy = $state(false);
  let failure = $state<FormFailure>();
  let boundsInvalid = $state<('min' | 'max')[]>([]);
  let confirming = $state(false);
  let failedDelete = $state<string>();

  $effect(() => {
    // A reload of the same page (after a save) keeps the form in step with the stored record.
    if (stored) form = formFromIndicator(stored);
  });

  const bounds = $derived(showsBounds(form, data.types));
  const typeLabel = (id: string) => {
    const entry = data.types.find((type) => type.id === id);
    if (!entry) return id;
    return (entry.labels as Record<string, string | undefined>)[locale()] ?? entry.labels.en;
  };
  const units = $derived(offered(data.units, form.unit ? [form.unit] : []));
  const categories = $derived(offered(data.thematic, form.thematic ? [form.thematic] : []));
  const numberProblem = (field: 'min' | 'max') =>
    boundsInvalid.includes(field) ? [t('kpi.indicator.form.bounds.number')] : [];

  function setQualitative(checked: boolean) {
    form.qualitative = checked;
    if (checked) {
      form.valueType = QUALITATIVE_TYPE;
      form.min = '';
      form.max = '';
    }
  }

  async function submit(event: SubmitEvent) {
    event.preventDefault();
    failure = undefined;
    boundsInvalid = [];
    const built = bodyFromForm(form, data.types);
    if ('invalid' in built) {
      boundsInvalid = built.invalid;
      return;
    }
    busy = true;
    try {
      if (!stored) {
        const created = await unwrap(api.POST('/kpi/indicators', { body: built.body as never }));
        toaster.success(t('kpi.indicator.form.created', { name: created.name }));
        await goto(href(`/kpi/indicators/${created.id}`));
      } else {
        await unwrap(
          api.PUT('/kpi/indicators/{id}', {
            params: { path: { id: stored.id } },
            body: built.body as never,
          }),
        );
        toaster.success(t('kpi.indicator.form.saved'));
        await refresh();
      }
    } catch (error) {
      failure = failureOf(error);
      if (failure.status === 403) failure = { ...failure, general: [t('kpi.set.forbidden')] };
      else if (
        failure.status !== 422 &&
        failure.status !== 409 &&
        Object.keys(failure.fields).length === 0 &&
        failure.general.length === 0
      )
        failure = { ...failure, general: [failureMessage(failure, t)] };
    } finally {
      busy = false;
    }
  }

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
      await unwrap(api.DELETE('/kpi/indicators/{id}', { params: { path: { id: stored.id } } }));
      toaster.success(t('kpi.indicator.delete.done', { name: stored.name }));
      await goto(href('/kpi/indicators'));
    } catch (error) {
      const uses = usesOf(error);
      failedDelete = uses
        ? uses.length > 0
          ? t('kpi.indicator.delete.inUse', { uses: useWords(uses) })
          : t('kpi.indicator.delete.inUse.unnamed')
        : failureMessage(failureOf(error), t, { 404: t('kpi.indicator.delete.gone') });
      confirming = false;
    } finally {
      busy = false;
    }
  }

  const SHOWN = [
    'name',
    'description',
    'example',
    'qualitative',
    'valueType',
    'unit',
    'min',
    'max',
    'thematic',
    'measuredBy',
    'canBeAutomatedBy',
  ];
  const summary = $derived(leftover(failure, SHOWN));
</script>

<svelte:head>
  <title>{stored ? stored.name : t('kpi.indicator.new')}</title>
</svelte:head>

<div class="flex max-w-3xl flex-col gap-6">
  <Breadcrumb
    items={[
      { label: t('nav.section.admin') },
      { label: t('kpi.indicators.title'), href: href('/kpi/indicators') },
      { label: stored ? stored.name : t('kpi.indicator.new') },
    ]}
  />
  <h1 class="text-2xl font-bold">{stored ? stored.name : t('kpi.indicator.new')}</h1>

  {#if failedDelete}<Alert kind="error">{failedDelete}</Alert>{/if}

  <section class="card bg-base-100 border-base-300 border" aria-labelledby="indicator-form-title">
    <div class="card-body gap-4">
      <h2 id="indicator-form-title" class="card-title">{t('kpi.indicator.form.title')}</h2>
      {#if summary.length > 0}
        <Alert kind="error">
          <p class="font-medium">{t('kpi.indicator.form.problems')}</p>
          <ul class="list-disc pl-5">
            {#each summary as message (message)}<li>{message}</li>{/each}
          </ul>
        </Alert>
      {/if}
      <form class="flex flex-col gap-4" onsubmit={submit} novalidate>
        <FieldShell
          label={t('kpi.indicator.form.name')}
          hint={t('kpi.indicator.form.name.help', { max: LIMITS.name })}
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
              bind:value={form.name}
            />
          {/snippet}
        </FieldShell>

        <FieldShell
          label={t('kpi.indicator.form.description')}
          hint={t('kpi.indicator.form.description.help', { max: LIMITS.description })}
          errors={errorsFor(failure, 'description')}
        >
          {#snippet children({ id, describedBy, invalid })}
            <textarea
              {id}
              class="textarea textarea-bordered w-full"
              class:textarea-error={invalid}
              rows="4"
              aria-invalid={invalid ? 'true' : undefined}
              aria-describedby={describedBy}
              maxlength={LIMITS.description}
              bind:value={form.description}></textarea>
          {/snippet}
        </FieldShell>

        <FieldShell
          label={t('kpi.indicator.form.example')}
          hint={t('kpi.indicator.form.example.help', { max: LIMITS.example })}
          errors={errorsFor(failure, 'example')}
        >
          {#snippet children({ id, describedBy, invalid })}
            <input
              {id}
              class="input input-bordered w-full"
              class:input-error={invalid}
              aria-invalid={invalid ? 'true' : undefined}
              aria-describedby={describedBy}
              maxlength={LIMITS.example}
              bind:value={form.example}
            />
          {/snippet}
        </FieldShell>

        <FieldShell
          label={t('kpi.indicator.form.thematic')}
          errors={errorsFor(failure, 'thematic')}
          required
          requiredText={t('kit.form.required')}
        >
          {#snippet children({ id, describedBy, invalid })}
            <select
              {id}
              class="select select-bordered w-full"
              class:select-error={invalid}
              aria-invalid={invalid ? 'true' : undefined}
              aria-describedby={describedBy}
              bind:value={form.thematic}
            >
              <option value="">{t('kpi.indicator.form.thematic.choose')}</option>
              {#each categories as term (term.key)}
                <option value={term.key}>{labelOf(data.thematic, term.key, locale())}</option>
              {/each}
            </select>
          {/snippet}
        </FieldShell>

        <div class="flex flex-col gap-1">
          <label class="flex cursor-pointer items-center gap-2">
            <input
              type="checkbox"
              class="checkbox"
              checked={form.qualitative}
              onchange={(event) => setQualitative(event.currentTarget.checked)}
            />
            <span class="text-sm font-medium">{t('kpi.indicator.form.qualitative')}</span>
          </label>
          <p class="text-sm opacity-70">
            {t('kpi.indicator.form.qualitative.help', { type: typeLabel(QUALITATIVE_TYPE) })}
          </p>
          {#each errorsFor(failure, 'qualitative') as message (message)}
            <p class="text-error text-sm">{message}</p>
          {/each}
        </div>

        <FieldShell
          label={t('kpi.indicator.form.valueType')}
          errors={errorsFor(failure, 'valueType')}
          required
          requiredText={t('kit.form.required')}
        >
          {#snippet children({ id, describedBy, invalid })}
            <select
              {id}
              class="select select-bordered w-full"
              class:select-error={invalid}
              aria-invalid={invalid ? 'true' : undefined}
              aria-describedby={describedBy}
              disabled={form.qualitative}
              bind:value={form.valueType}
            >
              <option value="">{t('kpi.indicator.form.valueType.choose')}</option>
              {#each data.types as type (type.id)}
                <option value={type.id}>{typeLabel(type.id)}</option>
              {/each}
            </select>
          {/snippet}
        </FieldShell>

        <FieldShell label={t('kpi.indicator.form.unit')} errors={errorsFor(failure, 'unit')}>
          {#snippet children({ id, describedBy, invalid })}
            <select
              {id}
              class="select select-bordered w-full"
              class:select-error={invalid}
              aria-invalid={invalid ? 'true' : undefined}
              aria-describedby={describedBy}
              bind:value={form.unit}
            >
              <option value="">{t('kpi.indicator.form.unit.none')}</option>
              {#each units as term (term.key)}
                <option value={term.key}>{labelOf(data.units, term.key, locale())}</option>
              {/each}
            </select>
          {/snippet}
        </FieldShell>

        {#if bounds}
          <div class="grid gap-4 sm:grid-cols-2">
            <FieldShell
              label={t('kpi.indicator.form.min')}
              hint={t('kpi.indicator.form.bounds.help')}
              errors={[...errorsFor(failure, 'min'), ...numberProblem('min')]}
            >
              {#snippet children({ id, describedBy, invalid })}
                <input
                  {id}
                  inputmode="decimal"
                  class="input input-bordered w-full"
                  class:input-error={invalid}
                  aria-invalid={invalid ? 'true' : undefined}
                  aria-describedby={describedBy}
                  bind:value={form.min}
                />
              {/snippet}
            </FieldShell>
            <FieldShell
              label={t('kpi.indicator.form.max')}
              errors={[...errorsFor(failure, 'max'), ...numberProblem('max')]}
            >
              {#snippet children({ id, describedBy, invalid })}
                <input
                  {id}
                  inputmode="decimal"
                  class="input input-bordered w-full"
                  class:input-error={invalid}
                  aria-invalid={invalid ? 'true' : undefined}
                  aria-describedby={describedBy}
                  bind:value={form.max}
                />
              {/snippet}
            </FieldShell>
          </div>
        {/if}

        <TermChecks
          legend={t('kpi.indicator.form.measuredBy')}
          hint={t('kpi.indicator.form.measuredBy.help')}
          terms={data.means}
          bind:selected={form.measuredBy}
          errors={errorsFor(failure, 'measuredBy')}
        />
        <TermChecks
          legend={t('kpi.indicator.form.canBeAutomatedBy')}
          hint={t('kpi.indicator.form.canBeAutomatedBy.help')}
          terms={data.tools}
          bind:selected={form.canBeAutomatedBy}
          errors={errorsFor(failure, 'canBeAutomatedBy')}
        />

        <div>
          <SubmitButton {busy}>
            {creating ? t('kpi.indicator.form.create') : t('kpi.indicator.form.save')}
          </SubmitButton>
        </div>
      </form>
    </div>
  </section>

  {#if stored}
    <section class="card bg-base-100 border-base-300 border" aria-labelledby="indicator-ids-title">
      <div class="card-body gap-2">
        <h2 id="indicator-ids-title" class="card-title">{t('kpi.indicator.slug')}</h2>
        <p><code>{stored.slug}</code></p>
        <p class="text-sm opacity-70">{t('kpi.indicator.slug.help')}</p>
        <p class="text-sm">
          <span class="font-medium">{t('kpi.indicator.iri')}:</span>
          <code class="break-all">{stored.iri}</code>
        </p>
        <p class="text-sm opacity-70">{t('kpi.indicator.usedIn', { count: stored.setCount })}</p>
      </div>
    </section>

    <section
      class="card bg-base-100 border-base-300 border"
      aria-labelledby="indicator-delete-title"
    >
      <div class="card-body gap-3">
        <h2 id="indicator-delete-title" class="card-title">{t('kpi.indicator.delete.title')}</h2>
        <p>{t('kpi.indicator.delete.lead')}</p>
        <div class="card-actions">
          <button
            type="button"
            class="btn btn-error btn-outline btn-sm"
            onclick={() => (confirming = true)}
          >
            {t('kpi.indicator.delete.button')}
          </button>
        </div>
      </div>
    </section>
  {/if}
</div>

{#if stored}
  <ConfirmDialog
    open={confirming}
    title={t('kpi.indicator.delete.confirmTitle', { name: stored.name })}
    message={t('kpi.indicator.delete.confirmMessage')}
    confirmLabel={t('kpi.indicator.delete.confirm')}
    {busy}
    onconfirm={remove}
    oncancel={() => (confirming = false)}
  />
{/if}
