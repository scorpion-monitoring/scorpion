<script lang="ts">
  // Administration, accounts waiting for approval: the page the mail to the administrators links to. An
  // account is approved (and given a role) or rejected, never one's own: the server refuses that.
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
  import type { PendingData, PendingUser } from './loaders.ts';
  import { pageQueryString } from './query.ts';

  let { data }: { data: PendingData } = $props();
  const { t, href, goto, api, refresh, toaster, withReauth } = getShell();

  let role = $state('user');
  let rejecting = $state<PendingUser>();
  let working = $state<string>();
  let failed = $state<string>();

  async function decide(user: PendingUser, verdict: 'approve' | 'reject') {
    working = user.id;
    failed = undefined;
    try {
      await withReauth(() =>
        verdict === 'approve'
          ? unwrap(
              api.POST('/users/{id}/approve', {
                params: { path: { id: user.id } },
                body: data.roles ? { role } : {},
              }),
            )
          : unwrap(api.POST('/users/{id}/reject', { params: { path: { id: user.id } } })),
      );
      toaster.success(
        t(verdict === 'approve' ? 'admin.pending.approved' : 'admin.pending.rejected', {
          name: user.username,
        }),
      );
      await refresh();
    } catch (error) {
      const failure = failureOf(error);
      failed = failureMessage(failure, t, {
        403: t('admin.pending.forbidden'),
        409: t('admin.pending.notPending'),
      });
      if (failure.status === 404 || failure.status === 409) await refresh();
    } finally {
      working = undefined;
      rejecting = undefined;
    }
  }

  const to = (page: number, pageSize = data.pageSize) =>
    goto(href('/admin/users/pending') + pageQueryString(page, pageSize));
</script>

<svelte:head><title>{t('admin.pending.title')}</title></svelte:head>

<div class="flex flex-col gap-6">
  <Breadcrumb
    items={[
      { label: t('nav.section.admin') },
      { label: t('admin.users.title'), href: href('/admin/users') },
      { label: t('admin.pending.title') },
    ]}
  />
  <h1 class="text-2xl font-bold">{t('admin.pending.title')}</h1>
  <p>{t('admin.pending.lead')}</p>

  {#if failed}<Alert kind="error">{failed}</Alert>{/if}

  {#if data.roles}
    <div class="flex max-w-xs flex-col gap-1">
      <label class="text-sm font-medium" for="pending-role">{t('admin.pending.role')}</label>
      <select id="pending-role" class="select select-bordered" bind:value={role}>
        {#each data.roles as option (option.key)}
          <option value={option.key}>{option.label}</option>
        {/each}
      </select>
      <p class="text-sm opacity-70">{t('admin.pending.roleHint')}</p>
    </div>
  {/if}

  {#snippet account(row: PendingUser)}<span class="font-medium">{row.username}</span>{/snippet}
  {#snippet requested(row: PendingUser)}<Time iso={row.createdAt} />{/snippet}
  {#snippet actions(row: PendingUser)}
    <button
      type="button"
      class="btn btn-primary btn-xs"
      disabled={working === row.id}
      aria-label={t('admin.pending.approveNamed', { name: row.username })}
      onclick={() => decide(row, 'approve')}
    >
      {t('admin.pending.approve')}
    </button>
    <button
      type="button"
      class="btn btn-ghost btn-xs"
      disabled={working === row.id}
      aria-label={t('admin.pending.rejectNamed', { name: row.username })}
      onclick={() => (rejecting = row)}
    >
      {t('admin.pending.reject')}
    </button>
  {/snippet}

  <DataTable
    caption={t('admin.pending.title')}
    columns={[
      { key: 'username', header: t('admin.users.username'), rowHeader: true, cell: account },
      {
        key: 'email',
        header: t('admin.users.email'),
        value: (row: PendingUser) => row.email ?? '',
      },
      { key: 'createdAt', header: t('admin.pending.requested'), cell: requested },
    ] satisfies Column<PendingUser>[]}
    rows={data.users}
    rowKey={(row: PendingUser) => row.id}
    {actions}
    actionsLabel={t('admin.users.actions')}
    page={data.page}
    pageSize={data.pageSize}
    total={data.total}
    onpage={(page: number) => void to(page)}
    onpagesize={(size: number) => void to(0, size)}
    empty={t('admin.pending.empty')}
  />
</div>

<ConfirmDialog
  open={rejecting !== undefined}
  title={t('admin.pending.rejectTitle')}
  message={t('admin.pending.rejectMessage', { name: rejecting?.username ?? '' })}
  confirmLabel={t('admin.pending.reject')}
  busy={working !== undefined}
  onconfirm={() => rejecting && decide(rejecting, 'reject')}
  oncancel={() => (rejecting = undefined)}
/>
