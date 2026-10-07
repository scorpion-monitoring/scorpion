<script lang="ts">
  import '../app.css';
  import { goto, invalidateAll, replaceState } from '$app/navigation';
  import { onMount } from 'svelte';
  import { createApiClient } from '@scorpion/contracts/client';
  import { isLocalPath, url } from '@scorpion/contracts';
  import {
    createReauthController,
    createTranslator,
    mergeBundles,
    ReauthDialog,
    setShell,
    takeReturn,
    uiKitMessages,
    type Intent,
  } from '@scorpion/ui-kit';
  import AccountMenu from '#lib/components/AccountMenu.svelte';
  import Footer from '#lib/components/Footer.svelte';
  import Icon from '#lib/components/Icon.svelte';
  import Sidebar from '#lib/components/Sidebar.svelte';
  import ThemeToggle from '#lib/components/ThemeToggle.svelte';
  import { shellMessages } from '#lib/messages.ts';
  import { uiModules } from '../generated/ui.ts';
  import type { LayoutProps } from './$types';

  let { data, children }: LayoutProps = $props();

  const bundles = mergeBundles([
    shellMessages,
    uiKitMessages,
    ...uiModules.map((module) => module.messages),
  ]);
  // The language follows the page's data, so a changed preference takes effect after `invalidateAll()`.
  const translate = $derived(createTranslator(bundles, data.locale));
  const t = (key: string, params?: Record<string, string | number>) => translate(key, params);
  // `BASE_PATH` is a constant of the process, so reading it once is right.
  // svelte-ignore state_referenced_locally
  const basePath = data.basePath;
  const href = (path: string) => url(basePath, path);
  const api = createApiClient({
    basePath,
    csrfToken: () => data.session?.csrfToken ?? undefined,
  });

  const localPath = (candidate: unknown) => (isLocalPath(basePath, candidate) ? candidate : null);

  // Session storage may be missing (a private window) or throw: the dialog then cannot resume a change
  // after a visit to the provider, and says nothing more about it.
  const storage = () => {
    try {
      return window.sessionStorage;
    } catch {
      return undefined;
    }
  };

  const reauth = createReauthController({
    api,
    get storage() {
      return storage();
    },
    path: () => `${window.location.pathname}${window.location.search}`,
    navigate: (address) => window.location.assign(address),
  });

  // What the person asked for before they left for the provider: kept here until the page asks for it.
  let returnedIntent: Intent | undefined;

  setShell({
    href,
    t,
    api,
    session: () => data.session,
    navigation: () => data.navigation,
    branding: () => data.branding,
    locale: () => data.locale,
    localPath,
    refresh: () => invalidateAll(),
    goto: (address, options) => goto(address, { replaceState: options?.replace }),
    replaceUrl: (address) => replaceState(address, {}),
    withReauth: (action, intent) => reauth.run(action, intent),
    takeIntent: (id) => {
      if (returnedIntent?.id !== id) return undefined;
      const { payload } = returnedIntent;
      returnedIntent = undefined;
      return { payload };
    },
  });

  // The provider's callback ends at the start page with no return path. When this load is that return,
  // the page that asked for the change is opened again and finds its intent waiting.
  onMount(() => {
    const returned = takeReturn(storage(), localPath);
    if (!returned || !data.session) return;
    returnedIntent = returned.intent;
    void goto(returned.path, { replaceState: true });
  });

  let menuOpen = $state(false);
  let collapsed = $state(false);
  const RAIL_KEY = 'scorpion.sidebar';
  $effect(() => {
    try {
      collapsed = window.localStorage.getItem(RAIL_KEY) === 'rail';
    } catch {
      // No storage: the sidebar starts open.
    }
  });
  function toggleRail() {
    collapsed = !collapsed;
    try {
      window.localStorage.setItem(RAIL_KEY, collapsed ? 'rail' : 'wide');
    } catch {
      // Not stored; the choice holds for this page only.
    }
  }

  const brand = $derived(data.branding);
</script>

<svelte:head>
  <title>{brand.instanceName}</title>
</svelte:head>

<a
  href="#main"
  class="btn btn-primary sr-only focus:not-sr-only focus:fixed focus:start-2 focus:top-2 focus:z-50"
>
  {t('app.skipToContent')}
</a>

<div class="flex min-h-screen">
  {#if !data.bootstrap}
    <Sidebar {collapsed} open={menuOpen} onclose={() => (menuOpen = false)} ontoggle={toggleRail} />
  {/if}
  <div class="flex min-w-0 flex-1 flex-col">
    <header
      class="bg-base-100 border-base-300 sticky top-0 z-10 flex items-center gap-3 border-b px-4 py-2"
    >
      <button
        type="button"
        class="btn btn-ghost btn-sm lg:hidden"
        class:hidden={data.bootstrap}
        aria-label={t('app.menu.open')}
        aria-expanded={menuOpen}
        aria-controls="sidebar"
        onclick={() => (menuOpen = true)}
      >
        <Icon name="menu" />
      </button>
      <a href={href('/')} class="flex items-center gap-2 text-lg font-bold">
        {#if brand.logos.light}
          <img
            class="logo-light h-8 w-auto"
            src={href(`/api/internal/files/${brand.logos.light}`)}
            alt=""
          />
        {/if}
        {#if brand.logos.dark ?? brand.logos.light}
          <img
            class="logo-dark h-8 w-auto"
            src={href(`/api/internal/files/${brand.logos.dark ?? brand.logos.light}`)}
            alt=""
          />
        {/if}
        <span>{brand.instanceName}</span>
      </a>
      <div class="flex-1"></div>
      {#if !data.bootstrap}
        <ThemeToggle />
        <AccountMenu />
      {/if}
    </header>
    <main id="main" tabindex="-1" class="mx-auto w-full max-w-6xl flex-1 p-4 sm:p-6">
      {@render children()}
    </main>
    <Footer branding={brand} />
  </div>
</div>

<ReauthDialog controller={reauth} />
