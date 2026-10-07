<script lang="ts">
  // Administration, one account: who it is, its roles (add and remove, the last Admin stays), its access
  // tokens (revoke by id), its sessions (end them all) and closing it (deactivate). Each action says what
  // happened in a toast, or why it did not.
  import {
    Alert,
    Breadcrumb,
    ConfirmDialog,
    failureMessage,
    failureOf,
    getShell,
    Time,
  } from '@scorpion/ui-kit';
  import { unwrap } from '@scorpion/contracts/client';
  import type { UserDetailData, UserToken } from './loaders.ts';

  let { data }: { data: UserDetailData } = $props();
  const { t, href, api, refresh, toaster, withReauth } = getShell();

  /** One thing is being asked about at a time. */
  type Asking =
    | { kind: 'removeRole'; role: string }
    | { kind: 'revokeToken'; token: UserToken }
    | { kind: 'endSessions' }
    | { kind: 'deactivate' };
  let asking = $state<Asking>();
  let busy = $state(false);
  let failed = $state<string>();
  let roleToAdd = $state('');

  const held = $derived(new Set(data.roles ?? []));
  const addable = $derived((data.allRoles ?? []).filter((role) => !held.has(role.key)));
  $effect(() => {
    if (!addable.some((role) => role.key === roleToAdd)) roleToAdd = addable[0]?.key ?? '';
  });
  const labelOf = (key: string) => data.allRoles?.find((role) => role.key === key)?.label ?? key;
  const id = $derived(data.user.id);
  const name = $derived(data.user.username);

  /** Runs one action: reports success in a toast, and a failure with the words of this action. */
  async function act(
    action: () => Promise<unknown>,
    done: string | (() => string),
    known: Partial<Record<number, string>> = {},
  ) {
    busy = true;
    failed = undefined;
    try {
      const result = await withReauth(() => action());
      toaster.success(typeof done === 'function' ? done() : done);
      void result;
      await refresh();
    } catch (error) {
      const failure = failureOf(error);
      failed = failureMessage(failure, t, known);
      if (failure.status === 404) await refresh();
    } finally {
      busy = false;
      asking = undefined;
    }
  }

  const addRole = () =>
    act(
      () =>
        unwrap(
          api.POST('/users/{id}/roles', { params: { path: { id } }, body: { role: roleToAdd } }),
        ),
      t('admin.user.roles.added', { name, role: labelOf(roleToAdd) }),
      { 403: t('admin.user.roles.forbidden') },
    );
  const removeRole = (role: string) =>
    act(
      () => unwrap(api.DELETE('/users/{id}/roles/{role}', { params: { path: { id, role } } })),
      t('admin.user.roles.removed', { name, role: labelOf(role) }),
      { 403: t('admin.user.roles.forbidden'), 409: t('admin.user.roles.lastAdmin') },
    );
  const revokeToken = (token: UserToken) =>
    act(
      () => unwrap(api.DELETE('/tokens/{id}', { params: { path: { id: token.id } } })),
      t('admin.user.tokens.revoked', { name: token.name }),
    );
  const endSessions = () => {
    let count = 0;
    return act(
      async () => {
        count = (
          await unwrap(api.POST('/users/{id}/sessions/revoke', { params: { path: { id } } }))
        ).revoked;
      },
      () => t('admin.user.sessions.ended', { count }),
    );
  };
  const deactivate = () =>
    act(
      () => unwrap(api.POST('/users/{id}/deactivate', { params: { path: { id } } })),
      t('admin.user.deactivate.done', { name }),
      {
        403: t('admin.user.deactivate.own'),
        409: t('admin.user.deactivate.refused'),
      },
    );

  const confirm = $derived.by(() => {
    if (!asking) return undefined;
    switch (asking.kind) {
      case 'removeRole': {
        const role = asking.role;
        return {
          title: t('admin.user.roles.removeTitle'),
          message: t('admin.user.roles.removeMessage', { name, role: labelOf(role) }),
          label: t('admin.user.roles.remove'),
          run: () => removeRole(role),
        };
      }
      case 'revokeToken': {
        const token = asking.token;
        return {
          title: t('admin.user.tokens.revokeTitle'),
          message: t('admin.user.tokens.revokeMessage', { token: token.name, name }),
          label: t('admin.user.tokens.revoke'),
          run: () => revokeToken(token),
        };
      }
      case 'endSessions':
        return {
          title: t('admin.user.sessions.confirmTitle'),
          message: t('admin.user.sessions.confirmMessage', { name }),
          label: t('admin.user.sessions.confirm'),
          run: endSessions,
        };
      default:
        return {
          title: t('admin.user.deactivate.confirmTitle'),
          message: t('admin.user.deactivate.confirmMessage', { name }),
          label: t('admin.user.deactivate.confirm'),
          run: deactivate,
        };
    }
  });
