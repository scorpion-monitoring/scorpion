<script lang="ts">
  // Administration, membership requests: the pending requests of every organisation, oldest first (the order of
  // the API), with filters by organisation, type and state, and the actions the API allows on each row
  // (approve, reject, promote, demote, remove). Nobody decides on their own request or changes their own role:
  // those rows carry no buttons and say why, as the API would answer 403.
  import { tick } from 'svelte';
  import { Breadcrumb, DataTable, getShell, Time, type Column } from '@scorpion/ui-kit';
  import type { AdminMembershipsData, ManagedRow } from '../loaders.ts';
  import MembershipActions from '../MembershipActions.svelte';
  import {
    changeMembershipsQuery,
    MEMBERSHIP_STATES,
    membershipsQueryString,
    type MembershipsQuery,
  } from '../member-query.ts';
  import { hasManager, type RowAction } from '../membership-rows.ts';
  import StateBadge from '../StateBadge.svelte';

  let { data }: { data: AdminMembershipsData } = $props();
  const { t, href, goto, refresh, locale } = getShell();

  const path = '/admin/memberships';
  const go = (change: Partial<MembershipsQuery>) =>
    goto(href(path) + membershipsQueryString(changeMembershipsQuery(data.query, change)));

  const typeLabel = (id: string) => {
    const entry = data.types.find((type) => type.id === id);
    if (!entry) return t('organisation.type.unknown', { id });
    return (entry.labels as Record<string, string | undefined>)[locale()] ?? entry.labels.en;
  };

  let status = $state<HTMLElement>();
  let outcome = $state<string>();
  async function changed(row: ManagedRow, action: RowAction) {
    outcome = t(`membership.done.${action}`, {
      name: row.username ?? t('membership.unknownPerson'),
    });
    await refresh();
    // The pressed button may have left with its row: focus goes to the line that says what happened.
    await tick();
    status?.focus();
  }

  // One organisation, its approved members and none of them a manager: administrators decide.
  const noManager = $derived(
    data.query.organisationId !== undefined &&
      data.query.state === 'approved' &&
      data.total === data.rows.length &&
      !hasManager(data.rows),
  );
</script>

<svelte:head><title>{t('admin.memberships.title')}</title></svelte:head>

<div class="flex flex-col gap-6">
  <Breadcrumb
    items={[{ label: t('nav.section.admin') }, { label: t('admin.memberships.title') }]}
  />
  <h1 class="text-2xl font-bold">{t('admin.memberships.title')}</h1>

  <p
    bind:this={status}
    tabindex="-1"
    class="text-sm outline-none"
    class:hidden={outcome === undefined}
  >
    {outcome}
  </p>

  <form class="flex flex-wrap items-end gap-4" onsubmit={(event) => event.preventDefault()}>
    <div class="flex flex-col gap-1">
      <label class="text-sm font-medium" for="memberships-state"
        >{t('admin.memberships.state')}</label
      >
      <select
        id="memberships-state"
        class="select select-bordered"
        value={data.query.state}
        onchange={(event) =>
          void go({ state: event.currentTarget.value as MembershipsQuery['state'] })}
      >
        {#each MEMBERSHIP_STATES as state (state)}
          <option value={state}>{t(`admin.memberships.state.${state}`)}</option>
        {/each}
      </select>
    </div>
    <div class="flex flex-col gap-1">
      <label class="text-sm font-medium" for="memberships-organisation">
        {t('admin.memberships.organisation')}
      </label>
      <select
        id="memberships-organisation"
        class="select select-bordered"
        value={data.query.organisationId ?? ''}
        onchange={(event) => void go({ organisationId: event.currentTarget.value || undefined })}
      >
        <option value="">{t('admin.memberships.organisation.all')}</option>
        {#each data.organisations as organisation (organisation.id)}
          <option value={organisation.id}>{organisation.abbreviation}: {organisation.name}</option>
        {/each}
      </select>
    </div>
    <div class="flex flex-col gap-1">
      <label class="text-sm font-medium" for="memberships-type"
        >{t('admin.organisations.type')}</label
      >
      <select
        id="memberships-type"
        class="select select-bordered"
        value={data.query.type ?? ''}
        onchange={(event) => void go({ type: event.currentTarget.value || undefined })}
      >
        <option value="">{t('admin.organisations.type.all')}</option>
        {#each data.types as type (type.id)}
          <option value={type.id}>{typeLabel(type.id)}</option>
        {/each}
      </select>
    </div>
  </form>
  {#if data.organisationsTotal > data.organisations.length}
    <p class="text-sm opacity-70">
      {t('admin.memberships.organisation.more', {
        shown: data.organisations.length,
        total: data.organisationsTotal,
      })}
    </p>
  {/if}
  {#if noManager}<p class="text-sm">{t('membership.noManager')}</p>{/if}

  {#snippet personCell(row: ManagedRow)}
    <span class="font-medium">{row.username ?? t('membership.unknownPerson')}</span>
  {/snippet}
  {#snippet organisationCell(row: ManagedRow)}
    <a class="link link-hover" href={href(`/organisations/${row.organisation.id}`)}
      >{row.organisation.abbreviation}</a
    >
  {/snippet}
  {#snippet stateCell(row: ManagedRow)}<StateBadge state={row.state} role={row.role} />{/snippet}
  {#snippet requestedCell(row: ManagedRow)}<Time iso={row.requestedAt} />{/snippet}
  {#snippet decidedCell(row: ManagedRow)}{#if row.decidedAt}<Time
        iso={row.decidedAt}
      />{/if}{/snippet}
  {#snippet actionsCell(row: ManagedRow)}
    <MembershipActions {row} onchanged={changed} />
  {/snippet}

  <DataTable
    caption={t('admin.memberships.title')}
    columns={[
      { key: 'username', header: t('membership.column.person'), rowHeader: true, cell: personCell },
      {
        key: 'organisation',
        header: t('admin.memberships.column.organisation'),
        cell: organisationCell,
      },
      { key: 'state', header: t('membership.column.role'), cell: stateCell },
      { key: 'requestedAt', header: t('membership.column.requested'), cell: requestedCell },
      { key: 'decidedAt', header: t('membership.column.decided'), cell: decidedCell },
    ] satisfies Column<ManagedRow>[]}
    rows={data.rows}
    rowKey={(row: ManagedRow) => row.id}
    page={data.query.page}
    pageSize={data.query.pageSize}
    total={data.total}
    onpage={(page: number) => void go({ page })}
    onpagesize={(pageSize: number) => void go({ pageSize })}
    empty={t('admin.memberships.empty')}
    actions={actionsCell}
    actionsLabel={t('membership.column.actions')}
  />
</div>
