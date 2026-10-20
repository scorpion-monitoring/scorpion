<script lang="ts">
  // The file tab: a drop zone (with a button that does the same, the keyboard path), the import templates, a preview of the first rows with a row
  // of selects that says what each column holds, the verdict of each value from a dry run, and a commit that stays disabled while anything is
  // rejected. The `File` is held in memory only and the same bytes are sent for the preview, the dry run and the commit; the client never
  // sends parsed rows and nothing is stored. Calls: one for the preview, one for each check (a dry run), one for the commit; a change of the mapping
  // sends nothing until the person presses "Check the file".
  import { ApiError, unwrap } from '@scorpion/contracts/client';
  import { Alert, failureMessage, failureOf, getShell } from '@scorpion/ui-kit';
  import {
    acceptAttribute,
    acceptedExtensions,
    adapterLabel,
    downloadName,
    templateFormats,
  } from './adapters.ts';
  import type { SelectedData } from './loaders.ts';
  import {
    mappedColumns,
    missingNames,
    optionsFor,
    sameMapping,
    targetOf,
    withTarget,
    type Mapping,
  } from './mapping.ts';
  import { messages } from './messages.ts';
  import { countVerdicts, problemKey, refusedRunId, requestProblemOf } from './problems.ts';
  import type { Preview, Problem, RunResult } from './types.ts';
  import { commitFile, dryRunFile, MAX_FILE_BYTES, previewFile } from './upload.ts';

  let { selected }: { selected: SelectedData } = $props();
  const { t, api, locale, refresh } = getShell();

  const MIB = MAX_FILE_BYTES / (1024 * 1024);
  const accept = $derived(acceptAttribute(selected.adapters));
  const templates = $derived(templateFormats(selected.adapters));
  const targets = $derived(selected.grid.map((row) => ({ id: row.indicatorId, name: row.name })));

  let input = $state<HTMLInputElement>();
  let file = $state<File>();
  let preview = $state<Preview>();
  let mapping = $state<Mapping>({});
  let check = $state<RunResult>();
  let checkedMapping = $state<Mapping>({});
  let refused = $state<Problem[]>();
  let committed = $state<RunResult>();
  let busy = $state<'reading' | 'checking' | 'recording'>();
  let failed = $state<string>();
  let dragging = $state(false);

  const sentence = (problem: Problem) => t(problemKey(problem.code, messages.en!));
  const mappingChanged = $derived(preview ? !sameMapping(mapping, preview.mapping) : false);
  const checkIsCurrent = $derived(check !== undefined && sameMapping(mapping, checkedMapping));
  const shownProblems = $derived<Problem[]>(
    refused ?? (checkIsCurrent ? check!.problems : mappingChanged ? [] : (preview?.problems ?? [])),
  );
  const canCommit = $derived(
    checkIsCurrent &&
      check!.rejected === 0 &&
      check!.problems.length === 0 &&
      check!.rows.length > 0 &&
      busy === undefined,
  );
  const missing = $derived(
    preview && !mappingChanged ? missingNames(preview.missing, targets) : undefined,
  );

  function reset() {
    preview = undefined;
    check = undefined;
    refused = undefined;
    committed = undefined;
    failed = undefined;
    mapping = {};
    checkedMapping = {};
  }

  /** The words for a failure that is not about a cell. */
  async function explain(error: unknown): Promise<void> {
    const runId = refusedRunId(error);
    if (runId) {
      try {
        const run = await unwrap(
          api.GET('/kpi/ingestion/runs/{id}', { params: { path: { id: runId } } }),
        );
        refused = run.problems;
        failed = t('submit.commit.refused');
        return;
      } catch {
        // the general message below
      }
    }
    const request = requestProblemOf(error);
    if (request === 'noValues') failed = t('submit.error.noValues');
    else if (request === 'file') failed = t('submit.error.file');
    else if (request === 'serviceId') failed = t('submit.error.serviceId');
    else if (request === 'adapter') failed = t('submit.error.adapter');
    else if (request === 'mapping') failed = t('submit.error.mapping');
    else if (request) failed = t('submit.error.other');
    else if (error instanceof ApiError && error.status === 429)
      failed = t('submit.error.throttled');
    else if (error instanceof ApiError) failed = failureMessage(failureOf(error), t);
    else failed = t('submit.file.failed');
  }

  async function runCheck() {
    if (!file) return;
    busy = 'checking';
    failed = undefined;
    refused = undefined;
    try {
      check = await dryRunFile(api, { serviceId: selected.service.id, file, mapping });
      checkedMapping = { ...mapping };
    } catch (error) {
      check = undefined;
      await explain(error);
    } finally {
      busy = undefined;
    }
  }

  async function choose(next: File | undefined) {
    if (!next) return;
    reset();
    if (next.size === 0) {
      failed = t('submit.file.error.empty');
      return;
    }
    if (next.size > MAX_FILE_BYTES) {
      failed = t('submit.file.error.tooLarge', { size: MIB });
      return;
    }
    file = next;
    busy = 'reading';
    try {
      preview = await previewFile(api, { serviceId: selected.service.id, file: next });
      mapping = { ...preview.mapping };
    } catch (error) {
      await explain(error);
      busy = undefined;
      return;
    }
    busy = undefined;
    // With a mapping that misses nothing the verdicts come at once (one dry run): it reports every problem of the file, the cells the preview
    // cannot judge (a value the type refuses) included. With something missing the person maps it first and presses "Check the file".
    if (preview.missing.length === 0) await runCheck();
  }

  async function commit() {
    if (!file || !canCommit) return;
    busy = 'recording';
    failed = undefined;
    try {
      committed = await commitFile(api, { serviceId: selected.service.id, file, mapping });
      file = undefined;
      preview = undefined;
      check = undefined;
      await refresh();
    } catch (error) {
      await explain(error);
    } finally {
      busy = undefined;
    }
  }

  async function download(format: string, label: string) {
    failed = undefined;
    try {
      const { data, error, response } = await api.GET('/kpi/ingestion/template', {
        params: { query: { service: selected.service.id, format } },
        parseAs: 'blob',
      });
      if (!response.ok || error !== undefined || !data) throw new Error('template');
      const url = URL.createObjectURL(data);
      const link = document.createElement('a');
      link.href = url;
      link.download = downloadName(
        response.headers.get('content-disposition'),
        `${selected.service.slug}-template.${label.toLowerCase()}`,
      );
      document.body.append(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch {
      failed = t('submit.file.template.failed');
    }
  }

  const verdictAt = (row: number, column: number) =>
    check?.rows.find((entry) => entry.row === row && entry.column === column)?.verdict;
  const counts = $derived(check ? countVerdicts(check.rows) : undefined);
  const statusText = $derived(
    busy === 'reading'
      ? t('submit.file.reading')
      : busy === 'checking'
        ? t('submit.file.checking')
        : busy === 'recording'
          ? t('submit.file.recording')
          : committed
            ? t('submit.commit.done', {
                inserted: committed.inserted,
                updated: committed.updated,
                unchanged: committed.unchanged,
              })
            : undefined,
  );
</script>

<div class="flex flex-col gap-6">
  <p>{t('submit.file.intro')}</p>

  <section aria-labelledby="submit-template-title" class="flex flex-col gap-2">
    <h3 id="submit-template-title" class="font-semibold">{t('submit.file.template.title')}</h3>
    <p class="text-sm">{t('submit.file.template.help')}</p>
    <div class="flex flex-wrap gap-2">
      {#each templates as format (format.id)}
        <button type="button" class="btn btn-sm" onclick={() => download(format.id, format.label)}>
          {t('submit.file.template.download', { format: format.label })}
        </button>
      {/each}
    </div>
  </section>

  <div
    role="group"
    aria-labelledby="submit-drop-title"
    class="flex flex-col items-center gap-2 rounded-box border-2 border-dashed p-6 text-center"
    class:border-primary={dragging}
    class:bg-base-200={dragging}
    ondragover={(event) => {
      event.preventDefault();
      dragging = true;
    }}
    ondragleave={() => (dragging = false)}
    ondrop={(event) => {
      event.preventDefault();
      dragging = false;
      void choose(event.dataTransfer?.files?.[0]);
    }}
  >
    <p id="submit-drop-title" class="font-medium">{t('submit.file.drop')}</p>
    <button type="button" class="btn" disabled={busy !== undefined} onclick={() => input?.click()}>
      {file ? t('submit.file.chooseAnother') : t('submit.file.choose')}
    </button>
    <input
      bind:this={input}
      type="file"
      hidden
      {accept}
      onchange={(event) => {
        void choose(event.currentTarget.files?.[0]);
        event.currentTarget.value = '';
      }}
    />
    <p class="text-sm opacity-70">
      {t('submit.file.accepts', {
        types: acceptedExtensions(selected.adapters).join(', '),
        size: MIB,
      })}
    </p>
    {#if file}<p class="text-sm">{t('submit.file.name', { name: file.name })}</p>{/if}
  </div>

  <div role="status" aria-live="polite" class="flex flex-col gap-2">
    {#if statusText}
      {#if committed && !busy}
        <div class="alert alert-success"><div>{statusText}</div></div>
      {:else}
        <p>{statusText}</p>
      {/if}
    {/if}
  </div>
  {#if failed}<Alert kind="error">{failed}</Alert>{/if}

  {#if preview}
    <section class="flex flex-col gap-4" aria-labelledby="submit-preview-title">
      <h3 id="submit-preview-title" class="font-semibold">{t('submit.mapping.title')}</h3>
      <p class="text-sm">
        {t('submit.file.adapter', {
          adapter: adapterLabel(selected.adapters, preview.adapter, locale()),
        })}
        {#if preview.proposed && !mappingChanged}{t('submit.mapping.proposed')}{/if}
      </p>
      {#if mappingChanged}
        <p class="text-sm" role="status">{t('submit.mapping.changed')}</p>
      {/if}
      {#if missing && (missing.period || missing.names.length > 0)}
        <p class="text-error text-sm">
          {t('submit.mapping.missing', {
            list: [
              ...(missing.period ? [t('submit.mapping.missing.period')] : []),
              ...missing.names,
            ].join(', '),
          })}
        </p>
      {/if}

      <!-- A scrollable region has to be reachable by keyboard (axe: scrollable-region-focusable). -->
      <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
      <div
        class="overflow-x-auto"
        role="region"
        aria-label={t('submit.file.preview.caption')}
        tabindex="0"
      >
        <table class="table table-zebra table-sm">
          <caption class="sr-only">{t('submit.file.preview.caption')}</caption>
          <thead>
            <tr>
              <th scope="col">{t('submit.file.preview.row')}</th>
              {#each preview.header as heading, column (column)}
                <th scope="col">{heading}</th>
              {/each}
            </tr>
            <tr>
              <td></td>
              {#each preview.header as heading, column (column)}
                <td>
                  <select
                    class="select select-bordered select-sm max-w-48"
                    aria-label={t('submit.mapping.label', { n: column + 1, header: heading })}
                    value={targetOf(mapping, column)}
                    onchange={(event) => {
                      mapping = withTarget(mapping, column, event.currentTarget.value);
                    }}
                  >
                    {#each optionsFor(column, mapping, targets) as option (option.value)}
                      <option value={option.value} disabled={option.takenBy !== undefined}>
                        {option.value === ''
                          ? t('submit.mapping.none')
                          : option.takenBy !== undefined
                            ? t('submit.mapping.taken', {
                                name:
                                  option.value === 'period'
                                    ? t('submit.mapping.period')
                                    : (option.name ?? option.value),
                                n: option.takenBy,
                              })
                            : option.value === 'period'
                              ? t('submit.mapping.period')
                              : (option.name ?? option.value)}
                      </option>
                    {/each}
                  </select>
                </td>
              {/each}
            </tr>
          </thead>
          <tbody>
            {#each preview.rows as cells, index (preview.rowNumbers[index])}
              {@const row = preview.rowNumbers[index]!}
              <tr>
                <th scope="row">{row}</th>
                {#each cells as cell, column (column)}
                  {@const problems = shownProblems.filter(
                    (problem) => problem.row === row && problem.column === column + 1,
                  )}
                  {@const verdict =
                    checkIsCurrent && mappedColumns(mapping).includes(column)
                      ? verdictAt(row, column + 1)
                      : undefined}
                  <td class={problems.length > 0 ? 'bg-error/10' : ''}>
                    {cell}
                    {#if verdict}
                      <span class="badge badge-ghost badge-sm block"
                        >{t(`submit.verdict.${verdict}`)}</span
                      >
                    {/if}
                    {#each problems as problem, at (at)}
                      <span class="text-error block text-xs">
                        {t('submit.cell.invalid', { message: sentence(problem) })}
                      </span>
                    {/each}
                  </td>
                {/each}
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
      <p class="text-xs opacity-70">
        {t('submit.file.preview.showing', { shown: preview.rows.length, total: preview.totalRows })}
        {t('submit.file.preview.cut')}
      </p>

      <div class="flex flex-wrap items-center gap-4">
        <button
          type="button"
          class="btn"
          disabled={busy !== undefined}
          onclick={() => void runCheck()}
        >
          {t('submit.mapping.check')}
        </button>
        <button
          type="button"
          class="btn btn-primary"
          disabled={!canCommit}
          aria-describedby="submit-commit-help"
          onclick={() => void commit()}
        >
          {t('submit.commit.submit')}
        </button>
        <span id="submit-commit-help" class="text-sm">
          {#if !checkIsCurrent}
            {t('submit.check.needed')}
          {:else if counts && (check!.rejected > 0 || check!.problems.length > 0)}
            {t('submit.check.blocked')}
          {:else}
            {t('submit.check.ok')}
          {/if}
        </span>
      </div>
      {#if counts && checkIsCurrent}
        <p role="status" class="text-sm">
          {t('submit.check.summary', {
            insert: counts.insert,
            update: counts.update,
            unchanged: counts.unchanged,
            reject: counts.reject,
          })}
        </p>
      {/if}
    </section>
  {/if}

  {#if shownProblems.length > 0}
    <section aria-labelledby="submit-problems-title" class="flex flex-col gap-2">
      <h3 id="submit-problems-title" class="font-semibold text-error">
        {t('submit.problems.title')}
      </h3>
      <ul class="list-disc pl-6">
        {#each shownProblems as problem, index (index)}
          <li>
            {#if problem.row === 0}
              {t('submit.problems.file', { message: sentence(problem) })}
            {:else if problem.column === 0}
              {t('submit.problems.row', { row: problem.row, message: sentence(problem) })}
            {:else}
              {t('submit.problems.cell', {
                row: problem.row,
                column: problem.column,
                message: sentence(problem),
              })}
            {/if}
          </li>
        {/each}
      </ul>
      {#if shownProblems.length >= 100}
        <p class="text-sm opacity-70">{t('submit.problems.truncated', { count: 100 })}</p>
      {/if}
    </section>
  {/if}
</div>
