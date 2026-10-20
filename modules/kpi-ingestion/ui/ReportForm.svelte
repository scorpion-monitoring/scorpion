<script lang="ts">
  // The report form: the indicators of the service's effective KPI set for one month, grouped by necessity (the words come from the vocabulary),
  // each with the input its value type asks for (registry data), the unit, the bounds and the value stored for the month. A save records the
  // values through the one write path and keeps the form as it is, so a correction is a second save. The server judges every value; the page
  // checks what it can so a person is spared a round trip, and shows the server's answer when it still refuses.
  import { ApiError } from '@scorpion/contracts/client';
  import { Alert, failureMessage, failureOf, getShell, SubmitButton } from '@scorpion/ui-kit';
  import { onMount } from 'svelte';
  import {
    checkValue,
    groupRows,
    hasAnyValue,
    initialValues,
    inputSpec,
    isDirty,
    isMandatory,
    missingMandatory,
    problemsByIndicator,
    valuesPayload,
    MAX_VALUE_LENGTH,
    type InputSpec,
    type ValueIssue,
  } from './form.ts';
  import type { SelectedData } from './loaders.ts';
  import { chooseMonth, monthChoices, monthLabel } from './months.ts';
  import { problemKey, refusedRunId, requestProblemOf } from './problems.ts';
  import { submitQueryString } from './query.ts';
  import { labelOf } from './terms.ts';
  import { commitForm } from './upload.ts';
  import { messages } from './messages.ts';

  let {
    selected,
    draft,
  }: {
    selected: SelectedData;
    /** What a person typed for this service and month, kept by the page above so that a visit to another tab does not lose it. */
    draft: { values?: Record<string, string> };
  } = $props();
  const { t, href, goto, api, locale, refresh, guardLeave } = getShell();

  const rows = $derived(selected.grid);
  const groups = $derived(
    groupRows(
      rows,
      selected.necessity.map((term) => term.key),
    ),
  );
  const typeById = $derived(new Map(selected.types.map((type) => [type.id, type])));
  const specOf = (row: (typeof rows)[number]): InputSpec =>
    inputSpec(typeById.get(row.valueType), row);

  // One form per service and month: the page is remounted when either changes, so what is typed is never carried to another month. A refresh after
  // a save changes `selected.grid` but not the key, so the form keeps what was typed.
  // svelte-ignore state_referenced_locally
  let values = $state<Record<string, string>>({
    ...(draft.values ?? initialValues(selected.grid)),
  });
  let bad = $state<Record<string, boolean>>({});
  let touched = $state<Record<string, boolean>>({});
  let submitted = $state(false);
  let busy = $state(false);
  let saved = $state<string>();
  let failed = $state<string>();
  let serverErrors = $state<Record<string, string[]>>({});

  const issueOf = (row: (typeof rows)[number]): ValueIssue | undefined =>
    checkValue(specOf(row), values[row.indicatorId] ?? '', bad[row.indicatorId] ?? false);

  function issueText(row: (typeof rows)[number], issue: ValueIssue): string {
    const spec = specOf(row);
    switch (issue.code) {
      case 'min':
      case 'max':
        return t(`submit.form.error.${issue.code}`, { bound: String(issue.bound) });
      case 'pattern':
        return spec.hint
          ? t('submit.form.error.patternHint', { hint: spec.hint })
          : t('submit.form.error.pattern');
      default:
        return t(`submit.form.error.${issue.code}`);
    }
  }

  /** The messages under a field: what the page checked, then what the server said. */
  function errorsOf(row: (typeof rows)[number]): string[] {
    const mine: string[] = [];
    const shown = submitted || touched[row.indicatorId];
    const issue = issueOf(row);
    if (shown && issue) mine.push(issueText(row, issue));
    mine.push(...(serverErrors[row.indicatorId] ?? []));
    return mine;
  }

  const missing = $derived(missingMandatory(rows, values));
  const dirty = $derived(isDirty(rows, values));
  // The save button waits for the page to be interactive, so the browser cannot send the form by itself.
  let ready = $state(false);
  onMount(() => {
    ready = true;
    return guardLeave(() => dirty);
  });

  const boundsText = (spec: InputSpec): string | undefined => {
    if (spec.min !== undefined && spec.max !== undefined)
      return t('submit.form.bounds.both', { min: String(spec.min), max: String(spec.max) });
    if (spec.min !== undefined) return t('submit.form.bounds.min', { min: String(spec.min) });
    if (spec.max !== undefined) return t('submit.form.bounds.max', { max: String(spec.max) });
    return undefined;
  };
  const unitText = (row: (typeof rows)[number]) =>
    row.unit ? labelOf(selected.units, row.unit, locale()) : undefined;

  // The month list: the server's months (its clock), never the browser's.
  // svelte-ignore state_referenced_locally
  let pick = $state(selected.period);
  const choices = $derived(monthChoices(selected.months, selected.period));

  async function failure(error: unknown) {
    const runId = refusedRunId(error);
    if (runId) {
      // The refusal names the recorded run; its problems carry the codes, which this page has its own sentences for.
      try {
        const run = await api.GET('/kpi/ingestion/runs/{id}', { params: { path: { id: runId } } });
        if (run.data) {
          const { byIndicator, general } = problemsByIndicator(run.data.problems, rows);
          const next: Record<string, string[]> = {};
          for (const [id, problems] of byIndicator)
            next[id] = problems.map((problem) => t(problemKey(problem.code, messages.en!)));
          serverErrors = next;
          failed = [
            t('submit.form.summary'),
            ...general.map((problem) => t(problemKey(problem.code, messages.en!))),
          ].join(' ');
          return;
        }
      } catch {
        // fall through to the general message
      }
      failed = t('submit.form.failed');
      return;
    }
    const request = requestProblemOf(error);
    if (request === 'form' || request === 'noValues') failed = t('submit.form.empty');
    else if (request === 'serviceId') failed = t('submit.error.serviceId');
    else if (request) failed = t('submit.error.other');
    else if (error instanceof ApiError) failed = failureMessage(failureOf(error), t);
    else failed = t('submit.form.failed');
  }

  async function save(event: SubmitEvent) {
    event.preventDefault();
    submitted = true;
    saved = undefined;
    failed = undefined;
    serverErrors = {};
    if (missing.length > 0) return;
    if (rows.some((row) => issueOf(row))) {
      failed = t('submit.form.summary');
      return;
    }
    busy = true;
    try {
      const result = await commitForm(api, {
        serviceId: selected.service.id,
        period: selected.period,
        values: valuesPayload(values),
      });
      saved = t('submit.form.saved', {
        month: monthLabel(selected.period, locale()),
        inserted: result.inserted,
        updated: result.updated,
        unchanged: result.unchanged,
      });
      // Reads the page's data again (the history and the coverage change); the form keeps what was typed.
      await refresh();
    } catch (error) {
      await failure(error);
    } finally {
      busy = false;
    }
  }
