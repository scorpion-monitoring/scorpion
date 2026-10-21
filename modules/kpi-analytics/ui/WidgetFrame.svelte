<script lang="ts">
  // The frame every widget of kpi.analytics draws itself in: the heading (the widget's name and the service), the states that say what to do
  // (choose a service, loading, no KPIs, no values in this range, a failed read with a retry) and, once the numbers have arrived, the widget's own
  // body. It reads through the dashboard's shared read store, so widgets over the same service, range and category cost one request together;
  // it asks again only when its own service, range or category changes (a move, a resize or a toggle of a chart's series changes none of them).
  // A tile that has never been set up shows the person's defaults and, in edit mode, takes them (a new widget starts with the defaults).
  // Every state is a `role="status"` or an `Alert`: no blank tile.
  import type { Snippet } from 'svelte';
  import { ApiError, type AnalyticsSummary } from '@scorpion/contracts/client';
  import {
    Alert,
    getAnalyticsReads,
    getShell,
    RANGE_KEYS,
    type ServiceName,
  } from '@scorpion/ui-kit';
  import { resolveConfig, seeded, type Filter } from './settings.ts';
  import type { Body } from './types.ts';

  let {
    title,
    config,
    editing,
    setConfig,
    units = false,
    body,
  }: {
    /** The widget's name, as the heading and the tile's accessible name. */
    title: string;
    config: Record<string, unknown>;
    editing: boolean;
    setConfig: (next: Record<string, unknown>) => void;
    /** The widget shows units: read the vocabulary of units once for the dashboard. */
    units?: boolean;
    body: Snippet<[Body]>;
  } = $props();

  const { t, locale } = getShell();
  const reads = getAnalyticsReads();
  const titleId = $props.id();

  // ---- what the tile reads with ----------------------------------------------------------------------------------------------
  const fresh = $derived(!('service' in config));
  let defaults = $state<Filter>();
  let defaultsFailed = $state(false);
  $effect(() => {
    if (!fresh || defaults) return;
    reads.defaults().then(
      (own) => (defaults = { service: own.service, range: own.range, category: own.category }),
      () => (defaultsFailed = true),
    );
  });
  const resolved = $derived(resolveConfig(config, defaults));
  // Primitives, so a change of the configuration that is not the filter (a series toggled) does not read again.
  const service = $derived(resolved?.service ?? null);
  const range = $derived(resolved?.range ?? '1y');
  const category = $derived(resolved?.category ?? 'all');

  // A new widget takes the defaults when the dashboard is being edited; in view mode it only shows them, so opening the page never writes.
  $effect(() => {
    if (editing && fresh && defaults) setConfig(seeded(config, defaults));
  });

  // ---- the numbers -----------------------------------------------------------------------------------------------------------
  type State =
    | { kind: 'idle' }
    | { kind: 'loading' }
    | { kind: 'error'; settings: boolean }
    | { kind: 'ready'; page: AnalyticsSummary };
  let read = $state.raw<State>({ kind: 'idle' });
  let attempt = $state(0);

  // A boolean, not the object: `resolved` is a new object whenever the configuration changes, and the read must not start again (the body
  // would be torn down and drawn anew: the options of a chart would close under the person's hand) for a change that is not the filter.
  const known = $derived(resolved !== undefined);
  $effect(() => {
    void attempt;
    if (!known || service === null) {
      read = { kind: 'idle' };
      return;
    }
    let live = true;
    read = { kind: 'loading' };
    reads.summary({ service, range, category }).then(
      (page) => live && (read = { kind: 'ready', page }),
      // A 422 names a parameter: the service is gone or the category left the vocabulary. The settings are what to fix.
      (error: unknown) =>
        live &&
        (read = { kind: 'error', settings: error instanceof ApiError && error.status === 422 }),
    );
    return () => {
      live = false;
    };
  });

  // ---- the name of the service and the labels of units ------------------------------------------------------------------------
  let named = $state<ServiceName>();
  $effect(() => {
    const wanted = service;
    named = undefined;
    if (wanted === null) return;
    reads.service(wanted).then(
      (found) => {
        if (service === wanted) named = found;
      },
      () => undefined,
    );
  });

  let unitTerms = $state<Map<string, string>>();
  // The labels are read together with the numbers, not before: a tile that says "Choose a service" needs none.
  const wantsUnits = $derived(units && read.kind !== 'idle');
  $effect(() => {
    if (!wantsUnits) return;
    reads.terms('kpi.unit').then(
      (terms) =>
        (unitTerms = new Map(
          terms.map((term) => [term.key, term.labels[locale()] ?? term.labels.en ?? term.key]),
        )),
      () => (unitTerms = new Map()),
    );
  });
  const unit = (key: string | null) => (key === null ? '' : (unitTerms?.get(key) ?? key));

  // ---- what to say ---------------------------------------------------------------------------------------------------------
  const rangeText = $derived(RANGE_KEYS[range] ? t(RANGE_KEYS[range]) : range);
  // One string, so the separator keeps its spaces: `Name · Last year`.
  const subtitle = $derived(named ? `${named.name} · ${rangeText}` : rangeText);
  const ready = $derived(read.kind === 'ready' ? read.page : undefined);
  const hasNoKpis = $derived(ready !== undefined && ready.metadata.totalCount === 0);
  const hasNoValues = $derived(
    ready !== undefined &&
      ready.result.length > 0 &&
      ready.result.every((row) =>
        row.points.every((point) => point.value === null && point.text === null),
      ),
  );
  const shown = $derived<Body | undefined>(
    ready && !hasNoKpis && !hasNoValues
      ? {
          rows: ready.result,
          total: ready.metadata.totalCount,
          months: ready.result[0]?.points.map((point) => point.period) ?? [],
          unit,
        }
      : undefined,
  );
