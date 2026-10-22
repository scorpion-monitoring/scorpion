<script lang="ts">
  // The quick actions (FEATURES §3.8): Report data (the Data Submission page), Services, Notification preferences, and the dashboard defaults.
  // A link is shown only for a page the person may open (the navigation lists those), so there is no dead link, and every address is built
  // with the base path by `href()`. It has no settings and ignores the props a tile receives.
  import { DashboardDefaults, getShell } from '@scorpion/ui-kit';
  import { RANGES } from '../service/widget-limits.ts';

  const { t, href, navigation } = getShell();
  const titleId = $props.id();
  let showDefaults = $state(false);

  const links = [
    { path: '/submit', label: 'analytics.actions.report' },
    { path: '/services', label: 'analytics.actions.services' },
    { path: '/profile/notifications', label: 'analytics.actions.notifications' },
  ];
  const open = $derived(links.filter((link) => navigation().routes.includes(link.path)));
</script>

<section class="card bg-base-100 border-base-300 h-full min-h-0 border" aria-labelledby={titleId}>
  <div class="card-body min-h-0 gap-3 overflow-y-auto p-4">
    <h2 id={titleId} class="card-title text-base">{t('analytics.actions.title')}</h2>
    <ul class="flex flex-col gap-2">
      {#each open as link (link.path)}
        <li>
          <a class="btn btn-outline btn-sm w-full justify-start" href={href(link.path)}
            >{t(link.label)}</a
          >
        </li>
      {/each}
      <li>
        <button
          type="button"
          class="btn btn-outline btn-sm w-full justify-start"
          onclick={() => (showDefaults = true)}
        >
          {t('analytics.actions.defaults')}
        </button>
      </li>
    </ul>
  </div>
</section>

{#if showDefaults}
  <DashboardDefaults ranges={RANGES} onclose={() => (showDefaults = false)} />
{/if}
