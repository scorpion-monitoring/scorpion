<script lang="ts">
  // The dnd-kit manager of one mount of the grid, with the words of the page in its accessibility plugin. The plugin
  // reads its announcements when it is built and ignores new options afterwards, so the manager is made here, with
  // the plugin already configured, and handed to the provider (which would otherwise build a default one).
  import { Accessibility, DragDropManager, StyleInjector } from '@dnd-kit/dom';
  import { DragDropProvider } from '@dnd-kit/svelte';
  import { onDestroy, type Snippet } from 'svelte';

  let {
    announcements,
    instructions,
    children,
  }: {
    announcements: {
      dragstart: (event: never) => string | undefined;
      dragend: (event: never) => string | undefined;
    };
    instructions: string;
    children: Snippet;
  } = $props();

  // dnd-kit writes a `<style>` element while something is dragged. The page's policy has no 'unsafe-inline' for
  // styles, only the nonce SvelteKit puts on its own tags, so the injector is given that nonce: the one of a
  // script or style tag of this page (`element.nonce` stays readable after the attribute is hidden).
  const nonce = document.querySelector<HTMLElement>('script[nonce], style[nonce]')?.nonce;

  // The manager is built once per mount; a change of language remounts the grid with the mode.
  const manager = new DragDropManager({
    plugins: (defaults) => [
      ...(nonce ? [StyleInjector.configure({ nonce })] : []),
      ...defaults.map((plugin) =>
        plugin === Accessibility
          ? Accessibility.configure({
              announcements: {
                dragstart: (event: never) => announcements.dragstart(event),
                dragend: (event: never) => announcements.dragend(event),
              },
              screenReaderInstructions: { draggable: instructions },
            })
          : plugin,
      ),
    ],
  });
  onDestroy(() => manager.destroy());
</script>

<DragDropProvider {manager}>{@render children()}</DragDropProvider>
