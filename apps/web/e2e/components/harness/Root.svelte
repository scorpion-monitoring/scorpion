<script lang="ts">
  // A stand-in for the layout of the web app: it gives the scene the same context (`getShell()`) and shows the
  // toasts, with a translator over the texts of the components and of the scenes.
  import {
    createToaster,
    createTranslator,
    mergeBundles,
    setShell,
    Toasts,
    uiKitMessages,
  } from '@scorpion/ui-kit';
  import type { Component } from 'svelte';
  import { harnessMessages } from './messages.ts';

  let { scene, name, locale }: { scene: Component | undefined; name: string; locale: string } =
    $props();

  // svelte-ignore state_referenced_locally
  const translate = createTranslator(mergeBundles([uiKitMessages, harnessMessages]), locale);
  const toaster = createToaster({ durationMs: 3000 });
  // eslint-disable-next-line svelte/prefer-svelte-reactivity -- read only when the page is left
  const guards = new Set<() => boolean>();

  // For the specs: whether any component asks to be asked before the page is left.
  (window as unknown as { __wantsConfirm: () => boolean }).__wantsConfirm = () =>
    [...guards].some((isDirty) => isDirty());

  setShell({
    href: (path) => path,
    t: (key, params) => translate(key, params),
    api: {} as never,
    session: () => null,
    navigation: () => ({ nav: [], routes: [], widgets: [], themes: [] }),
    branding: () => ({
      productName: 'Scorpion',
      instanceName: 'Scorpion',
      contactEmail: null,
      imprintUrl: null,
      logos: { light: null, dark: null },
      legalPages: [],
    }),
    locale: () => locale,
    localPath: (candidate) =>
      typeof candidate === 'string' && candidate.startsWith('/') ? candidate : null,
    refresh: () => Promise.resolve(),
    goto: (address) => {
      history.replaceState(null, '', address);
      return Promise.resolve();
    },
    replaceUrl: (address) => history.replaceState(null, '', address),
    withReauth: (action) => action(),
    takeIntent: () => undefined,
    toaster,
    guardLeave: (isDirty) => {
      guards.add(isDirty);
      return () => void guards.delete(isDirty);
    },
  });

  // The page a real app has: one `main` landmark, so the checks see what they see there.
  const Scene = $derived(scene);
</script>

<main id="main" class="mx-auto max-w-4xl p-6" data-scene={name}>
  {#if Scene}
    <Scene />
  {:else}
    <p>Unknown scene.</p>
  {/if}
</main>
<Toasts {toaster} />
