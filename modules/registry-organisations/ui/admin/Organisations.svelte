<script lang="ts">
  // Administration, organisations: every organisation with a search, a type filter and pages (the server
  // sorts by abbreviation, then id). A row leads to the editor; "New organisation" to the create form.
  import { Breadcrumb, DataTable, getShell, type Column } from '@scorpion/ui-kit';
  import type { AdminOrganisationsData } from '../loaders.ts';
  import {
    changeOrganisationsQuery,
    organisationsQueryString,
    type OrganisationsQuery,
  } from '../query.ts';

  let { data }: { data: AdminOrganisationsData } = $props();
  const { t, href, goto, locale } = getShell();

  type Row = AdminOrganisationsData['organisations'][number];

  const path = '/admin/organisations';
  const go = (change: Partial<OrganisationsQuery>) =>
    goto(href(path) + organisationsQueryString(changeOrganisationsQuery(data.query, change)));

  // What is typed in the search box; it starts from the address and goes back to it when the address changes.
  let search = $derived(data.query.q ?? '');

  /** The label of a type for the person's language, from the registry entry; an unregistered one shows its id. */
  const typeLabel = (id: string) => {
    const entry = data.types.find((type) => type.id === id);
    if (!entry) return t('organisation.type.unknown', { id });
    return (entry.labels as Record<string, string | undefined>)[locale()] ?? entry.labels.en;
  };
</script>

<svelte:head><title>{t('admin.organisations.title')}</title></svelte:head>

<div class="flex flex-col gap-6">
  <Breadcrumb
    items={[{ label: t('nav.section.admin') }, { label: t('admin.organisations.title') }]}
  />
  <div class="flex flex-wrap items-center justify-between gap-2">
    <h1 class="text-2xl font-bold">{t('admin.organisations.title')}</h1>
    <a class="btn btn-primary" href={href('/admin/organisations/new')}>
      {t('admin.organisations.new')}
    </a>
  </div>

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
        <label class="text-sm font-medium" for="organisations-search">
          {t('admin.organisations.search')}
        </label>
        <input
          id="organisations-search"
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
      <label class="text-sm font-medium" for="organisations-type">
        {t('admin.organisations.type')}
      </label>
      <select
        id="organisations-type"
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
  </div>

  {#snippet abbreviationCell(row: Row)}
    <a class="link link-hover font-medium" href={href(`/admin/organisations/${row.id}`)}
      >{row.abbreviation}</a
    >
  {/snippet}
  {#snippet typeCell(row: Row)}
    <span class="badge badge-outline">{typeLabel(row.type)}</span>
  {/snippet}

  <DataTable
    caption={t('admin.organisations.title')}
    columns={[
      {
        key: 'abbreviation',
        header: t('admin.organisations.abbreviation'),
        rowHeader: true,
        cell: abbreviationCell,
      },
      { key: 'name', header: t('admin.organisations.name') },
      { key: 'type', header: t('admin.organisations.type'), cell: typeCell },
      { key: 'memberCount', header: t('admin.organisations.members') },
    ] satisfies Column<Row>[]}
    rows={data.organisations}
    rowKey={(row: Row) => row.id}
    page={data.query.page}
    pageSize={data.query.pageSize}
    total={data.total}
    onpage={(page: number) => void go({ page })}
    onpagesize={(pageSize: number) => void go({ pageSize })}
    empty={t('admin.organisations.empty')}
  />
</div>
