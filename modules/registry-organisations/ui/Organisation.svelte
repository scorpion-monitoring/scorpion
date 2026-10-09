<script lang="ts">
  // One organisation: logo, name, abbreviation, type, description, links, the contact point when the API
  // returned it, the member count, the viewer's own membership with the action that fits, and the member list
  // when the API allows it. The page shows what the API returns and never decides from the client: a part the
  // caller may not see is simply absent from the data. The Schema.org block in the head is rendered on the
  // server from the profile route by the one audited component (`JsonLd.svelte`).
  import {
    Alert,
    Breadcrumb,
    ConfirmDialog,
    failureMessage,
    failureOf,
    getShell,
    Time,
  } from '@scorpion/ui-kit';
  import { unwrap } from '@scorpion/contracts/client';
  import JsonLd from './JsonLd.svelte';
  import type { OrganisationData } from './loaders.ts';
  import { rorLink } from './ror.ts';

  let { data }: { data: OrganisationData } = $props();
  const { t, href, api, refresh, toaster, locale } = getShell();

  const organisation = $derived(data.organisation);
  const entry = $derived(data.types.find((type) => type.id === organisation.type));
  /** The label of the type for the person's language, from the registry entry. */
  const typeLabel = $derived(
    entry
      ? ((entry.labels as Record<string, string | undefined>)[locale()] ?? entry.labels.en)
      : t('organisation.type.unknown', { id: organisation.type }),
  );
  const mine = $derived(organisation.myMembership);
  /** An administrator edits every field; the API says so in `editableFields`. */
  const isAdmin = $derived(organisation.editableFields.includes('name'));
  const canJoin = $derived(
    entry?.membership === true &&
      (mine === null || mine.state === 'rejected' || mine.state === 'left'),
  );

  let busy = $state(false);
  let failed = $state<string>();
  let leaving = $state(false);

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
      leaving = false;
    }
  }

  const request = () =>
    act(
      () =>
        unwrap(
          api.POST('/organisations/{id}/membership', { params: { path: { id: organisation.id } } }),
        ),
      t('organisation.membership.requested'),
    );
  const withdraw = () =>
    act(
      () =>
        unwrap(
          api.DELETE('/organisations/{id}/membership', {
            params: { path: { id: organisation.id } },
          }),
        ),
      t('organisation.membership.withdrawn'),
    );
</script>

<svelte:head>
  <title>{organisation.name}</title>
</svelte:head>
<JsonLd profile={data.profile} />

