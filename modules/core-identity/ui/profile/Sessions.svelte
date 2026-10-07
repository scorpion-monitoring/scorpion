<script lang="ts">
  import { onMount } from 'svelte';
  import { Alert, failureOf, getShell, ReauthCancelled, Time } from '@scorpion/ui-kit';
  import { unwrap } from '@scorpion/contracts/client';
  import type { ProfileData } from '../loaders.ts';

  let { sessions }: { sessions: NonNullable<ProfileData['sessions']> } = $props();
  const { t, href, api, refresh, goto, withReauth, takeIntent } = getShell();

  let failed = $state(false);

  async function end(id: string) {
    failed = false;
    try {
      // Ending a session needs a recent authentication (7.5.2); the dialog asks and this runs again.
      await withReauth(
        () => unwrap(api.DELETE('/account/sessions/{id}', { params: { path: { id } } })),
        { id: 'session.end', payload: { id } },
      );
      const wasCurrent = sessions.find((session) => session.id === id)?.current;
      await refresh();
      if (wasCurrent) await goto(href('/login?notice=signed-out'));
    } catch (error) {
      if (error instanceof ReauthCancelled) return;
      // 404: it is already gone (ended elsewhere), so the list is shown as it is now.
      if (failureOf(error).status === 404) await refresh();
      else failed = true;
    }
  }

  async function endAll() {
    failed = false;
    try {
      await withReauth(() => unwrap(api.POST('/auth/logout-all')), { id: 'session.all' });
      await refresh();
      await goto(href('/login?notice=signed-out'));
    } catch (error) {
      if (!(error instanceof ReauthCancelled)) failed = true;
    }
  }

  onMount(() => {
    const one = takeIntent('session.end')?.payload as { id?: string } | undefined;
    if (one?.id) void end(one.id);
    else if (takeIntent('session.all')) void endAll();
  });
</script>

<section class="card bg-base-100 border-base-300 border" aria-labelledby="sessions-title">
  <div class="card-body gap-4">
    <h2 id="sessions-title" class="card-title">{t('profile.sessions.title')}</h2>
    <p>{t('profile.sessions.lead')}</p>
    {#if failed}<Alert kind="error">{t('profile.sessions.failed')}</Alert>{/if}
    <div class="overflow-x-auto">
      <table class="table">
        <caption class="sr-only">{t('profile.sessions.title')}</caption>
        <thead class="text-base-content">
          <tr>
            <th scope="col">{t('profile.sessions.started')}</th>
            <th scope="col">{t('profile.sessions.lastSeen')}</th>
            <th scope="col"><span class="sr-only">{t('profile.sessions.actions')}</span></th>
          </tr>
        </thead>
        <tbody>
          {#each sessions as session (session.id)}
            <tr data-current={session.current}>
              <td>
                <Time iso={session.createdAt} />
                {#if session.current}
                  <span class="badge badge-primary ms-2">{t('profile.sessions.current')}</span>
                {/if}
              </td>
              <td><Time iso={session.lastSeenAt} /></td>
              <td>
                <button type="button" class="btn btn-ghost btn-xs" onclick={() => end(session.id)}>
                  {session.current ? t('profile.sessions.endCurrent') : t('profile.sessions.end')}
                </button>
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
    <div class="card-actions">
      <button type="button" class="btn btn-error btn-outline btn-sm" onclick={endAll}>
        {t('profile.sessions.endAll')}
      </button>
    </div>
  </div>
</section>
