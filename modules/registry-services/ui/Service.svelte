<script lang="ts">
  // One service: the icon, name, short name, stage and licence in words, description, links, who operates it and
  // what it is part of (each links to its organisation page), the contact point when the API returned it, a
  // "Public" or "Private" badge in words, and the buttons the API says the caller may use (`allowedActions`).
  // The page shows what the API returns and decides nothing: no button comes from a role. The Schema.org block
  // in the head is rendered on the server from the profile route by the one audited component (ui-kit's
  // `JsonLd.svelte`); this page never builds the string. Edit mode is `ServiceEdit.svelte`.
  import { unwrap } from '@scorpion/contracts/client';
  import { serializeJsonLd } from '@scorpion/registry-organisations/public';
  import {
    Alert,
    Breadcrumb,
    ConfirmDialog,
    failureMessage,
    failureOf,
    getShell,
    JsonLd,
    serviceSections,
  } from '@scorpion/ui-kit';
  import { tick } from 'svelte';
  import type { ServiceData } from './loaders.ts';
  import ServiceEdit from './ServiceEdit.svelte';

  let { data }: { data: ServiceData } = $props();
  const { t, api, href, goto, refresh, toaster } = getShell();

  // The sections other modules contribute (a module's `ui` entry, forwarded by the shell): each loads its own data.
  const sections = serviceSections();

  const service = $derived(data.service);
  const fields = $derived(data.schema.steps.flatMap((step) => step.fields));
  /** The words for the stage: the label of its term, from the options the server sent with the field. */
  const stage = $derived(
    fields
      .find((field) => field.column === 'stage')
      ?.choices?.find((choice) => choice.value === service.stage)?.label ?? service.stage,
  );
  /** Who is linked to the service, grouped by the roles the server lists, in their order. */
  const groups = $derived(
    [...data.schema.roles]
      .sort((a, b) => a.order - b.order)
      .map((role) => ({
        id: role.id,
        heading: role.memberOnly ? t('services.owner') : t('services.group'),
        organisations: service.organisations.filter(
          (organisation) => organisation.role === role.id,
        ),
      }))
      .filter((group) => group.organisations.length > 0),
  );
  const can = (action: 'edit' | 'publish' | 'unpublish') => service.allowedActions.includes(action);

  let editing = $state(false);
  let status = $state<string>();
  let failed = $state<string>();
  let statusLine = $state<HTMLElement>();
  let editButton = $state<HTMLElement>();
  let confirming = $state<'publish' | 'unpublish'>();
  let publishOff = $state(false);
  let busy = $state(false);

  /** Says what happened and puts the focus on that line: the button that was used may no longer be there. */
  async function announce(text: string) {
    status = text;
    failed = undefined;
    await tick();
    statusLine?.focus();
  }

  async function change(makePublic: boolean) {
    busy = true;
    failed = undefined;
    try {
      await unwrap(
        api.PUT('/services/{id}/publication', {
          params: { path: { id: service.id } },
          body: { public: makePublic },
        }),
      );
      confirming = undefined;
      const name = service.name;
      await refresh();
      await announce(t(makePublic ? 'services.publish.done' : 'services.unpublish.done', { name }));
    } catch (error) {
      confirming = undefined;
      status = undefined;
      const failure = failureOf(error);
      publishOff = failure.status === 409;
      failed = failureMessage(failure, t, {
        409: t('services.publish.off'),
        403: t('services.publish.forbidden'),
      });
    } finally {
      busy = false;
    }
  }

  /** Leaving the form without saving: the keyboard goes back to the button that opened it. */
  async function cancelEdit() {
    editing = false;
    await tick();
    editButton?.focus();
  }

  async function saved(record: ServiceData['service']) {
    editing = false;
    if (record.slug !== service.slug) {
      // The old address still works; the notice goes with the person to the new one.
      const text = t('services.edit.renamed', { name: record.name, slug: record.slug });
      toaster.success(text);
      await goto(href(`/services/${encodeURIComponent(record.slug)}`), { replace: true });
      await announce(text);
      return;
    }
    await refresh();
    await announce(t('services.edit.saved'));
  }
</script>

<svelte:head>
  <title>{service.name}</title>
</svelte:head>
<JsonLd json={serializeJsonLd(data.profile)} />

