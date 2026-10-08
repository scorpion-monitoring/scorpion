<script lang="ts">
  // Administration, system: the state of the event outbox (what is waiting, what ran out of attempts), the
  // repair of one dead delivery, the retention numbers (changed in the settings of this module) and the
  // history of job runs with the counts each handler returned. Nothing here shows an event payload.
  import {
    Alert,
    Breadcrumb,
    ConfirmDialog,
    DataTable,
    failureMessage,
    failureOf,
    getShell,
    Time,
    type Column,
  } from '@scorpion/ui-kit';
  import { unwrap } from '@scorpion/contracts/client';
  import { RETENTION_KEYS, type DeadDelivery, type JobRun, type SystemData } from './loaders.ts';

  let { data }: { data: SystemData } = $props();
  const { t, href, goto, api, refresh, toaster } = getShell();

  let requeuing = $state<DeadDelivery>();
  let busy = $state(false);
  let failed = $state<string>();

  async function requeue(delivery: DeadDelivery) {
    busy = true;
    failed = undefined;
    try {
      await unwrap(
        api.POST('/system/outbox/deliveries/{id}/requeue', {
          params: { path: { id: delivery.deliveryId } },
        }),
      );
      toaster.success(t('admin.system.requeued', { event: delivery.eventName }));
      await refresh();
    } catch (error) {
      const failure = failureOf(error);
      failed = failureMessage(failure, t, {
        403: t('admin.system.forbidden'),
        409: t('admin.system.notDead'),
      });
      if (failure.status === 404 || failure.status === 409) await refresh();
    } finally {
      busy = false;
      requeuing = undefined;
    }
  }

  const lag = $derived(
    data.outbox.lagSeconds < 90
      ? t('admin.system.lag.seconds', { count: Math.round(data.outbox.lagSeconds) })
      : t('admin.system.lag.minutes', { count: Math.round(data.outbox.lagSeconds / 60) }),
  );

  const resultText = (run: JobRun) =>
    run.result
      ? Object.entries(run.result)
          .map(([key, value]) => `${key}: ${value}`)
          .join(', ')
      : '';

  const runsTo = (page: number) => goto(href('/admin/system') + (page > 0 ? `?page=${page}` : ''));
</script>

<svelte:head><title>{t('admin.system.title')}</title></svelte:head>

