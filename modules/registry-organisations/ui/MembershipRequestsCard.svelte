<script lang="ts">
  // A card of the dashboard: how many membership requests wait for a decision of this caller, with a link to the
  // page where they are decided (administrators: the list of all requests; managers: their own page). Drawn only
  // when there is something to decide, so a plain User never sees a card or an error from it; a failed load
  // draws nothing rather than a card that says nothing useful.
  import { onMount } from 'svelte';
  import { getShell } from '@scorpion/ui-kit';
  import { unwrap } from '@scorpion/contracts/client';

  const { t, href, api, navigation } = getShell();
  const titleId = $props.id();
  let pending = $state(0);

  // The navigation is what the server says this caller may open, so the link needs no role.
  const target = $derived(
    navigation().nav.some((entry) => entry.path === '/admin/memberships')
      ? '/admin/memberships'
      : '/account/organisations',
  );

  onMount(async () => {
    try {
      pending = (await unwrap(api.GET('/memberships/summary'))).pending;
    } catch {
      pending = 0;
    }
  });
</script>

{#if pending > 0}
  <section class="card bg-base-100 border-base-300 border" aria-labelledby={titleId}>
    <div class="card-body gap-2">
      <h2 id={titleId} class="card-title text-base">{t('dash.membership.title')}</h2>
      <p class="text-3xl font-bold">{pending}</p>
      <p class="text-sm">{t('dash.membership.some', { count: pending })}</p>
      <div class="card-actions">
        <a class="link text-sm" href={href(target)}>{t('dash.membership.link')}</a>
      </div>
    </div>
  </section>
{/if}