</script>

<svelte:head><title>{name} · {t('admin.users.title')}</title></svelte:head>

<div class="mx-auto flex max-w-4xl flex-col gap-6">
  <Breadcrumb
    items={[
      { label: t('nav.section.admin') },
      { label: t('admin.users.title'), href: href('/admin/users') },
      { label: name },
    ]}
  />
  <h1 class="text-2xl font-bold">{name}</h1>

  {#if failed}<Alert kind="error">{failed}</Alert>{/if}

  <section class="card bg-base-100 border-base-300 border" aria-labelledby="account-title">
    <div class="card-body gap-2">
      <h2 id="account-title" class="card-title">{t('admin.user.account')}</h2>
      <dl class="grid grid-cols-[max-content_1fr] gap-x-6 gap-y-1">
        <dt class="font-medium">{t('admin.users.status')}</dt>
        <dd>
          <span
            class="badge"
            class:badge-success={data.user.status === 'active'}
            class:badge-warning={data.user.status === 'pending'}
            class:badge-error={data.user.status === 'rejected' ||
              data.user.status === 'deactivated'}
          >
            {t(`admin.users.status.${data.user.status}`)}
          </span>
        </dd>
        <dt class="font-medium">{t('admin.users.email')}</dt>
        <dd>
          {data.user.email ?? t('admin.users.noEmail')}
          {#if data.user.email && !data.user.emailVerified}
            <span class="badge badge-ghost ms-1">{t('admin.users.unverified')}</span>
          {/if}
        </dd>
        {#if data.user.displayName}
          <dt class="font-medium">{t('admin.user.displayName')}</dt>
          <dd>{data.user.displayName}</dd>
        {/if}
        <dt class="font-medium">{t('admin.users.created')}</dt>
        <dd><Time iso={data.user.createdAt} /></dd>
      </dl>
    </div>
  </section>

  {#if data.roles}
    <section class="card bg-base-100 border-base-300 border" aria-labelledby="roles-title">
      <div class="card-body gap-4">
        <h2 id="roles-title" class="card-title">{t('admin.user.roles.title')}</h2>
        {#if data.roles.length === 0}
          <p>{t('admin.user.roles.none')}</p>
        {:else}
          <ul class="flex flex-col gap-2">
            {#each data.roles as role (role)}
              <li class="flex items-center justify-between gap-3">
                <span class="badge badge-lg">{labelOf(role)}</span>
                <button
                  type="button"
                  class="btn btn-ghost btn-xs"
                  disabled={busy}
                  aria-label={t('admin.user.roles.removeNamed', { role: labelOf(role) })}
                  onclick={() => (asking = { kind: 'removeRole', role })}
                >
                  {t('admin.user.roles.remove')}
                </button>
              </li>
            {/each}
          </ul>
        {/if}
        {#if data.allRoles}
          <form
            class="flex flex-wrap items-end gap-2"
            onsubmit={(event) => {
              event.preventDefault();
              void addRole();
            }}
          >
            <div class="flex flex-col gap-1">
              <label class="text-sm font-medium" for="role-add">{t('admin.user.roles.add')}</label>
              <select
                id="role-add"
                class="select select-bordered"
                bind:value={roleToAdd}
                disabled={addable.length === 0}
              >
                {#each addable as role (role.key)}<option value={role.key}>{role.label}</option
                  >{/each}
              </select>
            </div>
            <button type="submit" class="btn btn-primary" disabled={busy || roleToAdd === ''}>
              {t('admin.user.roles.addButton')}
            </button>
          </form>
        {/if}
      </div>
    </section>
  {/if}

  {#if data.tokens}
    <section class="card bg-base-100 border-base-300 border" aria-labelledby="tokens-title">
      <div class="card-body gap-4">
        <h2 id="tokens-title" class="card-title">{t('admin.user.tokens.title')}</h2>
        {#if data.tokens.length === 0}
          <p>{t('admin.user.tokens.none')}</p>
        {:else}
          <div class="overflow-x-auto">
            <table class="table">
              <caption class="sr-only">{t('admin.user.tokens.title')}</caption>
              <thead class="text-base-content">
                <tr>
                  <th scope="col">{t('admin.user.tokens.name')}</th>
                  <th scope="col">{t('admin.user.tokens.prefix')}</th>
                  <th scope="col">{t('admin.user.tokens.scopes')}</th>
                  <th scope="col">{t('admin.user.tokens.expires')}</th>
                  <th scope="col">{t('admin.user.tokens.lastUsed')}</th>
                  <th scope="col"><span class="sr-only">{t('admin.users.actions')}</span></th>
                </tr>
              </thead>
              <tbody>
                {#each data.tokens as token (token.id)}
                  <tr>
                    <th scope="row">{token.name}</th>
                    <td><code>{token.prefix}</code></td>
                    <td class="max-w-xs break-all">{token.scopes.join(', ')}</td>
                    <td>
                      {#if token.expiresAt}<Time iso={token.expiresAt} />{:else}{t(
                          'admin.user.tokens.never',
                        )}{/if}
                    </td>
                    <td>
                      {#if token.lastUsedAt}<Time iso={token.lastUsedAt} />{:else}{t(
                          'admin.user.tokens.unused',
                        )}{/if}
                    </td>
                    <td>
                      <button
                        type="button"
                        class="btn btn-ghost btn-xs"
                        disabled={busy}
                        aria-label={t('admin.user.tokens.revokeNamed', { name: token.name })}
                        onclick={() => (asking = { kind: 'revokeToken', token })}
                      >
                        {t('admin.user.tokens.revoke')}
                      </button>
                    </td>
                  </tr>
                {/each}
              </tbody>
            </table>
          </div>
        {/if}
      </div>
    </section>
  {/if}

  <section class="card bg-base-100 border-base-300 border" aria-labelledby="sessions-title">
    <div class="card-body gap-3">
      <h2 id="sessions-title" class="card-title">{t('admin.user.sessions.title')}</h2>
      <p>{t('admin.user.sessions.lead')}</p>
      <div class="card-actions">
        <button
          type="button"
          class="btn btn-outline btn-sm"
          disabled={busy}
          onclick={() => (asking = { kind: 'endSessions' })}
        >
          {t('admin.user.sessions.button')}
        </button>
      </div>
    </div>
  </section>

  {#if data.user.status === 'active'}
    <section class="card bg-base-100 border-error border" aria-labelledby="deactivate-title">
      <div class="card-body gap-3">
        <h2 id="deactivate-title" class="card-title">{t('admin.user.deactivate.title')}</h2>
        <p>{t('admin.user.deactivate.lead')}</p>
        <div class="card-actions">
          <button
            type="button"
            class="btn btn-error btn-outline btn-sm"
            disabled={busy}
            onclick={() => (asking = { kind: 'deactivate' })}
          >
            {t('admin.user.deactivate.button')}
          </button>
        </div>
      </div>
    </section>
  {/if}
</div>

<ConfirmDialog
  open={confirm !== undefined}
  title={confirm?.title ?? ''}
  message={confirm?.message ?? ''}
  confirmLabel={confirm?.label ?? ''}
  {busy}
  onconfirm={() => void confirm?.run()}
  oncancel={() => (asking = undefined)}
/>
