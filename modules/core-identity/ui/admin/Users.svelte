<script lang="ts">
  // Administration, users: every account with a filter by status, a search, a sort the server does and
  // pages. A row leads to the detail page. "End every session of everybody" is here, behind a confirm:
  // it is the one destructive action that is about nobody in particular.
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
    type Sort,
  } from '@scorpion/ui-kit';
  import { unwrap } from '@scorpion/contracts/client';
  import type { AdminUser, UsersData } from './loaders.ts';
  import { changeQuery, USER_STATUSES, usersQueryString, type UsersQuery } from './query.ts';

  let { data }: { data: UsersData } = $props();
  const { t, href, goto, api, toaster, withReauth } = getShell();

  const path = '/admin/users';
  const go = (change: Partial<UsersQuery>) =>
    goto(href(path) + usersQueryString(changeQuery(data.query, change)));

  // What is typed in the search box; it starts from the address and goes back to it when the address changes.
  let search = $derived(data.query.q ?? '');

  const sort = $derived<Sort>({ key: data.query.sort, direction: data.query.dir });

  let confirming = $state(false);
  let busy = $state(false);
  let failed = $state<string>();

  async function endEverything() {
    busy = true;
    failed = undefined;
    try {
      const done = await withReauth(() => unwrap(api.POST('/system/sessions/revoke-all')));
      toaster.success(t('admin.users.endAll.done', { count: done.revoked }));
      confirming = false;
    } catch (error) {
      failed = failureMessage(failureOf(error), t);
      confirming = false;
    } finally {
      busy = false;
    }
  }
</script>

<svelte:head><title>{t('admin.users.title')}</title></svelte:head>

<div class="flex flex-col gap-6">
  <Breadcrumb items={[{ label: t('nav.section.admin') }, { label: t('admin.users.title') }]} />
  <h1 class="text-2xl font-bold">{t('admin.users.title')}</h1>

  {#if failed}<Alert kind="error">{failed}</Alert>{/if}

  <div class="flex flex-wrap items-end gap-4">
    <form
      role="search"
      class="flex items-end gap-2"
      onsubmit={(event) => {
        event.preventDefault();
        void go({ q: search.trim() || undefined });
      }}
    >
      <div class="flex flex-col gap-1">
        <label class="text-sm font-medium" for="users-search">{t('admin.users.search')}</label>
        <input
          id="users-search"
          type="search"
          class="input input-bordered"
          maxlength={100}
          autocomplete="off"
          bind:value={search}
        />
      </div>
      <button type="submit" class="btn">{t('admin.users.searchSubmit')}</button>
    </form>
    <div class="flex flex-col gap-1">
      <label class="text-sm font-medium" for="users-status">{t('admin.users.status')}</label>
      <select
        id="users-status"
        class="select select-bordered"
        value={data.query.status ?? ''}
        onchange={(event) =>
          void go({
            status: USER_STATUSES.find((status) => status === event.currentTarget.value),
          })}
      >
        <option value="">{t('admin.users.status.all')}</option>
        {#each USER_STATUSES as status (status)}
          <option value={status}>{t(`admin.users.status.${status}`)}</option>
        {/each}
      </select>
    </div>
    <div class="ms-auto">
      <a class="btn btn-sm" href={href('/admin/users/pending')}>{t('admin.users.toPending')}</a>
    </div>
  </div>

  {#snippet nameCell(row: AdminUser)}
    <a class="link link-hover font-medium" href={href(`/admin/users/${row.id}`)}>{row.username}</a>
    {#if row.displayName}<span class="ms-2 opacity-70">{row.displayName}</span>{/if}
  {/snippet}
  {#snippet mailCell(row: AdminUser)}
    {#if row.email}
      {row.email}
      {#if !row.emailVerified}<span class="badge badge-ghost ms-1"
          >{t('admin.users.unverified')}</span
        >{/if}
    {:else}
      <span class="opacity-70">{t('admin.users.noEmail')}</span>
    {/if}
  {/snippet}
  {#snippet statusCell(row: AdminUser)}
    <span
      class="badge"
      class:badge-success={row.status === 'active'}
      class:badge-warning={row.status === 'pending'}
      class:badge-error={row.status === 'rejected' || row.status === 'deactivated'}
    >
      {t(`admin.users.status.${row.status}`)}
    </span>
  {/snippet}
  {#snippet createdCell(row: AdminUser)}<Time iso={row.createdAt} />{/snippet}

  <DataTable
    caption={t('admin.users.title')}
    columns={[
      {
        key: 'username',
        header: t('admin.users.username'),
        sortable: true,
        rowHeader: true,
        cell: nameCell,
      },
      { key: 'email', header: t('admin.users.email'), sortable: true, cell: mailCell },
      { key: 'status', header: t('admin.users.status'), sortable: true, cell: statusCell },
      { key: 'createdAt', header: t('admin.users.created'), sortable: true, cell: createdCell },
    ] satisfies Column<AdminUser>[]}
    rows={data.users}
    rowKey={(row: AdminUser) => row.id}
    {sort}
    onsort={(next: Sort) => void go({ sort: next.key as UsersQuery['sort'], dir: next.direction })}
    page={data.query.page}
    pageSize={data.query.pageSize}
    total={data.total}
    onpage={(page: number) => void go({ page })}
    onpagesize={(pageSize: number) => void go({ pageSize })}
    empty={t('admin.users.empty')}
  />

  <section class="card bg-base-100 border-base-300 border" aria-labelledby="endall-title">
    <div class="card-body gap-3">
      <h2 id="endall-title" class="card-title">{t('admin.users.endAll.title')}</h2>
      <p>{t('admin.users.endAll.lead')}</p>
      <div class="card-actions">
        <button
          type="button"
          class="btn btn-error btn-outline btn-sm"
          onclick={() => (confirming = true)}
        >
          {t('admin.users.endAll.button')}
        </button>
      </div>
    </div>
  </section>
</div>

<ConfirmDialog
  open={confirming}
  title={t('admin.users.endAll.confirmTitle')}
  message={t('admin.users.endAll.confirmMessage')}
  confirmLabel={t('admin.users.endAll.confirm')}
  {busy}
  onconfirm={endEverything}
  oncancel={() => (confirming = false)}
/>
