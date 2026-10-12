<script lang="ts">
  // Profile, organisations: the caller's own memberships (leave or withdraw), a search for organisations to
  // join (5 per page, member counts, a badge on rows the caller already has), and, only when the API says the
  // caller manages an organisation (`summary.manages`), the section "My organisations". A plain User sees
  // nothing of that section and no request is made for it. Rights come from the API, never from a role.
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
  import type { TypeChoice } from './form-context.ts';
  import type { AccountOrganisationsData } from './loaders.ts';
  import ManagerOrganisation from './ManagerOrganisation.svelte';
  import {
    changeSearchQuery,
    SEARCH_PAGE_SIZE,
    searchQueryString,
    type SearchQuery,
  } from './member-query.ts';
  import StateBadge from './StateBadge.svelte';

  let { data }: { data: AccountOrganisationsData } = $props();
  const { t, href, goto, api, toaster, refresh, locale } = getShell();

  type Own = AccountOrganisationsData['own'][number];
  type Found = AccountOrganisationsData['found'][number];

  const path = '/account/organisations';
  const go = (change: Partial<SearchQuery>) =>
    goto(href(path) + searchQueryString(changeSearchQuery(data.search, change)));

  let search = $derived(data.search.q ?? '');

  const choices = $derived<TypeChoice[]>(
    data.types.map((type) => ({
      id: type.id,
      label: (type.labels as Record<string, string | undefined>)[locale()] ?? type.labels.en,
      membership: type.membership,
    })),
  );
  const typeLabel = (id: string) =>
    choices.find((choice) => choice.id === id)?.label ?? t('organisation.type.unknown', { id });
  const canJoin = (row: Found) =>
    choices.find((choice) => choice.id === row.type)?.membership === true &&
    row.typeKnown &&
    (row.myMembership === null ||
      row.myMembership.state === 'rejected' ||
      row.myMembership.state === 'left');

  let busy = $state(false);
  let failed = $state<string>();
  let leaving = $state<Own>();

  async function act(action: () => Promise<unknown>, done: string) {
    busy = true;
    failed = undefined;
    try {
      await action();
      toaster.success(done);
      await refresh();
    } catch (error) {
      failed = failureMessage(failureOf(error), t, {
        409: t('organisation.membership.tooMany'),
        422: t('organisation.membership.notSupported'),
      });
    } finally {
      busy = false;
      leaving = undefined;
    }
  }

  const request = (row: Found) =>
    act(
      () =>
        unwrap(api.POST('/organisations/{id}/membership', { params: { path: { id: row.id } } })),
      t('organisation.membership.requested'),
    );
  const leave = (row: Own) =>
    act(
      () =>
        unwrap(
          api.DELETE('/organisations/{id}/membership', {
            params: { path: { id: row.organisation.id } },
          }),
        ),
      row.state === 'requested'
        ? t('organisation.membership.withdrawn')
        : t('organisation.membership.left'),
    );
</script>

<svelte:head><title>{t('account.organisations.title')}</title></svelte:head>

