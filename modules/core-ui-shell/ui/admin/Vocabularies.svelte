<script lang="ts">
  // Administration, vocabularies: the lists of terms that modules and forms offer (stages, thematic
  // categories, necessity levels, sender types). A vocabulary is data, not code (CLAUDE.md, rule 8): terms
  // are added, relabelled in each language, reordered and deactivated here. A term a module declared is
  // deactivated and never deleted, and so is one that is in use; the screen says which happened.
  import {
    Alert,
    Breadcrumb,
    ConfirmDialog,
    DataTable,
    Dialog,
    failureMessage,
    failureOf,
    getShell,
    SubmitButton,
    TextField,
    type Column,
    type FormFailure,
  } from '@scorpion/ui-kit';
  import { unwrap } from '@scorpion/contracts/client';
  import type { TermRow, VocabulariesData } from './loaders.ts';

  let { data }: { data: VocabulariesData } = $props();
  const { t, href, goto, api, refresh, toaster, withReauth } = getShell();

  /** The languages the application ships; a vocabulary may hold more (they are kept as they are). */
  const LOCALES = ['en', 'de'] as const;

  let busy = $state(false);
  let general = $state<string>();
  let failure = $state<FormFailure>();
  let deleting = $state<TermRow>();

  // The form of a new term, and of the term being edited (one dialog, so one set of boxes).
  let newKey = $state('');
  let newLabels = $state<Record<string, string>>({ en: '', de: '' });
  let newOrder = $state('');
  let editing = $state<TermRow>();
  let editLabels = $state<Record<string, string>>({ en: '', de: '' });
  let editOrder = $state('');

  const vocabulary = $derived(data.selected);
  const inVocabulary = () => ({ vocabulary: vocabulary! });
  const ofTerm = (key: string) => ({ vocabulary: vocabulary!, key });

  /** Labels with an empty language left out: English is required, any other may be blank. */
  const clean = (labels: Record<string, string>, base: Record<string, string> = {}) => {
    const merged: Record<string, string> = { ...base, ...labels };
    for (const [locale, text] of Object.entries(merged)) {
      if (text.trim() === '') delete merged[locale];
    }
    return merged;
  };
  const orderOf = (text: string) => (text.trim() === '' ? undefined : Number(text));

  async function run<T>(
    action: () => Promise<T>,
    done: string,
    known: Partial<Record<number, string>> = {},
  ): Promise<{ ok: true; value: T } | { ok: false }> {
    busy = true;
    general = undefined;
    failure = undefined;
    try {
      const value = await withReauth(action);
      toaster.success(done);
      await refresh();
      return { ok: true, value };
    } catch (error) {
      const next = failureOf(error);
      if (next.status === 422) failure = next;
      else general = failureMessage(next, t, known);
      return { ok: false };
    } finally {
      busy = false;
    }
  }

  async function create(event: SubmitEvent) {
    event.preventDefault();
    const order = orderOf(newOrder);
    const done = await run(
      () =>
        unwrap(
          api.POST('/vocabularies/{vocabulary}/terms', {
            params: { path: inVocabulary() },
            body: {
              key: newKey.trim(),
              labels: clean(newLabels),
              ...(order === undefined ? {} : { sortOrder: order }),
            },
          }),
        ),
      t('admin.vocabularies.created', { key: newKey.trim() }),
      { 409: t('admin.vocabularies.keyTaken') },
    );
    if (done.ok) {
      newKey = '';
      newLabels = { en: '', de: '' };
      newOrder = '';
    }
  }

  function startEdit(term: TermRow) {
    editing = term;
    editLabels = Object.fromEntries(LOCALES.map((locale) => [locale, term.labels[locale] ?? '']));
    editOrder = String(term.sortOrder);
    failure = undefined;
  }

  async function saveEdit(event: SubmitEvent) {
    event.preventDefault();
    const term = editing!;
    const order = orderOf(editOrder);
    // The locales this form does not draw are kept as they were.
    const others = Object.fromEntries(
      Object.entries(term.labels).filter(
        ([locale]) => !(LOCALES as readonly string[]).includes(locale),
      ),
    );
    const done = await run(
      () =>
        unwrap(
          api.PATCH('/vocabularies/{vocabulary}/terms/{key}', {
            params: { path: ofTerm(term.key) },
            body: {
              labels: clean(editLabels, others),
              ...(order === undefined ? {} : { sortOrder: order }),
            },
          }),
        ),
      t('admin.vocabularies.saved', { key: term.key }),
    );
    if (done.ok) editing = undefined;
  }

  const setActive = (term: TermRow, active: boolean) =>
    run(
      () =>
        unwrap(
          api.PATCH('/vocabularies/{vocabulary}/terms/{key}', {
            params: { path: ofTerm(term.key) },
            body: { active },
          }),
        ),
      t(active ? 'admin.vocabularies.activated' : 'admin.vocabularies.deactivated', {
        key: term.key,
      }),
    );

  async function remove(term: TermRow) {
    const done = await run(
      async () =>
        (
          await unwrap(
            api.DELETE('/vocabularies/{vocabulary}/terms/{key}', {
              params: { path: ofTerm(term.key) },
            }),
          )
        ).outcome,
      t('admin.vocabularies.removed', { key: term.key }),
    );
    // The outcome tells which of the two it was; a term that could not be deleted is now inactive.
    if (done.ok && done.value === 'deactivated') {
      toaster.info(t('admin.vocabularies.keptInactive', { key: term.key }));
    }
    deleting = undefined;
  }

  const fieldErrors = (prefix: 'labels' | 'sortOrder' | 'key', locale?: string) =>
    prefix === 'labels'
      ? (failure?.fields[`labels.${locale}`] ??
        (locale === 'en' ? (failure?.fields.labels ?? []) : []))
      : (failure?.fields[prefix] ?? []);
