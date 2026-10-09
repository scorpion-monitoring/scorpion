<script lang="ts">
  // Administration, one organisation: the create form and the editor with every field, the logo, and the
  // delete (which asks first and says what goes with it). An administrator may write every field; the form
  // is drawn from `editableFields` all the same, so what the server says is what the page offers.
  import {
    Alert,
    Breadcrumb,
    ConfirmDialog,
    failureMessage,
    failureOf,
    getShell,
  } from '@scorpion/ui-kit';
  import { unwrap } from '@scorpion/contracts/client';
  import type { AdminOrganisationData } from '../loaders.ts';
  import { referenceBlock } from '../errors.ts';
  import type { FormField } from '../form-schema.ts';
  import LogoBlock from '../LogoBlock.svelte';
  import OrganisationForm from '../OrganisationForm.svelte';

  let {
    data,
  }: {
    data:
      AdminOrganisationData | { organisation: undefined; types: AdminOrganisationData['types'] };
  } = $props();
  const { t, href, goto, api, toaster, locale } = getShell();

  const creating = $derived(data.organisation === undefined);
  const stored = $derived(data.organisation);
  const choices = $derived(
    data.types.map((type) => ({
      id: type.id,
      label: (type.labels as Record<string, string | undefined>)[locale()] ?? type.labels.en,
      membership: type.membership,
    })),
  );
  /** Every field for an administrator; the API says so in `editableFields`. */
  const fields = $derived<FormField[]>(
    creating
      ? ['type', 'abbreviation', 'name', 'description', 'website', 'sameAs', 'rorId', 'contact']
      : ((stored?.editableFields ?? []) as FormField[]),
  );

  let confirming = $state(false);
  let busy = $state(false);
  let failed = $state<string>();

  async function remove() {
    if (!stored) return;
    busy = true;
    failed = undefined;
    try {
      await unwrap(api.DELETE('/organisations/{id}', { params: { path: { id: stored.id } } }));
      toaster.success(t('organisation.delete.done', { name: stored.name }));
      await goto(href('/admin/organisations'));
    } catch (error) {
      const block = referenceBlock(error);
      failed = block
        ? block.modules.length > 0
          ? t('organisation.delete.inUse', { modules: block.modules.join(', ') })
          : t('organisation.delete.inUse.unnamed')
        : failureMessage(failureOf(error), t, { 404: t('organisation.delete.gone') });
      confirming = false;
    } finally {
      busy = false;
    }
  }
</script>

<svelte:head>
  <title>{stored ? stored.name : t('admin.organisations.new')}</title>
</svelte:head>

<div class="flex max-w-3xl flex-col gap-6">
  <Breadcrumb
    items={[
      { label: t('nav.section.admin') },
      { label: t('admin.organisations.title'), href: href('/admin/organisations') },
      { label: stored ? stored.name : t('admin.organisations.new') },
    ]}
  />
  <h1 class="text-2xl font-bold">
    {stored ? stored.name : t('admin.organisations.new')}
  </h1>
  {#if stored}
    <p>
      <a class="link" href={href(`/organisations/${stored.id}`)}>{t('admin.organisations.view')}</a>
    </p>
  {/if}

  {#if failed}<Alert kind="error">{failed}</Alert>{/if}

  <section class="card bg-base-100 border-base-300 border" aria-labelledby="org-form-title">
    <div class="card-body gap-4">
      <h2 id="org-form-title" class="card-title">{t('organisation.form.title')}</h2>
      <OrganisationForm
        mode={creating ? 'create' : 'edit'}
        types={choices}
        {fields}
        {stored}
        onsaved={async (saved: { id: string }) => {
          if (creating) await goto(href(`/admin/organisations/${saved.id}`));
        }}
      />
    </div>
  </section>

  {#if stored}
    <LogoBlock organisation={stored} editable={fields.includes('logo')} />

    <section class="card bg-base-100 border-base-300 border" aria-labelledby="org-delete-title">
      <div class="card-body gap-3">
        <h2 id="org-delete-title" class="card-title">{t('organisation.delete.title')}</h2>
        <p>{t('organisation.delete.lead')}</p>
        <div class="card-actions">
          <button
            type="button"
            class="btn btn-error btn-outline btn-sm"
            onclick={() => (confirming = true)}
          >
            {t('organisation.delete.button')}
          </button>
        </div>
      </div>
    </section>
  {:else}
    <p class="opacity-70">{t('organisation.logo.afterCreate')}</p>
  {/if}
</div>

{#if stored}
  <ConfirmDialog
    open={confirming}
    title={t('organisation.delete.confirmTitle', { name: stored.name })}
    message={t('organisation.delete.confirmMessage')}
    confirmLabel={t('organisation.delete.confirm')}
    {busy}
    onconfirm={remove}
    oncancel={() => (confirming = false)}
  />
{/if}