<div class="flex max-w-3xl flex-col gap-6">
  <Breadcrumb items={[{ label: t('organisation.crumb') }, { label: organisation.name }]} />

  <header class="flex flex-wrap items-center gap-4">
    {#if organisation.logoUrl}
      <img
        class="bg-base-200 h-20 w-auto max-w-xs rounded p-2"
        src={organisation.logoUrl}
        alt={t('organisation.logo.alt', { name: organisation.name })}
      />
    {/if}
    <div class="flex flex-col gap-1">
      <h1 class="text-2xl font-bold">{organisation.name}</h1>
      <p class="flex flex-wrap items-center gap-2">
        <span class="font-medium">{organisation.abbreviation}</span>
        <span class="badge badge-outline">{typeLabel}</span>
        {#if mine?.state === 'requested'}
          <span class="badge badge-warning">{t('organisation.membership.state.requested')}</span>
        {:else if mine?.state === 'approved'}
          <span class="badge badge-success">
            {mine.role === 'manager'
              ? t('organisation.membership.state.manager')
              : t('organisation.membership.state.member')}
          </span>
        {/if}
      </p>
    </div>
  </header>

  {#if isAdmin}
    <p>
      <a class="btn btn-sm" href={href(`/admin/organisations/${organisation.id}`)}
        >{t('organisation.edit')}</a
      >
    </p>
  {/if}

  {#if organisation.description}
    <p class="whitespace-pre-line">{organisation.description}</p>
  {/if}

  <dl class="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-[max-content_1fr]">
    {#if organisation.website}
      <dt class="font-medium">{t('organisation.website')}</dt>
      <dd>
        <a class="link" href={organisation.website} rel="noopener noreferrer"
          >{organisation.website}</a
        >
      </dd>
    {/if}
    {#if organisation.rorId}
      <dt class="font-medium">{t('organisation.rorId')}</dt>
      <dd>
        <a class="link" href={rorLink(organisation.rorId)} rel="noopener noreferrer"
          >{organisation.rorId}</a
        >
      </dd>
    {/if}
    {#if organisation.sameAs.length > 0}
      <dt class="font-medium">{t('organisation.sameAs')}</dt>
      <dd>
        <ul class="list-none">
          {#each organisation.sameAs as link (link)}
            <li><a class="link" href={link} rel="noopener noreferrer">{link}</a></li>
          {/each}
        </ul>
      </dd>
    {/if}
    {#if organisation.contactEmail}
      <dt class="font-medium">{t('organisation.contact')}</dt>
      <dd>
        <a class="link" href={`mailto:${organisation.contactEmail}`}>{organisation.contactEmail}</a>
        {#if organisation.contactType}<span class="opacity-70">
            ({organisation.contactType})</span
          >{/if}
      </dd>
    {/if}
    <dt class="font-medium">{t('organisation.members')}</dt>
    <dd>{t('organisation.members.count', { count: organisation.memberCount })}</dd>
  </dl>

  {#if failed}<Alert kind="error">{failed}</Alert>{/if}

  <section class="flex flex-col gap-2" aria-labelledby="org-membership-title">
    <h2 id="org-membership-title" class="text-lg font-semibold">
      {t('organisation.membership.title')}
    </h2>
    {#if mine?.state === 'requested'}
      <p>{t('organisation.membership.pending')}</p>
      <div>
        <button type="button" class="btn btn-sm" disabled={busy} onclick={withdraw}>
          {t('organisation.membership.withdraw')}
        </button>
      </div>
    {:else if mine?.state === 'approved'}
      <p>
        {mine.role === 'manager'
          ? t('organisation.membership.isManager')
          : t('organisation.membership.isMember')}
      </p>
      <div>
        <button type="button" class="btn btn-sm" disabled={busy} onclick={() => (leaving = true)}>
          {t('organisation.membership.leave')}
        </button>
      </div>
    {:else if canJoin}
      <p>{t('organisation.membership.lead')}</p>
      <div>
        <button type="button" class="btn btn-primary btn-sm" disabled={busy} onclick={request}>
          {t('organisation.membership.request')}
        </button>
      </div>
    {:else}
      <p class="opacity-70">{t('organisation.membership.none')}</p>
    {/if}
  </section>

  {#if data.members}
    <section class="flex flex-col gap-2" aria-labelledby="org-members-title">
      <h2 id="org-members-title" class="text-lg font-semibold">
        {t('organisation.memberList.title')}
      </h2>
      {#if data.members.length === 0}
        <p class="opacity-70">{t('organisation.memberList.empty')}</p>
      {:else}
        <ul class="list-none">
          {#each data.members as member (member.username)}
            <li>
              <span class="font-medium">{member.username}</span>
              <span class="opacity-70">
                {t('organisation.memberList.since')}
                <Time iso={member.since} />
              </span>
            </li>
          {/each}
        </ul>
      {/if}
    </section>
  {/if}
</div>

<ConfirmDialog
  open={leaving}
  title={t('organisation.membership.leaveTitle', { name: organisation.name })}
  message={t('organisation.membership.leaveMessage')}
  confirmLabel={t('organisation.membership.leave')}
  {busy}
  onconfirm={() =>
    act(
      () =>
        unwrap(
          api.DELETE('/organisations/{id}/membership', {
            params: { path: { id: organisation.id } },
          }),
        ),
      t('organisation.membership.left'),
    )}
  oncancel={() => (leaving = false)}
/>