<div class="flex flex-col gap-8">
  <Breadcrumb items={[{ label: t('nav.section.admin') }, { label: t('admin.system.title') }]} />
  <h1 class="text-2xl font-bold">{t('admin.system.title')}</h1>

  {#if failed}<Alert kind="error">{failed}</Alert>{/if}

  <section class="flex flex-col gap-4" aria-labelledby="outbox-title">
    <h2 id="outbox-title" class="text-xl font-semibold">{t('admin.system.outbox.title')}</h2>
    <p>{t('admin.system.outbox.lead')}</p>
    <dl class="stats stats-vertical sm:stats-horizontal border-base-300 border">
      <div class="stat">
        <dt class="stat-title">{t('admin.system.outbox.pending')}</dt>
        <dd class="stat-value">{data.outbox.pending}</dd>
      </div>
      <div class="stat">
        <dt class="stat-title">{t('admin.system.outbox.dead')}</dt>
        <dd class="stat-value">{data.outbox.dead}</dd>
      </div>
      <div class="stat">
        <dt class="stat-title">{t('admin.system.outbox.lag')}</dt>
        <dd class="stat-value text-2xl">{lag}</dd>
      </div>
    </dl>

    {#snippet failedCell(row: DeadDelivery)}<Time iso={row.failedAt} />{/snippet}
    {#snippet errorCell(row: DeadDelivery)}
      <span class="font-mono text-sm">{row.lastError ?? t('admin.system.noError')}</span>
    {/snippet}
    {#snippet deadActions(row: DeadDelivery)}
      <button
        type="button"
        class="btn btn-xs"
        disabled={busy}
        aria-label={t('admin.system.requeueNamed', {
          event: row.eventName,
          subscriber: row.subscriber,
        })}
        onclick={() => (requeuing = row)}
      >
        {t('admin.system.requeue')}
      </button>
    {/snippet}
    <DataTable
      caption={t('admin.system.dead.title')}
      columns={[
        {
          key: 'eventName',
          header: t('admin.system.dead.event'),
          rowHeader: true,
          value: (row: DeadDelivery) => row.eventName,
        },
        {
          key: 'subscriber',
          header: t('admin.system.dead.subscriber'),
          value: (row: DeadDelivery) => row.subscriber,
        },
        {
          key: 'attempts',
          header: t('admin.system.dead.attempts'),
          value: (row: DeadDelivery) => row.attempts,
        },
        { key: 'lastError', header: t('admin.system.dead.error'), cell: errorCell },
        { key: 'failedAt', header: t('admin.system.dead.failed'), cell: failedCell },
      ] satisfies Column<DeadDelivery>[]}
      rows={data.dead}
      rowKey={(row: DeadDelivery) => row.deliveryId}
      actions={deadActions}
      actionsLabel={t('admin.system.actions')}
      empty={t('admin.system.dead.empty')}
    />
  </section>

  <section class="flex flex-col gap-4" aria-labelledby="retention-title">
    <h2 id="retention-title" class="text-xl font-semibold">{t('admin.system.retention.title')}</h2>
    {#if data.retention}
      <dl class="grid gap-x-6 gap-y-1 sm:grid-cols-[max-content_1fr]">
        {#each RETENTION_KEYS as key (key)}
          {#if data.retention[key] !== undefined}
            <dt class="font-medium">{t(`admin.system.retention.${key}`)}</dt>
            <dd>{t('admin.system.retention.days', { count: data.retention[key] })}</dd>
          {/if}
        {/each}
      </dl>
      <div>
        <a class="btn btn-sm" href={href('/admin/settings/core.audit')}>
          {t('admin.system.retention.change')}
        </a>
      </div>
    {:else}
      <p>{t('admin.system.retention.hidden')}</p>
    {/if}
  </section>

  <section class="flex flex-col gap-4" aria-labelledby="runs-title">
    <h2 id="runs-title" class="text-xl font-semibold">{t('admin.system.runs.title')}</h2>
    <p>{t('admin.system.runs.lead')}</p>
    {#snippet startedCell(row: JobRun)}<Time iso={row.startedAt} />{/snippet}
    {#snippet statusCell(row: JobRun)}
      <span
        class="badge"
        class:badge-success={row.status === 'succeeded'}
        class:badge-warning={row.status === 'running'}
        class:badge-error={row.status === 'failed'}
      >
        {t(`admin.system.runs.status.${row.status}`)}
      </span>
    {/snippet}
    {#snippet resultCell(row: JobRun)}
      {#if row.error}
        <span class="font-mono text-sm">{row.error}</span>
      {:else}
        <span class="font-mono text-sm">{resultText(row)}</span>
      {/if}
    {/snippet}
    <DataTable
      caption={t('admin.system.runs.title')}
      columns={[
        {
          key: 'jobName',
          header: t('admin.system.runs.job'),
          rowHeader: true,
          value: (row: JobRun) => row.jobName,
        },
        { key: 'startedAt', header: t('admin.system.runs.started'), cell: startedCell },
        { key: 'status', header: t('admin.system.runs.statusHeader'), cell: statusCell },
        {
          key: 'durationMs',
          header: t('admin.system.runs.duration'),
          value: (row: JobRun) =>
            row.durationMs === null ? '' : t('admin.system.runs.ms', { count: row.durationMs }),
        },
        { key: 'result', header: t('admin.system.runs.result'), cell: resultCell },
      ] satisfies Column<JobRun>[]}
      rows={data.jobRuns.runs}
      rowKey={(row: JobRun) => row.id}
      page={data.jobRuns.page}
      pageSize={data.jobRuns.pageSize}
      total={data.jobRuns.total}
      onpage={(page: number) => void runsTo(page)}
      empty={t('admin.system.runs.empty')}
    />
  </section>
</div>

<ConfirmDialog
  open={requeuing !== undefined}
  title={t('admin.system.requeueTitle')}
  message={t('admin.system.requeueMessage', {
    event: requeuing?.eventName ?? '',
    subscriber: requeuing?.subscriber ?? '',
  })}
  confirmLabel={t('admin.system.requeue')}
  {busy}
  onconfirm={() => requeuing && requeue(requeuing)}
  oncancel={() => (requeuing = undefined)}
/>
