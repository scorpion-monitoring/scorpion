<script lang="ts">
  // A stand-in for the widget a contributing module (M9's category step) would register for its field type.
  import type { WidgetProps } from '@scorpion/ui-kit';

  let { node, value }: WidgetProps = $props();
</script>

<div data-widget="kpi-set">
  <label for="kpi-set-input">{node.label}</label>
  <input id="kpi-set-input" value={typeof value === 'string' ? value : ''} />
</div>
