<script lang="ts">
  // The history of a service: the last runs (when, who, which way, how many values) and the coverage of the last twelve months (which months have
  // every mandatory value). Both are read by the page's loader, so this component asks for nothing. The server gives the id of the person who ran
  // it, not a name: the page says "You" for the person's own runs and "A colleague" for the rest.
  import { DataTable, getShell, Time, type Column } from '@scorpion/ui-kit';
  import { adapterLabel } from './adapters.ts';
  import type { SelectedData } from './loaders.ts';
  import { monthLabel, monthOf } from './months.ts';
  import { submitQueryString } from './query.ts';
  import type { CoverageMonth, RunRecord } from './types.ts';

  let { selected }: { selected: SelectedData } = $props();
  const { t, href, locale, session } = getShell();

  const me = $derived(session()?.user.id);
  const who = (run: RunRecord) =>
    run.actorId === null
      ? t('submit.history.actor.unknown')
      : run.actorId === me
        ? t('submit.history.actor.you')
        : t('submit.history.actor.other');

  // Newest month first, as a person looks for the latest.
  const months = $derived([...selected.coverage].reverse());
</script>

<div class="flex flex-col gap-8">
  <section class="flex flex-col gap-2" aria-labelledby="submit-runs-title">
    <h3 id="submit-runs-title" class="text-lg font-semibold">{t('submit.history.runs')}</h3>
    {#snippet whenCell(run: RunRecord)}<Time iso={run.startedAt} />{/snippet}
    {#snippet whoCell(run: RunRecord)}{who(run)}{/snippet}
    {#snippet sourceCell(run: RunRecord)}{adapterLabel(
        selected.adapters,
        run.adapter,
        locale(),
      )}{/snippet}
    {#snippet fileCell(run: RunRecord)}{run.fileName ?? ''}{/snippet}
    {#snippet resultCell(run: RunRecord)}{t(`submit.history.status.${run.status}`)}{/snippet}
    <DataTable
      caption={t('submit.history.runs')}
      columns={[
        { key: 'startedAt', header: t('submit.history.col.when'), cell: whenCell },
        { key: 'actorId', header: t('submit.history.col.who'), cell: whoCell },
        { key: 'adapter', header: t('submit.history.col.source'), cell: sourceCell },
        { key: 'fileName', header: t('submit.history.col.file'), cell: fileCell },
        { key: 'inserted', header: t('submit.history.col.added') },
        { key: 'updated', header: t('submit.history.col.changed') },
        { key: 'unchanged', header: t('submit.history.col.unchanged') },
        { key: 'rejected', header: t('submit.history.col.rejected') },
        { key: 'status', header: t('submit.history.col.result'), cell: resultCell },
      ] satisfies Column<RunRecord>[]}
      rows={selected.runs}
      rowKey={(run: RunRecord) => run.id}
      empty={t('submit.history.runs.empty')}
    />
  </section>

  <section class="flex flex-col gap-2" aria-labelledby="submit-coverage-title">
    <h3 id="submit-coverage-title" class="text-lg font-semibold">{t('submit.history.coverage')}</h3>
    {#snippet monthCell(entry: CoverageMonth)}
      <a
        class="link link-hover"
        href={href(
          '/submit' +
            submitQueryString({ service: selected.service.id, period: monthOf(entry.period) }),
        )}
      >
        {monthLabel(monthOf(entry.period), locale())}
      </a>
    {/snippet}
    {#snippet reportedCell(entry: CoverageMonth)}
      {t('submit.history.coverage.reported', {
        reported: entry.reported,
        total: selected.grid.length,
      })}
    {/snippet}
    {#snippet mandatoryCell(entry: CoverageMonth)}
      {t('submit.history.coverage.mandatory', {
        reported: entry.mandatoryReported,
        total: entry.mandatory,
      })}
    {/snippet}
    {#snippet statusCell(entry: CoverageMonth)}
      {entry.complete
        ? t('submit.history.coverage.complete')
        : t('submit.history.coverage.incomplete')}
    {/snippet}
    <DataTable
      caption={t('submit.history.coverage')}
      columns={[
        {
          key: 'period',
          header: t('submit.history.coverage.col.month'),
          rowHeader: true,
          cell: monthCell,
        },
        { key: 'reported', header: t('submit.history.coverage.col.reported'), cell: reportedCell },
        {
          key: 'mandatory',
          header: t('submit.history.coverage.col.mandatory'),
          cell: mandatoryCell,
        },
        { key: 'complete', header: t('submit.history.coverage.col.status'), cell: statusCell },
      ] satisfies Column<CoverageMonth>[]}
      rows={months}
      rowKey={(entry: CoverageMonth) => entry.period}
      empty={t('submit.history.coverage.empty')}
    />
  </section>
</div>
