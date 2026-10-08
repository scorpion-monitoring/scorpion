<script lang="ts">
  // Administration, one entry of the trail. The query, the body and the payload are shown as they were
  // stored: secrets were replaced by `[redacted]` and long values cut when the entry was written.
  import { Breadcrumb, getShell, Time } from '@scorpion/ui-kit';
  import type { LogEntry } from './loaders.ts';

  let { data }: { data: { entry: LogEntry } } = $props();
  const { t, href } = getShell();
  const entry = $derived(data.entry);

  const json = (value: unknown) => JSON.stringify(value, null, 2);
</script>

<svelte:head><title>{t('admin.logs.entry.title')}</title></svelte:head>

<div class="flex flex-col gap-6">
  <Breadcrumb
    items={[
      { label: t('nav.section.admin') },
      { label: t('admin.logs.title'), href: href('/admin/logs') },
      { label: t('admin.logs.entry.title') },
    ]}
  />
  <h1 class="text-2xl font-bold">{t('admin.logs.entry.title')}</h1>

  <dl class="grid gap-x-6 gap-y-2 sm:grid-cols-[max-content_1fr]">
    <dt class="font-medium">{t('admin.logs.col.time')}</dt>
    <dd><Time iso={entry.occurredAt} /></dd>
    <dt class="font-medium">{t('admin.logs.col.user')}</dt>
    <dd>
      {#if entry.userId && entry.userName}
        <a class="link" href={href(`/admin/users/${entry.userId}`)}>{entry.userName}</a>
      {:else if entry.userId}
        {t('admin.logs.deletedAccount')}
      {:else}
        {t(`admin.logs.actor.${entry.actorKind}`)}
      {/if}
      {#if entry.userId}<span class="ms-2 font-mono text-sm opacity-80">{entry.userId}</span>{/if}
    </dd>
    <dt class="font-medium">{t('admin.logs.filter.action')}</dt>
    <dd class="font-mono text-sm">{entry.action}</dd>
    <dt class="font-medium">{t('admin.logs.col.source')}</dt>
    <dd>{t(`admin.logs.source.${entry.source}`)}</dd>
    <dt class="font-medium">{t('admin.logs.col.outcome')}</dt>
    <dd>{t(`admin.logs.outcome.${entry.outcome}`)}{entry.status ? ` (${entry.status})` : ''}</dd>
    {#if entry.method}
      <dt class="font-medium">{t('admin.logs.entry.request')}</dt>
      <dd class="font-mono text-sm">{entry.method} {entry.path}</dd>
    {/if}
    {#if entry.subjectType}
      <dt class="font-medium">{t('admin.logs.entry.subject')}</dt>
      <dd class="font-mono text-sm">{entry.subjectType} {entry.subjectId ?? ''}</dd>
    {/if}
    {#if entry.tokenId}
      <dt class="font-medium">{t('admin.logs.entry.token')}</dt>
      <dd class="font-mono text-sm">{entry.tokenId}</dd>
    {/if}
    {#if entry.ip}
      <dt class="font-medium">{t('admin.logs.entry.ip')}</dt>
      <dd class="font-mono text-sm">{entry.ip}</dd>
    {/if}
    {#if entry.requestId}
      <dt class="font-medium">{t('admin.logs.entry.requestId')}</dt>
      <dd class="font-mono text-sm">{entry.requestId}</dd>
    {/if}
  </dl>

  {#each [['query', entry.query], ['body', entry.body], ['payload', entry.payload]] as const as [key, value] (key)}
    {#if value !== null && value !== undefined}
      <section aria-labelledby={`entry-${key}`} class="flex flex-col gap-2">
        <h2 id={`entry-${key}`} class="text-lg font-semibold">{t(`admin.logs.entry.${key}`)}</h2>
        {#if key === 'body'}
          <p class="text-sm opacity-80">
            {t(
              entry.truncated ? 'admin.logs.entry.bodyTruncated' : 'admin.logs.entry.bodyRedacted',
            )}
          </p>
        {/if}
        <!-- A long body scrolls sideways; a keyboard user must be able to reach it to scroll. -->
        <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
        <pre
          class="bg-base-200 overflow-x-auto rounded-box p-4 text-sm"
          role="region"
          tabindex="0"
          aria-labelledby={`entry-${key}`}>{json(value)}</pre>
      </section>
    {/if}
  {/each}

  <div><a class="btn" href={href('/admin/logs')}>{t('admin.logs.entry.back')}</a></div>
</div>
