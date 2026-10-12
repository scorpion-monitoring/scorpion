<script lang="ts">
  // The buttons of one row of a membership list, drawn from `allowedActions` of the API (never from the role),
  // or, when there are none, the sentence that says why. Reject and remove ask first. Shared by the manager
  // section of the profile page and the administrator's list: the same row, the same answers. The server
  // checks every action again; a 403 or a 409 from a stale page is shown in words and the list reloads.
  import { ApiError, unwrap } from '@scorpion/contracts/client';
  import { ConfirmDialog, failureMessage, failureOf, getShell } from '@scorpion/ui-kit';
  import type { ManagedRow } from './loaders.ts';
  import { rowNote, type RowAction } from './membership-rows.ts';

  let {
    row,
    onchanged,
  }: {
    row: ManagedRow;
    /** Called after the server took the action, with the row as it is now. The page reloads its lists. */
    onchanged: (row: ManagedRow, action: RowAction) => void | Promise<void>;
  } = $props();
  const { t, api, session, toaster, refresh } = getShell();

  let busy = $state(false);
  let asking = $state<'reject' | 'remove'>();
  let failed = $state<string>();

  const name = $derived(row.username ?? t('membership.unknownPerson'));
  const note = $derived(rowNote(row, session()?.user.id));

  const call = (action: RowAction) => {
    const path = { id: row.id };
    switch (action) {
      case 'approve':
      case 'reject':
        return api.POST('/memberships/{id}/decision', {
          params: { path },
          body: { decision: action === 'approve' ? 'approved' : 'rejected' },
        });
      case 'promote':
      case 'demote':
        return api.POST('/memberships/{id}/role', {
          params: { path },
          body: { role: action === 'promote' ? 'manager' : 'member' },
        });
      case 'remove':
        return api.POST('/memberships/{id}/remove', { params: { path } });
    }
  };

  async function take(action: RowAction) {
    busy = true;
    failed = undefined;
    try {
      const updated = await unwrap(call(action));
      toaster.success(t(`membership.done.${action}`, { name }));
      await onchanged(updated, action);
    } catch (error) {
      const type = error instanceof ApiError ? (error.type ?? '') : '';
      failed = failureMessage(failureOf(error), t, {
        403: t('membership.error.forbidden'),
        404: t('membership.error.gone'),
        409: type.endsWith('too-many-managers')
          ? t('membership.error.tooManyManagers')
          : t('membership.error.state'),
      });
      // The page was out of date: show the rows as they are now.
      if (error instanceof ApiError && [403, 404, 409].includes(error.status)) await refresh();
    } finally {
      busy = false;
      asking = undefined;
    }
  }

  const label = (action: RowAction) => t(`membership.aria.${action}`, { name });
</script>

<div class="flex flex-wrap items-center gap-2">
  {#each row.allowedActions as action (action)}
    <button
      type="button"
      class="btn btn-xs {action === 'approve' ? 'btn-primary' : ''}"
      disabled={busy}
      aria-label={label(action)}
      onclick={() =>
        action === 'reject' || action === 'remove' ? (asking = action) : take(action)}
    >
      {t(`membership.action.${action}`)}
    </button>
  {/each}
  {#if note}<span class="text-sm opacity-70">{t(note)}</span>{/if}
</div>
{#if failed}<p class="text-error mt-1 text-sm" role="alert">{failed}</p>{/if}

<ConfirmDialog
  open={asking !== undefined}
  title={t(`membership.confirm.${asking ?? 'reject'}.title`, { name })}
  message={t(`membership.confirm.${asking ?? 'reject'}.message`)}
  confirmLabel={t(`membership.action.${asking ?? 'reject'}`)}
  {busy}
  onconfirm={() => asking && take(asking)}
  oncancel={() => (asking = undefined)}
/>
