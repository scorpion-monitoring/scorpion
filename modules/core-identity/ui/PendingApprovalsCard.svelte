<script lang="ts">
  // A card of the dashboard for whoever may review registrations: how many accounts wait, with a link to the page
  // that approves or rejects them. The number is read through the route of that page, so the card shows what the
  // page would, to the same people.
  import { onMount } from 'svelte';
  import { getShell } from '@scorpion/ui-kit';
  import { unwrap } from '@scorpion/contracts/client';

  const { t, href, api } = getShell();
  const titleId = $props.id();
  let waiting = $state<number>();
  let failed = $state(false);

  onMount(async () => {
    try {
      const answer = await unwrap(
        api.GET('/users/pending', { params: { query: { pageSize: '1' } } }),
      );
      waiting = answer.metadata.totalCount;
    } catch {
      failed = true;
    }
  });
</script>

<section class="card bg-base-100 border-base-300 border" aria-labelledby={titleId}>
  <div class="card-body gap-2">
    <h2 id={titleId} class="card-title text-base">{t('dash.pending.title')}</h2>
    {#if failed}
      <p class="text-error text-sm" role="alert">{t('dash.pending.failed')}</p>
    {:else if waiting === undefined}
      <p class="text-sm">{t('dash.pending.loading')}</p>
    {:else}
      <p class="text-3xl font-bold">{waiting}</p>
      <p class="text-sm">
        {waiting === 0 ? t('dash.pending.none') : t('dash.pending.some', { count: waiting })}
      </p>
      <div class="card-actions">
        <a class="link text-sm" href={href('/admin/users/pending')}>{t('dash.pending.link')}</a>
      </div>
    {/if}
  </div>
</section>
