<script lang="ts">
  // The type of an organisation as a select. The options and their labels come from the registry
  // (`GET /organisation-types`), never from this file; a type that is no longer registered stays selectable
  // as itself so that the form does not silently change it.
  import { FieldShell, getShell, type WidgetProps } from '@scorpion/ui-kit';
  import { getTypeChoices } from './form-context.ts';

  let { node, value, onchange, errors, disabled }: WidgetProps = $props();
  const { t } = getShell();
  const choices = getTypeChoices();
  const current = $derived(typeof value === 'string' ? value : '');
  const unknown = $derived(current !== '' && !choices.some((choice) => choice.id === current));
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
      aria-invalid={invalid ? 'true' : undefined}
      aria-describedby={describedBy}
      {disabled}
      value={current}
      onchange={(event) => onchange(event.currentTarget.value || undefined)}
    >
      <option value="">{t('organisation.form.type.choose')}</option>
      {#if unknown}<option value={current}>{t('organisation.type.unknown', { id: current })}</option
        >{/if}
      {#each choices as choice (choice.id)}
        <option value={choice.id}>{choice.label}</option>
      {/each}
    </select>
  {/snippet}
</FieldShell>
