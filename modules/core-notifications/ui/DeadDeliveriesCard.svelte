<script lang="ts">
  // A card of the dashboard for an administrator: how many mails ran out of attempts, with a link to the
  // delivery list filtered to them. It reads the counts through the status route and shows a failure as such.
  import { onMount } from 'svelte';
  import { getShell } from '@scorpion/ui-kit';
  import { unwrap } from '@scorpion/contracts/client';

  const { t, href, api } = getShell();
  const titleId = $props.id();
  let dead = $state<number>();
  let none = $state(false);
  let failed = $state(false);

  onMount(async () => {
    try {
      const status = await unwrap(api.GET('/notifications/status'));
      dead = status.counts.dead;
      none = status.transportIsNone;
    } catch {
      failed = true;
    }
  });
</script>

<section class="card bg-base-100 border-base-300 border" aria-labelledby={titleId}>
  <div class="card-body gap-2">
    <h2 id={titleId} class="card-title text-base">{t('dash.dead.title')}</h2>
    {#if failed}
      <p class="text-error text-sm" role="alert">{t('dash.loadFailed')}</p>
    {:else if dead === undefined}
      <p class="text-sm">{t('dash.loading')}</p>
    {:else}
      <p class="text-3xl font-bold" class:text-error={dead > 0}>{dead}</p>
      <p class="text-sm">
        {dead === 0 ? t('dash.dead.none') : t('dash.dead.some', { count: dead })}
      </p>
      {#if none}<p class="text-sm">{t('dash.dead.transportNone')}</p>{/if}
      <div class="card-actions">
        <a
          class="link text-sm"
          href={href(dead > 0 ? '/admin/notifications?status=dead' : '/admin/notifications')}
        >
          {t('dash.dead.link')}
        </a>
      </div>
    {/if}
  </div>
</section>
