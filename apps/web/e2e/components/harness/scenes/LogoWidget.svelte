<script lang="ts">
  import type { WidgetProps } from '@scorpion/ui-kit';

  let { node, value, onchange, disabled }: WidgetProps = $props();
</script>

<div class="flex flex-col gap-1">
  <label for="logo-widget" class="text-sm font-medium">{node.label}</label>
  <input
    id="logo-widget"
    type="text"
    class="input input-bordered"
    {disabled}
    value={typeof value === 'string' ? value : ''}
    oninput={(event) => onchange(event.currentTarget.value)}
  />
  <p class="text-sm opacity-70" data-testid="widget-note">Custom widget</p>
</div>
