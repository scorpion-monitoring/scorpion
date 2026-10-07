<script lang="ts">
  import { goto, invalidateAll } from '$app/navigation';
  import { getShell } from '@scorpion/ui-kit';
  import Icon from './Icon.svelte';

  const { t, href, api, session } = getShell();
  let open = $state(false);
  let root = $state<HTMLElement>();
  let busy = $state(false);
  let failed = $state(false);
  const who = $derived(session());

  async function logout() {
    busy = true;
    failed = false;
    try {
      const { response } = await api.POST('/auth/logout');
      if (!response.ok) throw new Error('logout failed');
      open = false;
      // The session is gone: ask the server again who this is, then show the public start page.
      await invalidateAll();
      await goto(href('/'));
    } catch {
      failed = true;
    } finally {
      busy = false;
    }
  }

  // A click anywhere else closes the menu (a click inside it is the menu's own business).
  function outside(event: MouseEvent) {
    if (open && root && !root.contains(event.target as Node)) open = false;
  }

  function onkeydown(event: KeyboardEvent) {
    if (event.key === 'Escape' && open) {
      open = false;
      (event.currentTarget as HTMLElement).querySelector('button')?.focus();
    }
  }
</script>

<svelte:window onclick={outside} />

{#if who}
  <div class="relative" bind:this={root} {onkeydown} role="presentation">
    <button
      type="button"
      class="btn btn-ghost btn-sm gap-2"
      aria-haspopup="true"
      aria-expanded={open}
      aria-controls="account-menu"
      aria-label={t('app.account.menu')}
      onclick={() => (open = !open)}
    >
      <Icon name="user" size={18} />
      <span class="hidden sm:inline">{who.user.username}</span>
      <Icon name="chevronDown" size={14} />
    </button>
    {#if open}
      <div
        id="account-menu"
        class="menu bg-base-100 border-base-300 absolute end-0 z-30 mt-2 w-60 rounded-box border p-2 shadow-lg"
      >
        <p class="px-3 py-2 text-sm">{t('app.account.signedInAs', { name: who.user.username })}</p>
        <ul>
          <li>
            <button type="button" onclick={logout} disabled={busy}>
              <Icon name="logout" size={18} />
              {busy ? t('app.account.loggingOut') : t('app.account.logout')}
            </button>
          </li>
        </ul>
        {#if failed}
          <p class="text-error px-3 py-2 text-sm" role="alert">{t('app.account.logoutFailed')}</p>
        {/if}
      </div>
    {/if}
  </div>
{:else}
  <a class="btn btn-primary btn-sm" href={href('/login')}>{t('app.account.signIn')}</a>
{/if}
