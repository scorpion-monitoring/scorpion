<script lang="ts">
  // The section "KPIs" of the service page: the KPI set with the necessity of each indicator, and the indicators the
  // service added. It reads from the one `GET /kpi/services/{id}/kpis`; whether the caller may change them is the
  // answer's `canEdit`, never a guess from a role. Editing is the same editor as the wizard's, saved in one request.
  import { unwrap } from '@scorpion/contracts/client';
  import {
    Alert,
    failureMessage,
    failureOf,
    getShell,
    type ServiceSectionProps,
  } from '@scorpion/ui-kit';
  import { tick } from 'svelte';
  import KpiEditor from './KpiEditor.svelte';
  import type { Known, KpisValue } from './kpi-types.ts';
  import { labelOf, type Term } from './terms.ts';
  import { vocabularyTerms } from './vocabulary.ts';

  let { service }: ServiceSectionProps = $props();
  const { t, api, locale, toaster } = getShell();

  type Loaded = Awaited<ReturnType<typeof read>>;
  const read = (serviceId: string) =>
    unwrap(api.GET('/kpi/services/{id}/kpis', { params: { path: { id: serviceId } } }));

  let loaded = $state<Loaded>();
  let loadFailed = $state(false);
  let necessity = $state<Term[]>([]);
  let units = $state<Term[]>([]);

  $effect(() => {
    // Client only: the section fills in after the page, with the one call and the two vocabularies (kept per session).
    let current = true;
    loadFailed = false;
    read(service.id).then(
      (answer) => {
        if (current) loaded = answer;
      },
      () => {
        if (current) loadFailed = true;
      },
    );
    void vocabularyTerms(api, 'necessity').then(
      (terms) => (necessity = terms),
      () => {},
    );
    void vocabularyTerms(api, 'kpi.unit').then(
      (terms) => (units = terms),
      () => {},
    );
    return () => {
      current = false;
    };
  });

  // ----- editing --------------------------------------------------------------------------------------
  let editing = $state(false);
  let draft = $state<KpisValue>({ setId: null, extras: [] });
  let sets = $state<{ id: string; name: string }[]>([]);
  let busy = $state(false);
  let failed = $state<string>();
  let status = $state<string>();
  let statusLine = $state<HTMLElement>();
  let editButton = $state<HTMLElement>();
  let editor = $state<HTMLElement>();

  async function startEdit() {
    if (!loaded) return;
    failed = undefined;
    status = undefined;
    draft = { setId: loaded.set?.id ?? null, extras: loaded.extras.map((row) => row.indicatorId) };
    try {
      const answer = await unwrap(
        api.GET('/kpi/sets', { params: { query: { page: '0', pageSize: '100' } } }),
      );
      sets = answer.result.map((row) => ({ id: row.id, name: row.name }));
    } catch {
      failed = t('kpi.section.setsFailed');
      return;
    }
    editing = true;
    await tick();
    editor?.focus();
  }

  async function cancel() {
    editing = false;
    await tick();
    editButton?.focus();
  }

  async function save() {
    busy = true;
    failed = undefined;
    try {
      loaded = await unwrap(
        api.PUT('/kpi/services/{id}/kpis', {
          params: { path: { id: service.id } },
          body: { setId: draft.setId, extras: draft.extras },
        }),
      );
      editing = false;
      status = t('kpi.section.saved');
      toaster.success(status);
      await tick();
      statusLine?.focus();
    } catch (error) {
      failed = failureMessage(failureOf(error), t, {
        403: t('kpi.section.forbidden'),
        404: t('kpi.section.gone'),
        409: t('kpi.section.conflict'),
      });
    } finally {
      busy = false;
    }
  }

  const known = $derived<Known[]>(
    (loaded?.extras ?? []).map((row) => ({
      indicatorId: row.indicatorId,
      name: row.name,
      unit: row.unit,
    })),
  );
  const unitLabel = (key: string | null) => (key ? labelOf(units, key, locale()) : '');
  const headingId = $props.id();
</script>

<section class="flex flex-col gap-3" aria-labelledby={headingId} data-testid="service-kpis">
  <h2 id={headingId} class="text-xl font-semibold">{t('kpi.section.title')}</h2>

  {#if status}
    <p class="alert alert-success" role="status" tabindex="-1" bind:this={statusLine}>{status}</p>
  {/if}
  {#if failed}<Alert kind="error">{failed}</Alert>{/if}

  {#if loadFailed}
    <Alert kind="error">{t('kpi.section.loadFailed')}</Alert>
  {:else if !loaded}
    <p class="text-sm opacity-70" role="status">{t('kpi.section.loading')}</p>
  {:else if editing}
    <div tabindex="-1" bind:this={editor}>
      <KpiEditor
        id="service-kpis-editor"
        {sets}
        setId={draft.setId}
        extras={draft.extras}
        {known}
        disabled={busy}
        onchange={(next: KpisValue) => (draft = next)}
      />
    </div>
    <div class="flex flex-wrap gap-2">
      <button type="button" class="btn btn-primary" disabled={busy} onclick={() => void save()}>
        {t('kpi.section.save')}
      </button>
      <button type="button" class="btn" disabled={busy} onclick={() => void cancel()}>
        {t('kpi.section.cancel')}
      </button>
    </div>
  {:else}
    <p>
      {#if loaded.set}
        <span class="font-medium">{t('kpi.section.set')}</span> {loaded.set.name}
      {:else}
        <span class="opacity-70">{t('kpi.section.noSet')}</span>
      {/if}
    </p>
    {#if loaded.rows.length > 0}
      <div class="overflow-x-auto">
        <table class="table table-sm">
          <caption class="sr-only">{t('kpi.section.title')}</caption>
          <thead>
            <tr>
              <th scope="col">{t('kpi.editor.col.name')}</th>
              <th scope="col">{t('kpi.editor.col.unit')}</th>
              <th scope="col">{t('kpi.editor.col.necessity')}</th>
              <th scope="col">{t('kpi.editor.col.source')}</th>
            </tr>
          </thead>
          <tbody>
            {#each loaded.rows as row (row.indicatorId)}
              <tr>
                <td>{row.name}</td>
                <td>{unitLabel(row.unit)}</td>
                <td
                  ><span class="badge badge-outline"
                    >{labelOf(necessity, row.necessity, locale())}</span
                  ></td
                >
                <td class="opacity-70">
                  {row.source === 'set' ? t('kpi.editor.source.set') : t('kpi.editor.source.extra')}
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    {:else}
      <p class="text-sm opacity-70">{t('kpi.section.empty')}</p>
    {/if}
    {#if loaded.canEdit}
      <div>
        <button
          type="button"
          class="btn btn-sm btn-primary"
          bind:this={editButton}
          onclick={() => void startEdit()}
        >
          {t('kpi.section.edit')}
        </button>
      </div>
    {/if}
  {/if}
</section>
