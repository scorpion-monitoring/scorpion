<script lang="ts">
  // The widget `kpi-set` of the create wizard: the editor of the KPIs, over the value `{ setId, extras }`. The sets to
  // choose from came with the schema (the field's `choices`), so the step asks the API for nothing until a set is
  // chosen. An empty choice is no value at all, so a service without a KPI set sends nothing.
  import { getWizardFieldContext, type WidgetProps } from '@scorpion/ui-kit';
  import KpiEditor from './KpiEditor.svelte';
  import { kpisValue, type KpisValue } from './kpi-types.ts';

  let { node, value, onchange, errors, disabled }: WidgetProps = $props();
  const field = getWizardFieldContext();
  const id = $props.id();

  const sets = $derived(
    (field.field(node.pointer)?.choices ?? []).map((choice) => ({
      id: choice.value,
      name: choice.label ?? choice.value,
    })),
  );
  const current = $derived(kpisValue(value));
</script>

<fieldset class="flex flex-col gap-2">
  <legend class="text-sm font-medium">{node.label}</legend>
  {#if node.description}<p class="text-sm opacity-70">{node.description}</p>{/if}
  <KpiEditor
    {id}
    {sets}
    setId={current.setId}
    extras={current.extras}
    known={[]}
    {disabled}
    {errors}
    onchange={(next: KpisValue) =>
      onchange(next.setId === null && next.extras.length === 0 ? undefined : next)}
  />
</fieldset>
