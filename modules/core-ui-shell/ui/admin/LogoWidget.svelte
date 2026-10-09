<script lang="ts">
  // A logo or an icon in a form: shows the stored file, uploads a new one (`POST /files`, which needs
  // `core.blob.manage`) and keeps only its hash in the setting. The server checks and re-encodes the file; the
  // hash it answers with is what is saved when the form is.
  import { failureMessage, failureOf, getShell, type WidgetProps } from '@scorpion/ui-kit';
  import { unwrap } from '@scorpion/contracts/client';

  let { node, value, onchange, errors, disabled }: WidgetProps = $props();
  const { t, href, api } = getShell();

  const hash = $derived(typeof value === 'string' && value !== '' ? value : undefined);
  const id = $props.id();
  let busy = $state(false);
  let failed = $state<string>();
  let input = $state<HTMLInputElement>();

  /** The largest file the page lets a person pick; the server's ceiling decides (8 MB). */
  const MAX_BYTES = 8 * 1024 * 1024;

  async function upload(event: Event) {
    const file = (event.currentTarget as HTMLInputElement).files?.[0];
    failed = undefined;
    if (!file) return;
    if (file.size > MAX_BYTES) {
      failed = t('admin.logo.tooBig', { count: 8 });
      return;
    }
    busy = true;
    try {
      const stored = await unwrap(
        api.POST('/files', {
          body: file as unknown as string,
          bodySerializer: (body: unknown) => body as BodyInit,
          headers: { 'content-type': 'application/octet-stream' },
        }),
      );
      onchange(stored.hash);
    } catch (error) {
      failed = failureMessage(failureOf(error), t, { 413: t('admin.logo.tooBig', { count: 8 }) });
    } finally {
      busy = false;
      if (input) input.value = '';
    }
  }
</script>

<div class="flex flex-col gap-2">
  <label class="text-sm font-medium" for={id}>{node.label}</label>
  {#if hash}
    <img
      class="bg-base-200 h-16 w-auto max-w-xs self-start rounded p-2"
      src={href(`/api/internal/files/${hash}`)}
      alt={t('admin.logo.current', { label: node.label })}
    />
  {:else}
    <p class="text-sm opacity-70">{t('admin.logo.none')}</p>
  {/if}
  <div class="flex flex-wrap items-center gap-2">
    <input
      {id}
      bind:this={input}
      type="file"
      accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml"
      class="file-input file-input-bordered"
      disabled={disabled || busy}
      onchange={upload}
    />
    {#if hash}
      <button
        type="button"
        class="btn btn-ghost btn-sm"
        disabled={disabled || busy}
        onclick={() => onchange(undefined)}
      >
        {t('admin.logo.remove')}
      </button>
    {/if}
  </div>
  {#if node.description}<p class="text-sm opacity-70">{node.description}</p>{/if}
  {#if failed}<p role="alert" class="text-error text-sm">{failed}</p>{/if}
  {#if errors.length > 0}<p class="text-error text-sm">{errors.join(' ')}</p>{/if}
</div>
