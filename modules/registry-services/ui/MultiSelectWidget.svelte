<script lang="ts">
  // The widget `multi-select`: several choices from the options the server sent with the field, as a group of
  // check boxes. The value is the list of the chosen values, in the order of the options.
  import { getShell, type WidgetProps } from '@scorpion/ui-kit';
  import { getWizardContext } from './wizard-context.ts';

  let { node, value, onchange, errors, disabled }: WidgetProps = $props();
  const { t } = getShell();
  const wizard = getWizardContext();
  const id = $props.id();

  const choices = $derived(wizard.field(node.pointer)?.choices ?? []);
  const chosen = $derived(Array.isArray(value) ? (value as string[]) : []);
  const text = (choice: {
    value: string;
    label?: string | undefined;
    labelKey?: string | undefined;
  }) => choice.label ?? (choice.labelKey ? t(choice.labelKey) : choice.value);

  function toggle(option: string, on: boolean) {
    const next = on ? [...chosen, option] : chosen.filter((entry) => entry !== option);
    onchange(choices.map((choice) => choice.value).filter((candidate) => next.includes(candidate)));
  }
  const describedBy = $derived(
    [node.description ? `${id}-hint` : '', errors.length > 0 ? `${id}-error` : '']
      .filter(Boolean)
      .join(' ') || undefined,
  );
</script>

<fieldset class="flex flex-col gap-1" aria-describedby={describedBy}>
  <legend class="text-sm font-medium">
    {node.label}{#if node.required}<span class="opacity-70"> ({t('kit.form.required')})</span>{/if}
  </legend>
  {#each choices as choice (choice.value)}
    <label class="flex items-center gap-2">
      <input
        type="checkbox"
        class="checkbox"
        checked={chosen.includes(choice.value)}
        {disabled}
        aria-invalid={errors.length > 0 ? 'true' : undefined}
        onchange={(event) => toggle(choice.value, event.currentTarget.checked)}
      />
      <span>{text(choice)}</span>
    </label>
  {/each}
  {#if node.description}<p id="{id}-hint" class="text-sm opacity-70">{node.description}</p>{/if}
  {#if errors.length > 0}<p id="{id}-error" class="text-error text-sm">{errors.join(' ')}</p>{/if}
</fieldset>
