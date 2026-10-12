<script lang="ts">
  // "My organisations", one organisation the caller manages: the requests waiting for a decision, the members
  // with the actions the API allows, and the edit form for the descriptive fields. Everything is drawn from
  // the data the API returned (`allowedActions`, `editableFields`); `type`, `abbreviation` and `name` are read
  // only for a manager and the page says why. There is no create and no delete here.
  import { tick } from 'svelte';
  import { DataTable, getShell, Time, type Column } from '@scorpion/ui-kit';
  import type { TypeChoice } from './form-context.ts';
  import type { FormField } from './form-schema.ts';
  import type { AccountOrganisationsData, ManagedRow } from './loaders.ts';
  import LogoBlock from './LogoBlock.svelte';
  import MembershipActions from './MembershipActions.svelte';
  import { hasManager, type RowAction } from './membership-rows.ts';
  import OrganisationForm from './OrganisationForm.svelte';
  import StateBadge from './StateBadge.svelte';

  type Section = AccountOrganisationsData['sections'][number];
  let { section, types }: { section: Section; types: readonly TypeChoice[] } = $props();
  const { t, href, refresh } = getShell();

  const titleId = $props.id();
  const organisation = $derived(section.organisation);
  const fields = $derived(organisation.editableFields as FormField[]);
  /** The identity fields this caller cannot write; shown as plain text with the reason. */
  const readOnly = $derived(
    (['type', 'abbreviation', 'name'] as const).filter((field) => !fields.includes(field)),
  );
  const typeLabel = $derived(
    types.find((type) => type.id === organisation.type)?.label ?? organisation.type,
  );

  // The decisions taken on this page stay in view (with their outcome) until the page is left, while the
  // lists reload without them.
  let decided = $state<ManagedRow[]>([]);
  let status = $state<HTMLElement>();
  let outcome = $state<string>();

  async function changed(row: ManagedRow, action: RowAction) {
    outcome = t(`membership.done.${action}`, {
      name: row.username ?? t('membership.unknownPerson'),
    });
    if (action === 'approve' || action === 'reject') decided = [row, ...decided];
    await refresh();
    // The button that was pressed may be gone with its row: focus goes to the line that says what happened.
    await tick();
    status?.focus();
  }

  const managers = $derived(section.members.filter((row) => row.role === 'manager').length);
</script>

