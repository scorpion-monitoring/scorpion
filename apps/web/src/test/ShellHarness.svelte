<script lang="ts">
  // A stand-in for the layout, for tests that render a module's page on the server: it gives the page the
  // same context (`getShell()`) with a translator over the texts it is given and a fixed signed-in person.
  // Only what a page reads while it renders is real; the client, the navigation and `goto` are inert.
  import type { Component } from 'svelte';
  import {
    createToaster,
    createTranslator,
    mergeBundles,
    setShell,
    uiKitMessages,
  } from '@scorpion/ui-kit';

  let {
    page: Page,
    data,
    userId,
    messages,
    locale = 'en',
  }: {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    page: Component<{ data: any }>;
    data: unknown;
    userId: string | null;
    messages: Record<string, Record<string, string>>;
    locale?: string;
  } = $props();

  // svelte-ignore state_referenced_locally
  const translate = createTranslator(mergeBundles([uiKitMessages, messages]), locale);

  setShell({
    href: (path) => path,
    t: (key, params) => translate(key, params),
    api: {} as never,
    session: () =>
      userId === null
        ? null
        : ({ user: { id: userId, username: 'viewer' }, roles: [], csrfToken: null } as never),
    navigation: () => ({ nav: [], routes: [], widgets: [], themes: [] }),
    branding: () => ({
      productName: 'Test',
      instanceName: 'Test',
      contactEmail: null,
      imprintUrl: null,
      logos: { light: null, dark: null },
      legalPages: [],
    }),
    locale: () => locale,
    localPath: (candidate) => (typeof candidate === 'string' ? candidate : null),
    refresh: () => Promise.resolve(),
    goto: () => Promise.resolve(),
    replaceUrl: () => {},
    withReauth: (action) => action(),
    takeIntent: () => undefined,
    toaster: createToaster({ durationMs: 3000 }),
    Widgets: (() => {}) as never,
    guardLeave: () => () => {},
  });
</script>

<Page {data} />
