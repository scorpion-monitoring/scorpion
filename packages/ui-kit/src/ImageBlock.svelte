<script lang="ts">
  // One image of one record (an organisation's logo, a service's icon): shows the stored file, uploads a
  // new one, replaces it and removes it. The block knows nothing about the record: the calls it makes
  // (`upload`, `remove`) and every text come from the caller, so the module that owns the image decides
  // which route is called and what the words are. What the person may do is decided by the server; a 403,
  // a 413 and a 422 are shown in the words the caller gave. The server checks, re-encodes and stores the
  // file; the block shows what the server answered, not the file the person picked.
  import Alert from './Alert.svelte';
  import { failureMessage, failureOf } from './forms.ts';
  import { getShell } from './context.ts';
  import type { ImageBlockTexts } from './image-block.ts';

  let {
    imageUrl,
    editable = true,
    maxBytes,
    texts,
    upload,
    remove,
    onchanged,
  }: {
    /** The image as the page was given it. */
    imageUrl?: string | undefined;
    editable?: boolean;
    /** The largest file the page lets a person pick. The server's ceiling decides (413); this saves a long upload. */
    maxBytes: number;
    texts: ImageBlockTexts;
    /** Sends the file and returns the URL the server stored it under (absent when it answered none). */
    upload: (file: File) => Promise<string | undefined>;
    remove: () => Promise<void>;
    /** Called with the new URL (absent after a removal). */
    onchanged?: (url: string | undefined) => void;
  } = $props();
  const { t, toaster } = getShell();

  const id = $props.id();
  let busy = $state(false);
  let failed = $state<string>();
  let input = $state<HTMLInputElement>();
  // The image shown: what the server said last, else what the page was given.
  let current = $state<string | undefined>();
  const image = $derived(current ?? imageUrl);
  let removed = $state(false);
  const shown = $derived(removed ? undefined : image);

  const words = (error: unknown) =>
    failureMessage(failureOf(error), t, {
      413: texts.tooBig,
      422: texts.invalid,
      403: texts.forbidden,
    });

  async function onpick(event: Event) {
    const file = (event.currentTarget as HTMLInputElement).files?.[0];
    failed = undefined;
    if (!file) return;
    if (file.size > maxBytes) {
      failed = texts.tooBig;
      if (input) input.value = '';
      return;
    }
    busy = true;
    try {
      const saved = await upload(file);
      current = saved;
      removed = false;
      toaster.success(texts.saved);
      onchanged?.(saved);
    } catch (error) {
      failed = words(error);
    } finally {
      busy = false;
      if (input) input.value = '';
    }
  }

  async function onremove() {
    failed = undefined;
    busy = true;
    try {
      await remove();
      current = undefined;
      removed = true;
      toaster.success(texts.removed);
      onchanged?.(undefined);
    } catch (error) {
      failed = words(error);
    } finally {
      busy = false;
    }
  }
</script>

<section class="card bg-base-100 border-base-300 border" aria-labelledby="{id}-title">
  <div class="card-body gap-3">
    <h2 id="{id}-title" class="card-title">{texts.title}</h2>
    {#if shown}
      <img
        class="bg-base-200 h-20 w-auto max-w-xs self-start rounded p-2"
        src={shown}
        alt={texts.alt}
      />
    {:else}
      <p class="opacity-70">{texts.none}</p>
    {/if}
    {#if failed}<Alert kind="error">{failed}</Alert>{/if}
    {#if editable}
      <div class="flex flex-col gap-1">
        <label class="text-sm font-medium" for="{id}-file">{texts.choose}</label>
        <input
          id="{id}-file"
          bind:this={input}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml"
          class="file-input file-input-bordered"
          disabled={busy}
          aria-describedby="{id}-hint"
          onchange={onpick}
        />
        <p id="{id}-hint" class="text-sm opacity-70">{texts.hint}</p>
      </div>
      {#if shown}
        <div class="card-actions">
          <button type="button" class="btn btn-ghost btn-sm" disabled={busy} onclick={onremove}>
            {texts.remove}
          </button>
        </div>
      {/if}
    {/if}
  </div>
</section>