<section class="card bg-base-100 border-base-300 border" aria-labelledby={titleId}>
  <div class="card-body gap-6">
    <div class="flex flex-wrap items-center justify-between gap-2">
      <h3 id={titleId} class="card-title">
        {organisation.name}
        <span class="badge badge-outline">{organisation.abbreviation}</span>
      </h3>
      <a class="link" href={href(`/organisations/${organisation.id}`)}
        >{t('admin.organisations.view')}</a
      >
    </div>

    <p
      bind:this={status}
      tabindex="-1"
      class="text-sm outline-none"
      class:hidden={outcome === undefined}
    >
      {outcome}
    </p>

    <section class="flex flex-col gap-2" aria-labelledby="{titleId}-requests">
      <h4 id="{titleId}-requests" class="text-lg font-semibold">
        {t('membership.requests.title')}
      </h4>
      {#snippet requestPerson(row: ManagedRow)}
        <span class="font-medium">{row.username ?? t('membership.unknownPerson')}</span>
      {/snippet}
      {#snippet requestedAt(row: ManagedRow)}<Time iso={row.requestedAt} />{/snippet}
      {#snippet requestActions(row: ManagedRow)}
        <MembershipActions {row} onchanged={changed} />
      {/snippet}
      <DataTable
        caption={t('membership.requests.caption', { name: organisation.name })}
        columns={[
          {
            key: 'username',
            header: t('membership.column.person'),
            rowHeader: true,
            cell: requestPerson,
          },
          { key: 'requestedAt', header: t('membership.column.requested'), cell: requestedAt },
        ] satisfies Column<ManagedRow>[]}
        rows={section.requests}
        rowKey={(row: ManagedRow) => row.id}
        actions={requestActions}
        actionsLabel={t('membership.column.actions')}
        empty={t('membership.requests.empty')}
      />
      {#if section.requestsTotal > section.requests.length}
        <p class="text-sm opacity-70">
          {t('membership.list.more', {
            shown: section.requests.length,
            total: section.requestsTotal,
          })}
        </p>
      {/if}
      {#if decided.length > 0}
        <ul class="list-none text-sm" aria-label={t('membership.decided.title')}>
          {#each decided as row (row.id)}
            <li class="flex flex-wrap items-center gap-2">
              <span class="font-medium">{row.username ?? t('membership.unknownPerson')}</span>
              <StateBadge state={row.state} role={row.role} />
              {#if row.decidedAt}<Time iso={row.decidedAt} />{/if}
            </li>
          {/each}
        </ul>
      {/if}
    </section>

    <section class="flex flex-col gap-2" aria-labelledby="{titleId}-members">
      <h4 id="{titleId}-members" class="text-lg font-semibold">{t('membership.members.title')}</h4>
      {#if !hasManager(section.members)}
        <p class="text-sm">{t('membership.noManager')}</p>
      {:else if managers === 1}
        <p class="text-sm opacity-70">{t('membership.onlyManager')}</p>
      {/if}
      {#snippet memberPerson(row: ManagedRow)}
        <span class="font-medium">{row.username ?? t('membership.unknownPerson')}</span>
      {/snippet}
      {#snippet memberRole(row: ManagedRow)}<StateBadge
          state={row.state}
          role={row.role}
        />{/snippet}
      {#snippet memberSince(row: ManagedRow)}{#if row.decidedAt}<Time
            iso={row.decidedAt}
          />{/if}{/snippet}
      {#snippet memberActions(row: ManagedRow)}
        <MembershipActions {row} onchanged={changed} />
      {/snippet}
      <DataTable
        caption={t('membership.members.caption', { name: organisation.name })}
        columns={[
          {
            key: 'username',
            header: t('membership.column.person'),
            rowHeader: true,
            cell: memberPerson,
          },
          { key: 'role', header: t('membership.column.role'), cell: memberRole },
          { key: 'since', header: t('membership.column.since'), cell: memberSince },
        ] satisfies Column<ManagedRow>[]}
        rows={section.members}
        rowKey={(row: ManagedRow) => row.id}
        actions={memberActions}
        actionsLabel={t('membership.column.actions')}
        empty={t('membership.members.empty')}
      />
      {#if section.membersTotal > section.members.length}
        <p class="text-sm opacity-70">
          {t('membership.list.more', {
            shown: section.members.length,
            total: section.membersTotal,
          })}
        </p>
      {/if}
    </section>

    <section class="flex flex-col gap-3" aria-labelledby="{titleId}-edit">
      <h4 id="{titleId}-edit" class="text-lg font-semibold">
        {t('organisation.manager.editTitle')}
      </h4>
      {#if readOnly.length > 0}
        <dl class="grid grid-cols-1 gap-x-6 gap-y-1 sm:grid-cols-[max-content_1fr]">
          {#if readOnly.includes('type')}
            <dt class="font-medium">{t('organisation.form.type')}</dt>
            <dd>{typeLabel}</dd>
          {/if}
          {#if readOnly.includes('abbreviation')}
            <dt class="font-medium">{t('organisation.form.abbreviation')}</dt>
            <dd>{organisation.abbreviation}</dd>
          {/if}
          {#if readOnly.includes('name')}
            <dt class="font-medium">{t('organisation.form.name')}</dt>
            <dd>{organisation.name}</dd>
          {/if}
        </dl>
        <p class="text-sm opacity-70">{t('organisation.manager.readOnly')}</p>
      {/if}
      <OrganisationForm
        mode="edit"
        {types}
        {fields}
        stored={organisation}
        onsaved={() => refresh()}
      />
      <LogoBlock {organisation} editable={fields.includes('logo')} />
    </section>
  </div>
</section>