</script>

<div class="flex flex-col gap-6">
  <p>{t('submit.form.intro')}</p>

  <form
    class="flex flex-wrap items-end gap-2"
    onsubmit={(event) => {
      event.preventDefault();
      const month = chooseMonth(pick, selected.months);
      void goto(
        href(
          '/submit' + submitQueryString({ service: selected.service.id, period: month ?? pick }),
        ),
      );
    }}
  >
    <div class="flex flex-col gap-1">
      <label class="text-sm font-medium" for="submit-month">{t('submit.month.label')}</label>
      <select
        id="submit-month"
        class="select select-bordered"
        aria-describedby="submit-month-help"
        bind:value={pick}
      >
        {#each choices as month (month)}
          <option value={month}>{monthLabel(month, locale())}</option>
        {/each}
      </select>
    </div>
    <SubmitButton variant="ghost">{t('submit.month.show')}</SubmitButton>
    <span id="submit-month-help" class="text-xs opacity-70">{t('submit.month.help')}</span>
  </form>

  {#if rows.length === 0}
    <Alert kind="info">{t('submit.form.noKpis')}</Alert>
  {:else}
    <form class="flex flex-col gap-6" novalidate onsubmit={save} aria-label={t('submit.tabs.form')}>
      {#each groups as group (group.necessity)}
        <fieldset class="flex flex-col gap-4">
          <legend class="text-lg font-semibold">
            {labelOf(selected.necessity, group.necessity, locale())}
          </legend>
          {#each group.rows as { row } (row.indicatorId)}
            {@const spec = specOf(row)}
            {@const id = `submit-field-${row.indicatorId}`}
            {@const errors = errorsOf(row)}
            {@const bounds = boundsText(spec)}
            {@const unit = unitText(row)}
            <div class="flex flex-col gap-1">
              <label class="text-sm font-medium" for={id}>
                {row.name}
                {#if isMandatory(row)}<span class="opacity-70">({t('submit.form.required')})</span
                  >{/if}
              </label>
              <div class="flex items-center gap-2">
                <input
                  {id}
                  class="input input-bordered w-full max-w-xs"
                  class:input-error={errors.length > 0}
                  type={spec.kind === 'number' ? 'number' : 'text'}
                  step={spec.step}
                  min={spec.min}
                  max={spec.max}
                  inputmode={spec.inputMode}
                  maxlength={spec.kind === 'text' ? MAX_VALUE_LENGTH : undefined}
                  autocomplete="off"
                  aria-required={isMandatory(row)}
                  aria-invalid={errors.length > 0}
                  aria-describedby={`${id}-help${errors.length > 0 ? ` ${id}-error` : ''}`}
                  value={values[row.indicatorId] ?? ''}
                  oninput={(event) => {
                    values[row.indicatorId] = event.currentTarget.value;
                    draft.values = { ...values };
                    bad[row.indicatorId] = event.currentTarget.validity.badInput;
                    delete serverErrors[row.indicatorId];
                  }}
                  onblur={() => (touched[row.indicatorId] = true)}
                />
                {#if unit}<span class="text-sm">{unit}</span>{/if}
              </div>
              <p id={`${id}-help`} class="text-xs opacity-70">
                {#if unit}{t('submit.form.unit', { unit })}{/if}
                {#if bounds}{unit ? ' · ' : ''}{bounds}{/if}
                {#if spec.hint}{unit || bounds ? ' · ' : ''}{t('submit.form.hint', {
                    hint: spec.hint,
                  })}{/if}
              </p>
              {#if errors.length > 0}
                <p id={`${id}-error`} class="text-error text-sm">{errors.join(' ')}</p>
              {/if}
            </div>
          {/each}
        </fieldset>
      {/each}

      {#if failed}<Alert kind="error">{failed}</Alert>{/if}
      <div class="flex flex-wrap items-center gap-4">
        <button
          type="submit"
          class="btn btn-primary"
          disabled={!ready || busy || missing.length > 0}
          aria-busy={busy}
          aria-describedby={missing.length > 0 ? 'submit-form-missing' : undefined}
        >
          {t('submit.form.submit')}
        </button>
        {#if missing.length > 0}
          <span id="submit-form-missing" class="text-sm opacity-70">
            {t('submit.form.missing')}
            {#each missing as row, index (row.indicatorId)}{index > 0 ? ', ' : ' '}{row.name}{/each}
          </span>
        {/if}
        {#if dirty && hasAnyValue(values)}
          <span class="text-sm opacity-70">{t('submit.form.unsaved')}</span>
        {/if}
      </div>
    </form>
  {/if}
  <div role="status" aria-live="polite">
    {#if busy}{t('submit.form.saving')}{:else if saved}<div class="alert alert-success">
        <div>{saved}</div>
      </div>{/if}
  </div>
</div>
