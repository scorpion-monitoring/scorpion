<script lang="ts">
  // The section "Publications" of the service page (M16 sprint 3): the publications of the service with their metadata and
  // citation counts, five per page, and the citation total. Whether the caller may add, remove and check now is the answer's
  // `canEdit`, never a guess from a role; the server checks the scoped write again. One call when the page opens (the list);
  // the history of a publication is read only when it is opened, so the shared `default` rate-limit bucket is spared.
  import { unwrap } from '@scorpion/contracts/client';
  import {
    Alert,
    Chart,
    ConfirmDialog,
    Pagination,
    TextField,
    failureMessage,
    failureOf,
    getShell,
    type ServiceSectionProps,
  } from '@scorpion/ui-kit';
  import { tick } from 'svelte';
  import { authorLine, dayText, doiHref, historySpec, issuedText, waitMinutes } from './format.ts';

  let { service }: ServiceSectionProps = $props();
  const { t, api, locale, toaster } = getShell();

  const PAGE_SIZE = 5;
  type Loaded = Awaited<ReturnType<typeof read>>;
  type Row = Loaded['result'][number];
  const read = (serviceId: string, page: number) =>
    unwrap(
      api.GET('/bibliometrics/services/{serviceId}/publications', {
        params: {
          path: { serviceId },
          query: { page: String(page), pageSize: String(PAGE_SIZE) },
        },
      }),
    );

  let page = $state(0);
  let loaded = $state<Loaded>();
  let loadFailed = $state(false);
  let attempt = $state(0);

  $effect(() => {
    // Client only: the section fills in after the page, with one call per page shown.
    const serviceId = service.id;
    const wanted = page;
    void attempt;
    let current = true;
    loadFailed = false;
    read(serviceId, wanted).then(
      (answer) => {
        if (current) loaded = answer;
      },
      () => {
        if (current) loadFailed = true;
      },
    );
    return () => {
      current = false;
    };
  });

  const reload = () => {
    attempt++;
  };

  const headingId = $props.id();
  let heading = $state<HTMLElement>();
  const titleOf = (row: Row) => row.metadata?.title ?? row.doi;
  const sourceLabel = $derived(loaded?.citations.sourceLabel ?? null);

  // ----- add ------------------------------------------------------------------------------------------
  let doi = $state('');
  let doiErrors = $state<string[]>([]);
  let adding = $state(false);
  let addFailed = $state<string>();

  async function add(event: SubmitEvent) {
    event.preventDefault();
    adding = true;
    doiErrors = [];
    addFailed = undefined;
    try {
      const added = await unwrap(
        api.POST('/bibliometrics/services/{serviceId}/publications', {
          params: { path: { serviceId: service.id } },
          body: { doi: doi.trim() },
        }),
      );
      doi = '';
      toaster.success(t('biblio.add.added', { title: added.metadata?.title ?? added.doi }));
      page = 0;
      reload();
    } catch (error) {
      const failure = failureOf(error);
      if (failure.status === 409) doiErrors = [t('biblio.add.duplicate')];
      else if (failure.status === 422)
        doiErrors = failure.fields.doi?.length
          ? [...failure.fields.doi]
          : [t('biblio.add.invalid')];
      else
        addFailed = failureMessage(failure, t, {
          403: t('biblio.forbidden'),
          404: t('biblio.gone'),
        });
    } finally {
      adding = false;
    }
  }

  // ----- remove ---------------------------------------------------------------------------------------
  let removing = $state<Row>();
  let removeBusy = $state(false);
  let removeFailed = $state<string>();

  async function remove() {
    const row = removing;
    if (!row) return;
    removeBusy = true;
    removeFailed = undefined;
    try {
      await unwrap(
        api.DELETE('/bibliometrics/services/{serviceId}/publications/{publicationId}', {
          params: { path: { serviceId: service.id, publicationId: row.id } },
        }),
      );
      toaster.success(t('biblio.remove.done', { title: titleOf(row) }));
      // The last row of a page that empties goes back one page.
      if (loaded && loaded.result.length === 1 && page > 0) page -= 1;
      reload();
    } catch (error) {
      removeFailed = failureMessage(failureOf(error), t, {
        403: t('biblio.forbidden'),
        404: t('biblio.gone'),
      });
    } finally {
      removeBusy = false;
      removing = undefined;
      // The row's button is gone: the focus goes to the heading of the section.
      await tick();
      heading?.focus();
    }
  }

  // ----- check now ------------------------------------------------------------------------------------
  let checking = $state(false);
  let checkState = $state<{ kind: 'queued' | 'refused'; text: string }>();

  async function checkNow() {
    checking = true;
    checkState = undefined;
    try {
      await unwrap(
        api.POST('/bibliometrics/services/{serviceId}/citations/refresh', {
          params: { path: { serviceId: service.id } },
        }),
      );
      checkState = { kind: 'queued', text: t('biblio.check.queued') };
    } catch (error) {
      const failure = failureOf(error);
      checkState = {
        kind: 'refused',
        text:
          failure.status === 429
            ? t('biblio.check.wait', { count: waitMinutes(failure.retryAfterSeconds) })
            : failureMessage(failure, t, {
                403: t('biblio.forbidden'),
                404: t('biblio.gone'),
                409: t('biblio.check.off'),
              }),
      };
    } finally {
      checking = false;
    }
  }

  // ----- history --------------------------------------------------------------------------------------
  type History = Awaited<ReturnType<typeof readHistory>>;
  const readHistory = (publicationId: string) =>
    unwrap(
      api.GET('/bibliometrics/services/{serviceId}/publications/{publicationId}/history', {
        params: { path: { serviceId: service.id, publicationId } },
      }),
    );
  let open = $state<Record<string, History | 'loading' | 'failed'>>({});

  async function toggleHistory(row: Row) {
    if (open[row.id] !== undefined) {
      open = Object.fromEntries(Object.entries(open).filter(([id]) => id !== row.id));
      return;
    }
    open = { ...open, [row.id]: 'loading' };
    try {
      const history = await readHistory(row.id);
      if (open[row.id] !== undefined) open = { ...open, [row.id]: history };
    } catch {
      if (open[row.id] !== undefined) open = { ...open, [row.id]: 'failed' };
    }
  }