</script>

<svelte:head
  ><title>{t('admin.settings.area.vocabularies')} · {t('admin.settings.title')}</title></svelte:head
>

<div class="flex flex-col gap-6">
  <Breadcrumb
    items={[
      { label: t('nav.section.admin') },
      { label: t('admin.settings.title'), href: href('/admin/settings') },
      { label: t('admin.settings.area.vocabularies') },
    ]}
  />
  <h1 class="text-2xl font-bold">{t('admin.settings.area.vocabularies')}</h1>
  <p>{t('admin.vocabularies.lead')}</p>
  {#if general}<Alert kind="error">{general}</Alert>{/if}

  {#if data.vocabularies.length === 0}
    <p>{t('admin.vocabularies.none')}</p>
  {:else}
    <div class="flex max-w-md flex-col gap-1">
      <label class="text-sm font-medium" for="vocabulary">{t('admin.vocabularies.choose')}</label>
      <select
        id="vocabulary"
        class="select select-bordered"
        value={data.selected ?? ''}
        onchange={(event) =>
          void goto(
            href('/admin/settings/vocabularies') +
              `?vocabulary=${encodeURIComponent(event.currentTarget.value)}`,
          )}
      >
        {#each data.vocabularies as option (option.id)}
          <option value={option.id}>{option.id} ({option.activeTerms}/{option.terms})</option>
        {/each}
      </select>
      <p class="text-sm opacity-70">
        {data.vocabularies.find((entry) => entry.id === data.selected)?.description ?? ''}
      </p>
    </div>

    {#snippet keyCell(row: TermRow)}
      <code>{row.key}</code>
      {#if row.seeded}<span class="badge badge-ghost ms-2">{t('admin.vocabularies.seeded')}</span
        >{/if}
    {/snippet}
    {#snippet labelsCell(row: TermRow)}
      <ul>
        {#each Object.entries(row.labels) as [locale, text] (locale)}
          <li><span class="opacity-70">{locale}</span> {text}</li>
        {/each}
      </ul>
    {/snippet}
    {#snippet activeCell(row: TermRow)}
      <span class="badge" class:badge-success={row.active} class:badge-ghost={!row.active}>
        {row.active ? t('admin.vocabularies.active') : t('admin.vocabularies.inactive')}
      </span>
    {/snippet}
    {#snippet actions(row: TermRow)}
      <button
        type="button"
        class="btn btn-ghost btn-xs"
        disabled={busy}
        aria-label={t('admin.vocabularies.editNamed', { key: row.key })}
        onclick={() => startEdit(row)}
      >
        {t('admin.vocabularies.edit')}
      </button>
      <button
        type="button"
        class="btn btn-ghost btn-xs"
        disabled={busy}
        aria-label={t(
          row.active ? 'admin.vocabularies.deactivateNamed' : 'admin.vocabularies.activateNamed',
          { key: row.key },
        )}
        onclick={() => setActive(row, !row.active)}
      >
        {row.active ? t('admin.vocabularies.deactivate') : t('admin.vocabularies.activate')}
      </button>
      <button
        type="button"
        class="btn btn-ghost btn-xs"
        disabled={busy}
        aria-label={t('admin.vocabularies.removeNamed', { key: row.key })}
        onclick={() => (deleting = row)}
      >
        {t('admin.vocabularies.remove')}
      </button>
    {/snippet}

    <DataTable
      caption={t('admin.vocabularies.terms', { vocabulary: data.selected ?? '' })}
      columns={[
        { key: 'key', header: t('admin.vocabularies.key'), rowHeader: true, cell: keyCell },
        { key: 'labels', header: t('admin.vocabularies.labels'), cell: labelsCell },
        {
          key: 'sortOrder',
          header: t('admin.vocabularies.order'),
          value: (row: TermRow) => row.sortOrder,
        },
        { key: 'active', header: t('admin.settings.state'), cell: activeCell },
      ] satisfies Column<TermRow>[]}
      rows={data.terms}
      rowKey={(row: TermRow) => row.key}
      {actions}
      actionsLabel={t('admin.secrets.actions')}
      empty={t('admin.vocabularies.empty')}
    />

    <section class="card bg-base-100 border-base-300 border" aria-labelledby="new-term-title">
      <div class="card-body gap-4">
        <h2 id="new-term-title" class="card-title">{t('admin.vocabularies.newTitle')}</h2>
        <form method="post" onsubmit={create} class="flex flex-col gap-4">
          <TextField
            label={t('admin.vocabularies.key')}
            name="termKey"
            autocomplete="off"
            bind:value={newKey}
            hint={t('admin.vocabularies.keyHint')}
            errors={fieldErrors('key')}
            required
            maxlength={64}
          />
          {#each LOCALES as locale (locale)}
            <TextField
              label={t('admin.vocabularies.label', { locale })}
              name={`termLabel-${locale}`}
              autocomplete="off"
              bind:value={newLabels[locale]!}
              errors={fieldErrors('labels', locale)}
              required={locale === 'en'}
              maxlength={200}
            />
          {/each}
          <TextField
            label={t('admin.vocabularies.order')}
            name="termOrder"
            autocomplete="off"
            bind:value={newOrder}
            hint={t('admin.vocabularies.orderHint')}
            errors={fieldErrors('sortOrder')}
            inputmode="numeric"
          />
          <div><SubmitButton {busy}>{t('admin.vocabularies.add')}</SubmitButton></div>
        </form>
      </div>
    </section>
  {/if}
</div>

<Dialog
  open={editing !== undefined}
  title={t('admin.vocabularies.editTitle', { key: editing?.key ?? '' })}
  onclose={() => (editing = undefined)}
>
  <form method="post" onsubmit={saveEdit} class="flex flex-col gap-4">
    {#each LOCALES as locale (locale)}
      <TextField
        label={t('admin.vocabularies.label', { locale })}
        name={`editLabel-${locale}`}
        autocomplete="off"
        bind:value={editLabels[locale]!}
        errors={fieldErrors('labels', locale)}
        required={locale === 'en'}
        maxlength={200}
      />
    {/each}
    <TextField
      label={t('admin.vocabularies.order')}
      name="editOrder"
      autocomplete="off"
      bind:value={editOrder}
      errors={fieldErrors('sortOrder')}
      inputmode="numeric"
    />
    <div class="flex justify-end gap-2">
      <button type="button" class="btn" onclick={() => (editing = undefined)}
        >{t('admin.vocabularies.cancel')}</button
      >
      <SubmitButton {busy}>{t('admin.vocabularies.saveTerm')}</SubmitButton>
    </div>
  </form>
</Dialog>

<ConfirmDialog
  open={deleting !== undefined}
  title={t('admin.vocabularies.removeTitle')}
  message={t('admin.vocabularies.removeMessage', { key: deleting?.key ?? '' })}
  confirmLabel={t('admin.vocabularies.remove')}
  {busy}
  onconfirm={() => deleting && remove(deleting)}
  oncancel={() => (deleting = undefined)}
/>