<div class="flex flex-col gap-8">
  <Breadcrumb
    items={[{ label: t('nav.section.account') }, { label: t('account.organisations.title') }]}
  />
  <h1 class="text-2xl font-bold">{t('account.organisations.title')}</h1>

  {#if failed}<Alert kind="error">{failed}</Alert>{/if}

  <section class="flex flex-col gap-2" aria-labelledby="own-title">
    <h2 id="own-title" class="text-xl font-semibold">{t('account.organisations.own')}</h2>
    {#if data.own.length === 0}
      <p class="opacity-70">{t('account.organisations.ownEmpty')}</p>
    {:else}
      <ul class="flex list-none flex-col gap-2">
        {#each data.own as row (row.id)}
          <li class="flex flex-wrap items-center gap-3">
            <a class="link font-medium" href={href(`/organisations/${row.organisation.id}`)}
              >{row.organisation.abbreviation}</a
            >
            <span>{row.organisation.name}</span>
            <StateBadge state={row.state} role={row.role} />
            <span class="text-sm opacity-70"><Time iso={row.requestedAt} /></span>
            {#if row.state === 'requested'}
              <button
                type="button"
                class="btn btn-xs"
                disabled={busy}
                aria-label={t('account.organisations.withdrawLabel', {
                  name: row.organisation.abbreviation,
                })}
                onclick={() => leave(row)}
              >
                {t('organisation.membership.withdraw')}
              </button>
            {:else if row.state === 'approved'}
              <button
                type="button"
                class="btn btn-xs"
                disabled={busy}
                aria-label={t('account.organisations.leaveLabel', {
                  name: row.organisation.abbreviation,
                })}
                onclick={() => (leaving = row)}
              >
                {t('organisation.membership.leave')}
              </button>
            {/if}
          </li>
        {/each}
      </ul>
      {#if data.ownTotal > data.own.length}
        <p class="text-sm opacity-70">
          {t('membership.list.more', { shown: data.own.length, total: data.ownTotal })}
        </p>
      {/if}
    {/if}
  </section>

  <section class="flex flex-col gap-3" aria-labelledby="find-title">
    <h2 id="find-title" class="text-xl font-semibold">{t('account.organisations.find')}</h2>
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
          <label class="text-sm font-medium" for="find-search"
            >{t('admin.organisations.search')}</label
          >
          <input
            id="find-search"
            type="search"
            class="input input-bordered"
            maxlength={100}
            autocomplete="off"
            bind:value={search}
          />
        </div>
        <button type="submit" class="btn">{t('admin.organisations.searchSubmit')}</button>
      </form>
      <div class="flex flex-col gap-1">
        <label class="text-sm font-medium" for="find-type">{t('admin.organisations.type')}</label>
        <select
          id="find-type"
          class="select select-bordered"
          value={data.search.type ?? ''}
          onchange={(event) => void go({ type: event.currentTarget.value || undefined })}
        >
          <option value="">{t('admin.organisations.type.all')}</option>
          {#each choices as choice (choice.id)}
            <option value={choice.id}>{choice.label}</option>
          {/each}
        </select>
      </div>
    </div>

    {#snippet abbreviationCell(row: Found)}
      <a class="link link-hover font-medium" href={href(`/organisations/${row.id}`)}
        >{row.abbreviation}</a
      >
    {/snippet}
    {#snippet typeCell(row: Found)}
      <span class="badge badge-outline">{typeLabel(row.type)}</span>
    {/snippet}
    {#snippet membersCell(row: Found)}
      {t('organisation.members.count', { count: row.memberCount })}
    {/snippet}
    {#snippet statusCell(row: Found)}
      {#if row.myMembership && row.myMembership.state !== 'rejected' && row.myMembership.state !== 'left'}
        <StateBadge state={row.myMembership.state} role={row.myMembership.role} />
      {/if}
    {/snippet}
    {#snippet joinCell(row: Found)}
      {#if canJoin(row)}
        <button
          type="button"
          class="btn btn-primary btn-xs"
          disabled={busy}
          aria-label={t('account.organisations.joinLabel', { name: row.abbreviation })}
          onclick={() => request(row)}
        >
          {t('organisation.membership.request')}
        </button>
      {/if}
    {/snippet}
    <DataTable
      caption={t('account.organisations.find')}
      columns={[
        {
          key: 'abbreviation',
          header: t('admin.organisations.abbreviation'),
          rowHeader: true,
          cell: abbreviationCell,
        },
        { key: 'name', header: t('admin.organisations.name') },
        { key: 'type', header: t('admin.organisations.type'), cell: typeCell },
        { key: 'memberCount', header: t('admin.organisations.members'), cell: membersCell },
        { key: 'status', header: t('account.organisations.status'), cell: statusCell },
      ] satisfies Column<Found>[]}
      rows={data.found}
      rowKey={(row: Found) => row.id}
      page={data.search.page}
      pageSize={SEARCH_PAGE_SIZE}
      total={data.foundTotal}
      pageSizes={[SEARCH_PAGE_SIZE]}
      onpage={(page: number) => void go({ page })}
      empty={t('admin.organisations.empty')}
      actions={joinCell}
      actionsLabel={t('membership.column.actions')}
    />
  </section>

  {#if data.summary.manages && data.sections.length > 0}
    <section class="flex flex-col gap-4" aria-labelledby="manage-title">
      <h2 id="manage-title" class="text-xl font-semibold">{t('account.organisations.manage')}</h2>
      {#each data.sections as section (section.organisation.id)}
        <ManagerOrganisation {section} types={choices} />
      {/each}
    </section>
  {/if}
</div>

<ConfirmDialog
  open={leaving !== undefined}
  title={t('organisation.membership.leaveTitle', { name: leaving?.organisation.name ?? '' })}
  message={t('organisation.membership.leaveMessage')}
  confirmLabel={t('organisation.membership.leave')}
  {busy}
  onconfirm={() => leaving && leave(leaving)}
  oncancel={() => (leaving = undefined)}
/>
