<script lang="ts">
  // Administration, notification status: how mail delivery is doing. The counts, the error codes of the last
  // week, the deliveries (metadata only: never a body, an address or a subject), the requeue of one dead
  // delivery and a test mail to the administrator's own address. A banner says so when the transport is
  // `none`, where mail is recorded as sent and goes nowhere.
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
  import type { Delivery, StatusData } from './loaders.ts';
  import {
    changeDeliveriesQuery,
    DELIVERY_CHANNELS,
    DELIVERY_STATUSES,
    deliveriesQueryString,
    type DeliveriesQuery,
  } from './query.ts';

  let { data }: { data: StatusData } = $props();
  const { t, href, goto, api, refresh, toaster } = getShell();

  const path = '/admin/notifications';
  const go = (change: Partial<DeliveriesQuery>) =>
    goto(href(path) + deliveriesQueryString(changeDeliveriesQuery(data.query, change)));

  let template = $derived(data.query.template ?? '');

  let requeuing = $state<Delivery>();
  let busy = $state(false);
  let sending = $state(false);
  let failed = $state<string>();

  async function requeue(delivery: Delivery) {
    busy = true;
    failed = undefined;
    try {
      await unwrap(
        api.POST('/notifications/deliveries/{id}/requeue', {
          params: { path: { id: delivery.id } },
        }),
      );
      toaster.success(t('admin.notifications.requeued'));
      await refresh();
    } catch (error) {
      const failure = failureOf(error);
      failed = failureMessage(failure, t, {
        403: t('admin.notifications.forbidden'),
        409: t('admin.notifications.cannotRequeue'),
      });
      if (failure.status === 404 || failure.status === 409) await refresh();
    } finally {
      busy = false;
      requeuing = undefined;
    }
  }

  async function sendTest() {
    sending = true;
    failed = undefined;
    try {
      const answer = await unwrap(api.POST('/notifications/test'));
      if (answer.transportIsNone) toaster.info(t('admin.notifications.test.queuedNone'));
      else toaster.success(t('admin.notifications.test.queued'));
      await refresh();
    } catch (error) {
      failed = failureMessage(failureOf(error), t, {
        409: t('admin.notifications.test.noAddress'),
        429: t('admin.notifications.test.tooMany'),
      });
    } finally {
      sending = false;
    }
  }

  const counts = $derived(data.status.counts);
</script>

<svelte:head><title>{t('admin.notifications.title')}</title></svelte:head>