</script>

<section class="card bg-base-100 border-base-300 h-full min-h-0 border" aria-labelledby={titleId}>
  <div class="card-body min-h-0 gap-2 p-4">
    <div>
      <h2 id={titleId} class="card-title text-base">{title}</h2>
      {#if service !== null}
        <p class="text-base-content/70 text-sm">{subtitle}</p>
      {/if}
    </div>

    {#if defaultsFailed && fresh}
      <Alert kind="error">{t('analytics.state.defaultsFailed')}</Alert>
    {:else if resolved === undefined}
      <p class="text-sm" role="status">{t('analytics.state.loading')}</p>
    {:else if service === null}
      <p class="text-sm" role="status">
        <strong>{t('analytics.state.chooseService')}</strong>
        {t('analytics.state.chooseService.how')}
      </p>
    {:else if read.kind === 'error'}
      <Alert kind="error">
        <span>
          {read.settings ? t('analytics.state.badSettings') : t('analytics.state.failed')}
        </span>
        {#if !read.settings}
          <button type="button" class="btn btn-sm ms-2" onclick={() => (attempt += 1)}>
            {t('analytics.state.retry')}
          </button>
        {/if}
      </Alert>
    {:else if read.kind !== 'ready'}
      <p class="text-sm" role="status">{t('analytics.state.loading')}</p>
    {:else if hasNoKpis}
      <p class="text-sm" role="status">{t('analytics.state.noKpis')}</p>
    {:else if hasNoValues}
      <p class="text-sm" role="status">{t('analytics.state.noValues')}</p>
    {:else if shown}
      <div class="flex min-h-0 flex-1 flex-col gap-2">
        {@render body(shown)}
        {#if shown.total > shown.rows.length}
          <p class="text-base-content/70 text-sm">
            {t('analytics.state.more', { shown: shown.rows.length, total: shown.total })}
          </p>
        {/if}
      </div>
    {/if}
  </div>
</section>