</script>

<section class="flex flex-col gap-3" aria-labelledby={headingId} data-testid="service-publications">
  <h2 id={headingId} class="text-xl font-semibold" tabindex="-1" bind:this={heading}>
    {t('biblio.section.title')}
  </h2>

  {#if loadFailed}
    <Alert kind="error">
      {t('biblio.section.loadFailed')}
      <button type="button" class="btn btn-sm" onclick={reload}>{t('biblio.section.retry')}</button>
    </Alert>
  {:else if !loaded}
    <p class="text-sm opacity-70" role="status">{t('biblio.section.loading')}</p>
  {:else}
    <p data-testid="publications-total">
      {#if loaded.citations.total === null}
        <span class="opacity-70">{t('biblio.totalNone')}</span>
      {:else}
        {t('biblio.total', {
          count: loaded.citations.total,
          total: loaded.citations.total.toLocaleString(locale()),
          found: loaded.citations.found,
          of: loaded.citations.of,
        })}
      {/if}
    </p>

    {#if removeFailed}<Alert kind="error">{removeFailed}</Alert>{/if}

    {#if loaded.result.length === 0}
      <p class="text-sm opacity-70">{t('biblio.section.empty')}</p>
    {:else}
      <ul
        class="flex flex-col gap-3"
        aria-label={t('biblio.section.caption', { name: service.name })}
      >
        {#each loaded.result as row (row.id)}
          {@const authors = authorLine(row.metadata?.authors ?? [], (first) =>
            t('biblio.authors.etAl', { first }),
          )}
          {@const issued = issuedText(row.metadata?.issued, locale())}
          {@const history = open[row.id]}
          <li
            class="border-base-300 flex flex-col gap-1 rounded-box border p-3"
            data-testid="publication"
          >
            <div class="flex flex-wrap items-start justify-between gap-2">
              <div class="flex min-w-0 flex-col gap-1">
                <a
                  class="link font-medium break-words"
                  href={doiHref(row.doi)}
                  rel="noopener noreferrer"
                >
                  {#if row.metadata?.title}
                    {row.metadata.title}
                  {:else}
                    {row.doi}
                  {/if}
                </a>
                {#if !row.metadata?.title}
                  <span class="text-sm opacity-70">
                    {row.metadata?.status === 'not-found'
                      ? t('biblio.title.notFound')
                      : t('biblio.title.unknown')}
                  </span>
                {/if}
                {#if authors}<span class="text-sm">{authors}</span>{/if}
                <span class="text-sm opacity-80">
                  {#if issued}{issued}{/if}{#if issued && row.metadata?.container}
                    ·
                  {/if}{#if row.metadata?.container}<i>{row.metadata.container}</i>{/if}
                </span>
                {#if row.metadata?.title}
                  <span class="text-sm opacity-70">{t('biblio.doi', { doi: row.doi })}</span>
                {/if}
              </div>
              <div class="flex flex-col items-end gap-1 text-sm" data-testid="publication-count">
                {#if row.citedByCount !== null}
                  <span class="text-base font-semibold">
                    {t('biblio.col.citations')}: {row.citedByCount.toLocaleString(locale())}
                  </span>
                  {#if row.citationsAsOf}
                    <span class="opacity-70">
                      {t('biblio.count.asOf', { date: dayText(row.citationsAsOf, locale()) })}
                    </span>
                  {/if}
                {:else if sourceLabel}
                  <span class="opacity-70">
                    {t('biblio.count.notFound', { source: sourceLabel })}
                  </span>
                {:else}
                  <span class="opacity-70">{t('biblio.count.unknown')}</span>
                {/if}
              </div>
            </div>
            <div class="flex flex-wrap gap-2">
              <button
                type="button"
                class="btn btn-ghost btn-xs"
                aria-expanded={history !== undefined}
                aria-controls="history-{row.id}"
                aria-label={history === undefined
                  ? t('biblio.history.show', { title: titleOf(row) })
                  : t('biblio.history.hide')}
                onclick={() => void toggleHistory(row)}
              >
                {history === undefined ? t('biblio.history.showShort') : t('biblio.history.hide')}
              </button>
              {#if loaded.canEdit}
                <button
                  type="button"
                  class="btn btn-ghost btn-xs text-error"
                  aria-label={t('biblio.remove', { title: titleOf(row) })}
                  onclick={() => (removing = row)}
                >
                  {t('biblio.remove.short')}
                </button>
              {/if}
            </div>
            {#if history !== undefined}
              <div id="history-{row.id}">
                {#if history === 'loading'}
                  <p class="text-sm opacity-70" role="status">{t('biblio.history.loading')}</p>
                {:else if history === 'failed'}
                  <Alert kind="error">{t('biblio.history.failed')}</Alert>
                {:else}
                  {@const spec = historySpec(
                    history.points,
                    loaded.citations.source,
                    t('biblio.history.series'),
                    locale(),
                  )}
                  {#if spec}
                    <Chart
                      {spec}
                      size="sm"
                      label={t('biblio.history.label', { title: titleOf(row) })}
                    />
                  {:else}
                    <p class="text-sm opacity-70">{t('biblio.history.empty')}</p>
                  {/if}
                {/if}
              </div>
            {/if}
          </li>
        {/each}
      </ul>
      {#if loaded.metadata.totalCount > PAGE_SIZE}
        <Pagination
          page={loaded.metadata.currentPage}
          pageSize={PAGE_SIZE}
          total={loaded.metadata.totalCount}
          onpage={(next: number) => (page = next)}
        />
      {/if}
    {/if}

    {#if loaded.canEdit}
      <div class="flex flex-col gap-3" data-testid="publication-controls">
        <div class="flex flex-wrap items-center gap-2">
          <button
            type="button"
            class="btn btn-sm"
            disabled={checking || loaded.metadata.totalCount === 0}
            onclick={() => void checkNow()}
          >
            {t('biblio.check.submit')}
          </button>
        </div>
        <p role="status" class:text-warning={checkState?.kind === 'refused'} class="text-sm">
          {checkState?.text ?? ''}
        </p>

        <form class="flex flex-col gap-2" onsubmit={add} aria-label={t('biblio.add.title')}>
          <h3 class="font-semibold">{t('biblio.add.title')}</h3>
          <TextField
            label={t('biblio.add.doi')}
            hint={t('biblio.add.hint')}
            autocomplete="off"
            spellcheck={false}
            required
            maxlength={512}
            bind:value={doi}
            errors={doiErrors}
          />
          {#if addFailed}<Alert kind="error">{addFailed}</Alert>{/if}
          <div>
            <button type="submit" class="btn btn-primary btn-sm" disabled={adding}>
              {t('biblio.add.submit')}
            </button>
          </div>
        </form>
      </div>
    {/if}
  {/if}
</section>

{#if loaded?.canEdit}
  <ConfirmDialog
    open={removing !== undefined}
    title={t('biblio.remove.confirmTitle', { title: removing ? titleOf(removing) : '' })}
    message={t('biblio.remove.confirmMessage')}
    confirmLabel={t('biblio.remove.confirm')}
    busy={removeBusy}
    onconfirm={() => void remove()}
    oncancel={() => (removing = undefined)}
  />
{/if}
