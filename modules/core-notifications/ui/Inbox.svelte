<script lang="ts">
  // The inbox: the person's own notifications, newest first, with paging. Items are text: the title and the
  // text are shown as text and never as HTML; a link is shown only when it is an http(s) address.
  import {
    Alert,
    Breadcrumb,
    DataTable,
    failureMessage,
    failureOf,
    getShell,
    Time,
    type Column,
  } from '@scorpion/ui-kit';
  import { unwrap } from '@scorpion/contracts/client';
  import type { InboxData, InboxItem } from './loaders.ts';
  import { linkOf } from './prefs.ts';

  let { data }: { data: InboxData } = $props();
  const { t, href, goto, api, refresh, toaster } = getShell();

  let busy = $state(false);
  let failed = $state<string>();

  const to = (page: number, pageSize = data.pageSize) =>
    goto(
      href('/inbox') +
        (page > 0 || pageSize !== 20
          ? `?${new URLSearchParams({
              ...(page > 0 ? { page: String(page) } : {}),
              ...(pageSize !== 20 ? { pageSize: String(pageSize) } : {}),
            })}`
          : ''),
    );

  async function act(run: () => Promise<unknown>, done?: string) {
    busy = true;
    failed = undefined;
    try {
      await run();
      if (done) toaster.success(done);
      await refresh();
    } catch (error) {
      failed = failureMessage(failureOf(error), t);
    } finally {
      busy = false;
    }
  }

  const markRead = (item: InboxItem) =>
    act(() =>
      unwrap(api.POST('/notifications/inbox/{id}/read', { params: { path: { id: item.id } } })),
    );
  const markAll = () =>
    act(() => unwrap(api.POST('/notifications/inbox/read-all')), t('inbox.allRead'));
  const remove = (item: InboxItem) =>
    act(async () => {
      const { response } = await api.DELETE('/notifications/inbox/{id}', {
        params: { path: { id: item.id } },
      });
      if (!response.ok) throw new Error('delete failed');
    }, t('inbox.deleted'));

  const origin = () =>
    typeof window === 'undefined' ? 'http://localhost' : window.location.origin;
</script>

<svelte:head><title>{t('inbox.title')}</title></svelte:head>

<div class="flex flex-col gap-6">
  <Breadcrumb items={[{ label: t('inbox.title') }]} />
  <h1 class="text-2xl font-bold">{t('inbox.title')}</h1>
  <p>{t('inbox.lead')}</p>

  {#if failed}<Alert kind="error">{failed}</Alert>{/if}

  <div class="flex flex-wrap items-center gap-4">
    <p role="status" class="font-medium" data-testid="unread">
      {t('inbox.unread', { count: data.unread })}
    </p>
    <button type="button" class="btn btn-sm" disabled={busy || data.unread === 0} onclick={markAll}>
      {t('inbox.markAll')}
    </button>
    <a class="btn btn-sm btn-ghost ms-auto" href={href('/profile/notifications')}>
      {t('inbox.settings')}
    </a>
  </div>

  {#snippet whatCell(row: InboxItem)}
    <span class:font-semibold={row.readAt === null}>{row.title}</span>
    {#if row.readAt === null}<span class="badge badge-primary badge-sm ms-2">{t('inbox.new')}</span
      >{/if}
    <span class="block text-sm opacity-80 whitespace-pre-line">{row.text}</span>
    {#if linkOf(row.link, origin())}
      {@const link = linkOf(row.link, origin())!}
      <a
        class="link text-sm"
        href={link.href}
        rel={link.external ? 'noopener noreferrer' : undefined}
        target={link.external ? '_blank' : undefined}>{t('inbox.open')}</a
      >
    {/if}
  {/snippet}
  {#snippet whenCell(row: InboxItem)}<Time iso={row.createdAt} />{/snippet}
  {#snippet actions(row: InboxItem)}
    {#if row.readAt === null}
      <button
        type="button"
        class="btn btn-xs"
        disabled={busy}
        aria-label={t('inbox.markReadNamed', { title: row.title })}
        onclick={() => markRead(row)}
      >
        {t('inbox.markRead')}
      </button>
    {/if}
    <button
      type="button"
      class="btn btn-ghost btn-xs"
      disabled={busy}
      aria-label={t('inbox.deleteNamed', { title: row.title })}
      onclick={() => remove(row)}
    >
      {t('inbox.delete')}
    </button>
  {/snippet}

  <DataTable
    caption={t('inbox.title')}
    columns={[
      { key: 'title', header: t('inbox.col.item'), rowHeader: true, cell: whatCell },
      { key: 'createdAt', header: t('inbox.col.when'), cell: whenCell },
    ] satisfies Column<InboxItem>[]}
    rows={data.items}
    rowKey={(row: InboxItem) => row.id}
    {actions}
    actionsLabel={t('inbox.col.actions')}
    page={data.page}
    pageSize={data.pageSize}
    total={data.total}
    onpage={(page: number) => void to(page)}
    onpagesize={(size: number) => void to(0, size)}
    empty={t('inbox.empty')}
  />
</div>
