<script lang="ts">
  // A card of the dashboard about membership requests. It always says something useful, so the tile is never blank:
  // - a person who decides on requests (an administrator, or a manager of an organisation) sees how many wait for them,
  //   or that none do, with a link to the page where they are decided (administrators: the list of all requests;
  //   managers: their own page);
  // - everyone sees their own side: requests of theirs that wait for a decision, else the organisations they belong to,
  //   else an invitation to find theirs (Profile, Organisations).
  // A failed read says so and offers a retry. The navigation is what the server says this caller may open, so the
  // links need no role.
  import { getShell } from '@scorpion/ui-kit';
  import { unwrap } from '@scorpion/contracts/client';
  import { ownView, type OwnView } from './membership-card.ts';

  const { t, href, api, navigation } = getShell();
  const titleId = $props.id();

  const ACCOUNT = '/account/organisations';
  const isAdmin = $derived(navigation().nav.some((entry) => entry.path === '/admin/memberships'));
  const target = $derived(isAdmin ? '/admin/memberships' : ACCOUNT);

  type State =
    | { kind: 'loading' }
    | { kind: 'failed' }
    | { kind: 'ready'; pending: number; decides: boolean; own: OwnView | undefined };
  let read = $state.raw<State>({ kind: 'loading' });
  let attempt = $state(0);

  $effect(() => {
    void attempt;
    let live = true;
    read = { kind: 'loading' };
    const admin = isAdmin;
    Promise.all([
      unwrap(api.GET('/memberships/summary')),
      // The person's own rows: a role without the right to request membership has none to show, which is not a failure.
      unwrap(
        api.GET('/account/memberships', { params: { query: { page: '0', pageSize: '100' } } }),
      ).then(
        (page) => ownView(page.result),
        () => undefined,
      ),
    ]).then(
      ([summary, own]) => {
        if (live)
          read = {
            kind: 'ready',
            pending: summary.pending,
            decides: admin || summary.manages,
            own,
          };
      },
      () => {
        if (live) read = { kind: 'failed' };
      },
    );
    return () => {
      live = false;
    };
  });
</script>

<section class="card bg-base-100 border-base-300 h-full min-h-0 border" aria-labelledby={titleId}>
  <div class="card-body min-h-0 gap-2 overflow-y-auto p-4">
    <h2 id={titleId} class="card-title text-base">{t('dash.membership.title')}</h2>
    {#if read.kind === 'loading'}
      <p class="text-sm" role="status">{t('dash.membership.loading')}</p>
    {:else if read.kind === 'failed'}
      <div role="alert" class="text-sm">
        {t('dash.membership.failed')}
        <button type="button" class="btn btn-sm ms-2" onclick={() => (attempt += 1)}>
          {t('dash.membership.retry')}
        </button>
      </div>
    {:else}
      {#if read.decides}
        <div>
          <p class="text-3xl font-bold">{read.pending}</p>
          <p class="text-sm">
            {read.pending > 0
              ? t('dash.membership.some', { count: read.pending })
              : t('dash.membership.none')}
          </p>
          <a class="link text-sm" href={href(target)}>
            {read.pending > 0 ? t('dash.membership.link') : t('dash.membership.open')}
          </a>
        </div>
      {/if}
      {#if read.own}
        <div class={read.decides ? 'border-base-300 border-t pt-2' : ''}>
          {#if read.own.waiting > 0}
            <p class="text-sm">
              {t('dash.membership.mine.waiting', { count: read.own.waiting })}
            </p>
            <ul class="text-sm">
              {#each read.own.requested as name (name)}
                <li class="truncate">{name}</li>
              {/each}
            </ul>
          {:else if read.own.member > 0}
            <p class="text-sm">{t('dash.membership.mine.member', { count: read.own.member })}</p>
          {:else}
            <p class="text-sm">{t('dash.membership.mine.none')}</p>
          {/if}
          <a class="link text-sm" href={href(ACCOUNT)}>
            {read.own.waiting === 0 && read.own.member === 0
              ? t('dash.membership.mine.find')
              : t('dash.membership.mine.link')}
          </a>
        </div>
      {:else if !read.decides}
        <p class="text-sm">{t('dash.membership.none')}</p>
      {/if}
    {/if}
  </div>
</section>
