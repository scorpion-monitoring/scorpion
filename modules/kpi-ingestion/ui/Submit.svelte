<script lang="ts">
  // The Data Submission page: choose a service, then report a month in the form, from a file, or look at the history. The address holds the
  // service and the month (`?service=<id>&period=YYYY-MM`), so a link opens the same view. Everything the page shows is read by its loader on the
  // server; the browser sends a request itself only when a person saves, previews or checks.
  import { Alert, Breadcrumb, getShell, Tabs, type TabItem } from '@scorpion/ui-kit';
  import History from './History.svelte';
  import type { SubmitData } from './loaders.ts';
  import ReportFile from './ReportFile.svelte';
  import ReportForm from './ReportForm.svelte';
  import ServicePicker from './ServicePicker.svelte';

  let { data }: { data: SubmitData } = $props();
  const { t, href } = getShell();

  let tab = $state('form');
  // What was typed in the form of each service and month, so that a visit to the File or History tab does not lose it.
  const drafts: Record<string, { values?: Record<string, string> }> = {};
  const draftFor = (key: string) => (drafts[key] ??= {});
  const tabs = $derived<TabItem[]>([
    { id: 'form', label: t('submit.tabs.form') },
    { id: 'file', label: t('submit.tabs.file') },
    { id: 'history', label: t('submit.tabs.history') },
  ]);
  const none = $derived(data.services.length === 0 && !data.query.q && !data.selected);
</script>

<svelte:head><title>{t('submit.title')}</title></svelte:head>

<div class="flex flex-col gap-6">
  <Breadcrumb items={[{ label: t('submit.title') }]} />
  <h1 class="text-2xl font-bold">{t('submit.title')}</h1>

  {#if none}
    <Alert kind="info">
      <strong class="block">{t('submit.none.title')}</strong>
      {t('submit.none.body')}
      <a class="link" href={href('/account/organisations')}>{t('submit.none.link')}</a>
    </Alert>
  {:else}
    <p>{t('submit.intro')}</p>
    <ServicePicker services={data.services} selected={data.selected?.service} q={data.query.q} />
    {#if data.services.length === 0 && !data.selected}
      <p role="status">{t('submit.noMatch')}</p>
    {:else if !data.selected}
      <p>{t('submit.choose')}</p>
    {/if}
  {/if}

  {#if data.selected}
    {@const selected = data.selected}
    <section class="flex flex-col gap-4" aria-labelledby="submit-service-title">
      <div class="flex flex-wrap items-center justify-between gap-2">
        <h2 id="submit-service-title" class="text-xl font-semibold">
          {t('submit.reporting', { name: selected.service.name })}
        </h2>
        <a class="link" href={href(`/services/${selected.service.slug}`)}
          >{t('submit.service.link')}</a
        >
      </div>
      <Tabs {tabs} bind:selected={tab} label={t('submit.tabs.label')}>
        {#snippet children(id: string)}
          {#key `${selected.service.id}:${selected.period}`}
            {#if id === 'form'}
              <ReportForm
                {selected}
                draft={draftFor(`${selected.service.id}:${selected.period}`)}
              />
            {:else if id === 'file'}
              <ReportFile {selected} />
            {:else}
              <History {selected} />
            {/if}
          {/key}
        {/snippet}
      </Tabs>
    </section>
  {/if}
</div>
