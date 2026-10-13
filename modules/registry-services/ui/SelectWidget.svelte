<script lang="ts">
  // The widget `select`: one choice from the options the server sent with the field (the active terms of a
  // vocabulary, or a fixed list of the config). No label or term is written here; the options carry their
  // text (a vocabulary term in the person's language) or a key of the message catalogue.
  import { FieldShell, getShell, type WidgetProps } from '@scorpion/ui-kit';
  import { getWizardContext } from './wizard-context.ts';

  let { node, value, onchange, errors, disabled }: WidgetProps = $props();
  const { t } = getShell();
  const wizard = getWizardContext();

  const choices = $derived(wizard.field(node.pointer)?.choices ?? []);
  const text = (choice: {
    value: string;
    label?: string | undefined;
    labelKey?: string | undefined;
  }) => choice.label ?? (choice.labelKey ? t(choice.labelKey) : choice.value);
</script>

<FieldShell
  label={node.label}
  hint={node.description}
  {errors}
  required={node.required}
  requiredText={t('kit.form.required')}
>
  {#snippet children({ id, describedBy, invalid })}
    <select
      {id}
      class="select select-bordered w-full"
      class:select-error={invalid}
      aria-describedby={describedBy}
      aria-invalid={invalid ? 'true' : undefined}
      {disabled}
      onchange={(event) =>
        onchange(event.currentTarget.value === '' ? undefined : event.currentTarget.value)}
    >
      {#if !node.required}<option value="" selected={value === undefined || value === ''}
          >{t('services.choice.none')}</option
        >{/if}
      {#each choices as choice (choice.value)}
        <option value={choice.value} selected={value === choice.value}>{text(choice)}</option>
      {/each}
    </select>
  {/snippet}
</FieldShell>
