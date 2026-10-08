<script lang="ts">
  // Administration, roles: each role with the permissions it holds, grouped by module. The permissions of
  // every role but Admin can be changed; Admin holds everything and cannot be edited. A change takes effect
  // at once and is recorded in the audit trail. Edits of several roles are kept while the person moves between
  // the tabs, and leaving the page with edits not saved asks first.
  import { onMount } from 'svelte';
  import { Alert, Breadcrumb, failureMessage, failureOf, getShell, Tabs } from '@scorpion/ui-kit';
  import { unwrap } from '@scorpion/contracts/client';
  import { groupPermissions, sameSet, setGroup, togglePermission } from './groups.ts';
  import type { RolesData } from './loaders.ts';

  let { data }: { data: RolesData } = $props();
  const { t, api, refresh, toaster, withReauth, guardLeave } = getShell();

  const groups = $derived(groupPermissions(data.all));
  // The edits not saved yet, by role key. A role without an entry is as it was saved.
  let drafts = $state<Record<string, string[]>>({});
  let selected = $state<string>();
  let busy = $state(false);
  let failed = $state<string>();

  const role = $derived(data.roles.find((entry) => entry.key === selected) ?? data.roles[0]);
  const current = $derived(role ? (drafts[role.key] ?? role.permissions) : []);
  const editable = $derived(role !== undefined && role.key !== 'admin');
  const dirty = $derived(
    data.roles.some(
      (entry) => entry.key in drafts && !sameSet(drafts[entry.key]!, entry.permissions),
    ),
  );

  onMount(() => guardLeave(() => dirty));

  const edit = (next: string[]) => {
    if (role) drafts[role.key] = next;
  };

  async function save() {
    if (!role) return;
    const key = role.key;
    busy = true;
    failed = undefined;
    try {
      const saved = await withReauth(() =>
        unwrap(
          api.PUT('/roles/{key}/permissions', {
            params: { path: { key } },
            body: { permissions: drafts[key] ?? role.permissions },
          }),
        ),
      );
      delete drafts[key];
      toaster.success(t('admin.roles.saved', { role: saved.label }));
      await refresh();
    } catch (error) {
      failed = failureMessage(failureOf(error), t, { 422: t('admin.roles.unknownPermission') });
    } finally {
      busy = false;
    }
  }

  const reset = () => {
    if (role) delete drafts[role.key];
  };
</script>

<svelte:head><title>{t('admin.roles.title')}</title></svelte:head>

<div class="flex flex-col gap-6">
  <Breadcrumb items={[{ label: t('nav.section.admin') }, { label: t('admin.roles.title') }]} />
  <h1 class="text-2xl font-bold">{t('admin.roles.title')}</h1>
  <p>{t('admin.roles.lead')}</p>

  {#if failed}<Alert kind="error">{failed}</Alert>{/if}

  <Tabs
    label={t('admin.roles.tabs')}
    bind:selected
    tabs={data.roles.map((entry) => ({
      id: entry.key,
      label:
        entry.key in drafts && !sameSet(drafts[entry.key]!, entry.permissions)
          ? t('admin.roles.edited', { role: entry.label })
          : entry.label,
    }))}
  >
    {#if role}
      <div class="flex flex-col gap-4">
        {#if !editable}
          <Alert kind="info">{t('admin.roles.adminFixed')}</Alert>
        {:else}
          <p>{t('admin.roles.count', { count: current.length })}</p>
        {/if}
        <form
          class="flex flex-col gap-4"
          onsubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          {#each groups as group (group.module)}
            {@const ids = group.permissions.map((permission) => permission.id)}
            {@const inGroup = ids.filter((id) => current.includes(id)).length}
            <fieldset class="border-base-300 rounded-box border p-4">
              <legend class="px-1 font-semibold">{group.module}</legend>
              {#if editable}
                <div class="mb-2 flex gap-2">
                  <button
                    type="button"
                    class="btn btn-ghost btn-xs"
                    disabled={inGroup === ids.length}
                    onclick={() => edit(setGroup(current, ids, true))}
                  >
                    {t('admin.roles.selectAll', { module: group.module })}
                  </button>
                  <button
                    type="button"
                    class="btn btn-ghost btn-xs"
                    disabled={inGroup === 0}
                    onclick={() => edit(setGroup(current, ids, false))}
                  >
                    {t('admin.roles.selectNone', { module: group.module })}
                  </button>
                </div>
              {/if}
              <ul class="grid gap-1 sm:grid-cols-2">
                {#each group.permissions as permission (permission.id)}
                  <li>
                    <label class="flex items-start gap-2">
                      <input
                        type="checkbox"
                        class="checkbox checkbox-sm mt-1"
                        checked={current.includes(permission.id)}
                        disabled={!editable || busy}
                        onchange={(event) =>
                          edit(
                            togglePermission(current, permission.id, event.currentTarget.checked),
                          )}
                      />
                      <span class="flex flex-col">
                        <code class="text-sm break-all">{permission.id}</code>
                        <span class="text-sm opacity-80">{permission.description}</span>
                      </span>
                    </label>
                  </li>
                {/each}
              </ul>
            </fieldset>
          {/each}
          {#if editable}
            <div class="flex gap-2">
              <button
                type="submit"
                class="btn btn-primary"
                disabled={busy || !(role.key in drafts)}
              >
                {t('admin.roles.save')}
              </button>
              <button
                type="button"
                class="btn"
                disabled={busy || !(role.key in drafts)}
                onclick={reset}
              >
                {t('admin.roles.reset')}
              </button>
            </div>
          {/if}
        </form>
      </div>
    {/if}
  </Tabs>
</div>
