<script lang="ts">
  // Administration, secrets: the names of the secrets that are stored, when each was set, and a form to set
  // or replace one and a button to delete one. **A value is never shown and never sent back**: the list
  // holds names and times, and the box for a value is emptied the moment it is sent. Secrets live in the
  // encrypted store, not in the settings (CLAUDE.md, security rules).
  import {
    Alert,
    Breadcrumb,
    ConfirmDialog,
    DataTable,
    failureMessage,
    failureOf,
    getShell,
    SubmitButton,
    TextField,
    Time,
    type Column,
    type FormFailure,
  } from '@scorpion/ui-kit';
  import { unwrap } from '@scorpion/contracts/client';
  import type { SecretRow, SecretsData } from './loaders.ts';

  let { data }: { data: SecretsData } = $props();
  const { t, href, api, refresh, toaster, withReauth } = getShell();

  let name = $state('');
  let value = $state('');
  let busy = $state(false);
  let failure = $state<FormFailure>();
  let general = $state<string>();
  let deleting = $state<SecretRow>();
  let nameField = $state<HTMLElement>();

  async function set(event: SubmitEvent) {
    event.preventDefault();
    const target = name.trim();
    // The value leaves the page's memory as it is sent; a failed attempt asks for it again.
    const sending = value;
    value = '';
    busy = true;
    failure = undefined;
    general = undefined;
    try {
      await withReauth(() =>
        unwrap(
          api.PUT('/secrets/{name}', {
            params: { path: { name: target } },
            body: { value: sending },
          }),
        ),
      );
      toaster.success(t('admin.secrets.saved', { name: target }));
      name = '';
      await refresh();
    } catch (error) {
      const next = failureOf(error);
      if (next.status === 422) failure = next;
      else general = failureMessage(next, t);
    } finally {
      busy = false;
    }
  }

  async function remove(row: SecretRow) {
    busy = true;
    general = undefined;
    try {
      await withReauth(() =>
        unwrap(api.DELETE('/secrets/{name}', { params: { path: { name: row.name } } })),
      );
      toaster.success(t('admin.secrets.deleted', { name: row.name }));
      await refresh();
    } catch (error) {
      const next = failureOf(error);
      general = failureMessage(next, t);
      if (next.status === 404) await refresh();
    } finally {
      busy = false;
      deleting = undefined;
    }
  }

  const replace = (row: SecretRow) => {
    name = row.name;
    nameField?.querySelector('input')?.focus();
  };
</script>

<svelte:head
  ><title>{t('admin.settings.area.secrets')} · {t('admin.settings.title')}</title></svelte:head
>

<div class="mx-auto flex max-w-3xl flex-col gap-6">
  <Breadcrumb
    items={[
      { label: t('nav.section.admin') },
      { label: t('admin.settings.title'), href: href('/admin/settings') },
      { label: t('admin.settings.area.secrets') },
    ]}
  />
  <h1 class="text-2xl font-bold">{t('admin.settings.area.secrets')}</h1>
  <p>{t('admin.secrets.lead')}</p>
  {#if general}<Alert kind="error">{general}</Alert>{/if}

  {#snippet updated(row: SecretRow)}<Time iso={row.updatedAt} />{/snippet}
  {#snippet nameCell(row: SecretRow)}<code>{row.name}</code>{/snippet}
  {#snippet actions(row: SecretRow)}
    <button
      type="button"
      class="btn btn-ghost btn-xs"
      aria-label={t('admin.secrets.replaceNamed', { name: row.name })}
      onclick={() => replace(row)}
    >
      {t('admin.secrets.replace')}
    </button>
    <button
      type="button"
      class="btn btn-ghost btn-xs"
      disabled={busy}
      aria-label={t('admin.secrets.deleteNamed', { name: row.name })}
      onclick={() => (deleting = row)}
    >
      {t('admin.secrets.delete')}
    </button>
  {/snippet}

  <DataTable
    caption={t('admin.settings.area.secrets')}
    columns={[
      { key: 'name', header: t('admin.secrets.name'), rowHeader: true, cell: nameCell },
      { key: 'set', header: t('admin.secrets.status'), value: () => t('admin.secrets.set') },
      { key: 'updatedAt', header: t('admin.secrets.updated'), cell: updated },
    ] satisfies Column<SecretRow>[]}
    rows={data.secrets}
    rowKey={(row: SecretRow) => row.name}
    {actions}
    actionsLabel={t('admin.secrets.actions')}
    empty={t('admin.secrets.empty')}
  />

  <section class="card bg-base-100 border-base-300 border" aria-labelledby="set-title">
    <div class="card-body gap-4">
      <h2 id="set-title" class="card-title">{t('admin.secrets.setTitle')}</h2>
      <form method="post" onsubmit={set} class="flex flex-col gap-4">
        <div bind:this={nameField}>
          <TextField
            label={t('admin.secrets.name')}
            name="secretName"
            autocomplete="off"
            bind:value={name}
            hint={t('admin.secrets.nameHint')}
            errors={failure?.fields.name ?? []}
            required
            maxlength={128}
          />
        </div>
        <TextField
          label={t('admin.secrets.value')}
          type="password"
          name="secretValue"
          autocomplete="new-password"
          bind:value
          hint={t('admin.secrets.valueHint')}
          errors={failure?.fields.value ?? []}
          required
          maxlength={4096}
        />
        <div><SubmitButton {busy}>{t('admin.secrets.save')}</SubmitButton></div>
      </form>
    </div>
  </section>
</div>

<ConfirmDialog
  open={deleting !== undefined}
  title={t('admin.secrets.deleteTitle')}
  message={t('admin.secrets.deleteMessage', { name: deleting?.name ?? '' })}
  confirmLabel={t('admin.secrets.delete')}
  {busy}
  onconfirm={() => deleting && remove(deleting)}
  oncancel={() => (deleting = undefined)}
/>
