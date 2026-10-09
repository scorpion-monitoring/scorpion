<script lang="ts">
  // The ROR id: a text input that takes the bare id or a pasted ror.org link, and shows what will be
  // stored. The preview says nothing for a value that does not have the shape of an id; the server judges
  // the rest (the check digits) and its words appear on the field.
  import { FieldShell, getShell, type WidgetProps } from '@scorpion/ui-kit';
  import { previewRor, rorLink } from './ror.ts';

  let { node, value, onchange, errors, disabled }: WidgetProps = $props();
  const { t } = getShell();
  const text = $derived(typeof value === 'string' ? value : '');
  const preview = $derived(previewRor(text));
</script>

<FieldShell label={node.label} hint={node.description} {errors}>
  {#snippet children({ id, describedBy, invalid })}
    <input
      {id}
      type="text"
      class="input input-bordered w-full"
      class:input-error={invalid}
      aria-invalid={invalid ? 'true' : undefined}
      aria-describedby={describedBy}
      autocomplete="off"
      spellcheck="false"
      maxlength={200}
      {disabled}
      value={text}
      oninput={(event) => onchange(event.currentTarget.value || undefined)}
    />
    {#if preview}
      <p class="text-sm" data-testid="ror-preview">
        {t('organisation.form.rorId.preview')}
        <a class="link" href={rorLink(preview)} rel="noopener noreferrer">{preview}</a>
      </p>
    {/if}
  {/snippet}
</FieldShell>