<div class="flex max-w-3xl flex-col gap-6">
  <Breadcrumb
    items={[{ label: t('services.title'), href: href('/services') }, { label: service.name }]}
  />

  <header class="flex flex-wrap items-center gap-4">
    {#if service.iconUrl}
      <img
        class="bg-base-200 h-20 w-auto max-w-xs rounded p-2"
        src={service.iconUrl}
        alt={t('services.icon.alt', { name: service.name })}
      />
    {/if}
    <div class="flex flex-col gap-1">
      <h1 class="text-2xl font-bold">{service.name}</h1>
      <p class="flex flex-wrap items-center gap-2">
        <span
          class="badge"
          class:badge-success={service.public}
          class:badge-outline={!service.public}
        >
          {service.public ? t('services.detail.public') : t('services.detail.private')}
        </span>
        <span class="text-sm opacity-70">
          {service.public ? t('services.detail.publicHelp') : t('services.detail.privateHelp')}
        </span>
      </p>
    </div>
  </header>

  {#if status}
    <p
      class="alert alert-success"
      role="status"
      tabindex="-1"
      id="service-status"
      bind:this={statusLine}
    >
      {status}
    </p>
  {/if}
  {#if failed}<Alert kind="error">{failed}</Alert>{/if}

  {#if !editing && (can('edit') || can('publish') || can('unpublish') || service.public)}
    <div
      class="flex flex-wrap items-center gap-2"
      role="group"
      aria-label={t('services.detail.actions')}
    >
      {#if can('edit')}
        <button
          type="button"
          class="btn btn-sm btn-primary"
          bind:this={editButton}
          onclick={() => (editing = true)}
        >
          {t('services.edit')}
        </button>
      {/if}
      {#if can('publish') || publishOff}
        <button
          type="button"
          class="btn btn-sm"
          disabled={publishOff}
          aria-describedby={publishOff ? 'service-publish-off' : undefined}
          onclick={() => (confirming = 'publish')}
        >
          {t('services.publish')}
        </button>
      {/if}
      {#if can('unpublish')}
        <button type="button" class="btn btn-sm" onclick={() => (confirming = 'unpublish')}>
          {t('services.unpublish')}
        </button>
      {/if}
      {#if service.public}
        <a
          class="btn btn-sm btn-ghost"
          href={href(`/public/services/${encodeURIComponent(service.slug)}`)}
        >
          {t('services.detail.publicPage')}
        </a>
      {/if}
    </div>
    {#if publishOff}
      <p class="text-sm opacity-70" id="service-publish-off">{t('services.publish.offHint')}</p>
    {/if}
  {/if}

  {#if editing}
    <ServiceEdit {data} oncancel={cancelEdit} onsaved={saved} onicon={() => void refresh()} />
  {:else}
    {#if service.description}
      <p class="whitespace-pre-line">{service.description}</p>
    {/if}

    <dl class="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-[max-content_1fr]">
      <dt class="font-medium">{t('services.detail.shortName')}</dt>
      <dd>{service.slug}</dd>
      <dt class="font-medium">{t('services.detail.stage')}</dt>
      <dd>{stage}</dd>
      {#if data.licence}
        <dt class="font-medium">{t('services.detail.license')}</dt>
        <dd>
          {data.licence.name}
          {#if data.licence.name !== data.licence.id}<span class="opacity-70">
              ({data.licence.id})</span
            >{/if}
          {#if data.licence.deprecated}<span class="badge badge-warning ms-1"
              >{t('services.detail.licenseDeprecated')}</span
            >{/if}
        </dd>
      {/if}
      {#each groups as group (group.id)}
        <dt class="font-medium">{group.heading}</dt>
        <dd>
          <ul class="list-none">
            {#each group.organisations as organisation (organisation.id)}
              <li>
                <a class="link" href={href(`/organisations/${organisation.id}`)}
                  >{organisation.name}</a
                >
                <span class="opacity-70">({organisation.abbreviation})</span>
              </li>
            {/each}
          </ul>
        </dd>
      {/each}
      {#if service.url}
        <dt class="font-medium">{t('services.detail.url')}</dt>
        <dd><a class="link" href={service.url} rel="noopener noreferrer">{service.url}</a></dd>
      {/if}
      {#if service.sameAs.length > 0}
        <dt class="font-medium">{t('services.detail.sameAs')}</dt>
        <dd>
          <ul class="list-none">
            {#each service.sameAs as link (link)}
              <li><a class="link" href={link} rel="noopener noreferrer">{link}</a></li>
            {/each}
          </ul>
        </dd>
      {/if}
      {#if service.contactEmail}
        <dt class="font-medium">{t('services.detail.contact')}</dt>
        <dd>
          <a class="link" href={`mailto:${service.contactEmail}`}>{service.contactEmail}</a>
          {#if service.contactType}<span class="opacity-70"> ({service.contactType})</span>{/if}
        </dd>
      {/if}
    </dl>
    {#each sections as [name, Section] (name)}
      <Section service={{ id: service.id, slug: service.slug, name: service.name }} />
    {/each}
  {/if}
</div>

{#if can('publish') || can('unpublish') || publishOff}
  <ConfirmDialog
    open={confirming !== undefined}
    tone="primary"
    title={t(confirming === 'unpublish' ? 'services.unpublish.title' : 'services.publish.title', {
      name: service.name,
    })}
    message={t(
      confirming === 'unpublish' ? 'services.unpublish.message' : 'services.publish.message',
    )}
    confirmLabel={t(
      confirming === 'unpublish' ? 'services.unpublish.confirm' : 'services.publish.confirm',
    )}
    {busy}
    onconfirm={() => void change(confirming === 'publish')}
    oncancel={() => (confirming = undefined)}
  />
{/if}