<div class="flex flex-col gap-8">
  <Breadcrumb
    items={[{ label: t('nav.section.admin') }, { label: t('admin.notifications.title') }]}
  />
  <h1 class="text-2xl font-bold">{t('admin.notifications.title')}</h1>

  {#if data.status.transportIsNone}
    <Alert kind="warning">
      <div class="flex flex-col gap-1">
        <strong>{t('admin.notifications.none.title')}</strong>
        <span>
          {t('admin.notifications.none.text', { count: data.status.sentWithoutTransport })}
        </span>
        <a class="link" href={href('/admin/settings/core.notifications')}>
          {t('admin.notifications.none.link')}
        </a>
      </div>
    </Alert>
  {/if}

  {#if failed}<Alert kind="error">{failed}</Alert>{/if}

  <section class="flex flex-col gap-4" aria-labelledby="counts-title">
    <h2 id="counts-title" class="text-xl font-semibold">{t('admin.notifications.counts.title')}</h2>
    <dl class="stats stats-vertical sm:stats-horizontal border-base-300 border">
      {#each ['queued', 'sending', 'sent', 'dead'] as const as key (key)}
        <div class="stat">
          <dt class="stat-title">{t(`admin.notifications.status.${key}`)}</dt>
          <dd class="stat-value">{counts[key]}</dd>
        </div>
      {/each}
    </dl>
    <p class="text-sm">
      {t('admin.notifications.transport', {
        transport: data.status.emailTransport,
        webhook: t(
          data.status.webhookEnabled ? 'admin.notifications.on' : 'admin.notifications.off',
        ),
      })}
    </p>
  </section>

  <section class="flex flex-col gap-4" aria-labelledby="errors-title">
    <h2 id="errors-title" class="text-xl font-semibold">{t('admin.notifications.errors.title')}</h2>
    <p>{t('admin.notifications.errors.lead')}</p>
    {#snippet lastAt(row: StatusData['status']['lastErrors'][number])}<Time
        iso={row.lastAt}
      />{/snippet}
    <DataTable
      caption={t('admin.notifications.errors.title')}
      columns={[
        {
          key: 'code',
          header: t('admin.notifications.errors.code'),
          rowHeader: true,
          value: (row: StatusData['status']['lastErrors'][number]) => row.code,
        },
        {
          key: 'count',
          header: t('admin.notifications.errors.count'),
          value: (row: StatusData['status']['lastErrors'][number]) => row.count,
        },
        { key: 'lastAt', header: t('admin.notifications.errors.last'), cell: lastAt },
      ] satisfies Column<StatusData['status']['lastErrors'][number]>[]}
      rows={data.status.lastErrors}
      rowKey={(row: StatusData['status']['lastErrors'][number]) => row.code}
      empty={t('admin.notifications.errors.empty')}
    />
  </section>

  <section class="flex flex-col gap-4" aria-labelledby="test-title">
    <h2 id="test-title" class="text-xl font-semibold">{t('admin.notifications.test.title')}</h2>
    <p>{t('admin.notifications.test.lead')}</p>
    <div>
      <button type="button" class="btn btn-primary" disabled={sending} onclick={sendTest}>
        {t('admin.notifications.test.send')}
      </button>
    </div>
  </section>

  {#if data.deliveries}
    <section class="flex flex-col gap-4" aria-labelledby="deliveries-title">
      <h2 id="deliveries-title" class="text-xl font-semibold">
        {t('admin.notifications.deliveries.title')}
      </h2>
      <p>{t('admin.notifications.deliveries.lead')}</p>
      <form
        class="flex flex-wrap items-end gap-4"
        role="search"
        aria-label={t('admin.notifications.deliveries.filters')}
        onsubmit={(event) => {
          event.preventDefault();
          void go({ template: template.trim() || undefined });
        }}
      >
        <div class="flex flex-col gap-1">
          <label class="text-sm font-medium" for="deliveries-status">
            {t('admin.notifications.deliveries.status')}
          </label>
          <select
            id="deliveries-status"
            class="select select-bordered"
            value={data.query.status ?? ''}
            onchange={(event) =>
              void go({ status: DELIVERY_STATUSES.find((s) => s === event.currentTarget.value) })}
          >
            <option value="">{t('admin.notifications.any')}</option>
            {#each DELIVERY_STATUSES as status (status)}
              <option value={status}>{t(`admin.notifications.status.${status}`)}</option>
            {/each}
          </select>
        </div>
        <div class="flex flex-col gap-1">
          <label class="text-sm font-medium" for="deliveries-channel">
            {t('admin.notifications.deliveries.channel')}
          </label>
          <select
            id="deliveries-channel"
            class="select select-bordered"
            value={data.query.channel ?? ''}
            onchange={(event) =>
              void go({ channel: DELIVERY_CHANNELS.find((c) => c === event.currentTarget.value) })}
          >
            <option value="">{t('admin.notifications.any')}</option>
            {#each DELIVERY_CHANNELS as channel (channel)}
              <option value={channel}>{t(`admin.notifications.channel.${channel}`)}</option>
            {/each}
          </select>
        </div>
        <div class="flex flex-col gap-1">
          <label class="text-sm font-medium" for="deliveries-template">
            {t('admin.notifications.deliveries.template')}
          </label>
          <input
            id="deliveries-template"
            class="input input-bordered"
            maxlength={100}
            autocomplete="off"
            bind:value={template}
          />
        </div>
        <button type="submit" class="btn">{t('admin.notifications.deliveries.apply')}</button>
      </form>

      {#snippet statusCell(row: Delivery)}
        <span
          class="badge"
          class:badge-success={row.status === 'sent'}
          class:badge-warning={row.status === 'queued' || row.status === 'sending'}
          class:badge-error={row.status === 'dead'}
        >
          {t(`admin.notifications.status.${row.status}`)}
        </span>
      {/snippet}
      {#snippet createdCell(row: Delivery)}<Time iso={row.createdAt} />{/snippet}
      {#snippet errorCell(row: Delivery)}
        {#if row.lastError}<span class="font-mono text-sm">{row.lastError}</span>{/if}
      {/snippet}
      {#snippet rowActions(row: Delivery)}
        {#if row.status === 'dead'}
          <button
            type="button"
            class="btn btn-xs"
            disabled={busy || !row.bodyAvailable}
            aria-label={t('admin.notifications.requeueNamed', { template: row.template })}
            onclick={() => (requeuing = row)}
          >
            {t('admin.notifications.requeue')}
          </button>
        {/if}
      {/snippet}
      <DataTable
        caption={t('admin.notifications.deliveries.title')}
        columns={[
          {
            key: 'template',
            header: t('admin.notifications.deliveries.template'),
            rowHeader: true,
            value: (row: Delivery) => row.template,
          },
          {
            key: 'channel',
            header: t('admin.notifications.deliveries.channel'),
            value: (row: Delivery) => t(`admin.notifications.channel.${row.channel}`),
          },
          { key: 'status', header: t('admin.notifications.deliveries.status'), cell: statusCell },
          {
            key: 'attempts',
            header: t('admin.notifications.deliveries.attempts'),
            value: (row: Delivery) => row.attempts,
          },
          { key: 'lastError', header: t('admin.notifications.deliveries.error'), cell: errorCell },
          {
            key: 'createdAt',
            header: t('admin.notifications.deliveries.created'),
            cell: createdCell,
          },
        ] satisfies Column<Delivery>[]}
        rows={data.deliveries.rows}
        rowKey={(row: Delivery) => row.id}
        actions={rowActions}
        actionsLabel={t('admin.notifications.actions')}
        page={data.query.page}
        pageSize={data.query.pageSize}
        total={data.deliveries.total}
        onpage={(page: number) => void go({ page })}
        onpagesize={(pageSize: number) => void go({ pageSize })}
        pageSizes={[10, 20, 50]}
        empty={t('admin.notifications.deliveries.empty')}
      />
    </section>
  {/if}
</div>

<ConfirmDialog
  open={requeuing !== undefined}
  title={t('admin.notifications.requeueTitle')}
  message={t('admin.notifications.requeueMessage')}
  confirmLabel={t('admin.notifications.requeue')}
  {busy}
  onconfirm={() => requeuing && requeue(requeuing)}
  oncancel={() => (requeuing = undefined)}
/>
