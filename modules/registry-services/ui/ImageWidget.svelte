<script lang="ts">
  // The widget `image`: the icon cannot be sent with the new service, because the stored file refers to the
  // service by its id. The step says so, as the organisation form does for its logo; the page offers the upload
  // on the screen that follows the creation.
  import { getShell, type WidgetProps } from '@scorpion/ui-kit';

  let { node }: WidgetProps = $props();
  const { t } = getShell();
</script>

<div class="flex flex-col gap-1">
  <p class="text-sm font-medium">{node.label}</p>
  <p class="alert alert-info text-sm">
    {t('services.icon.afterCreate')}
  </p>
  {#if node.description}<p class="text-sm opacity-70">{node.description}</p>{/if}
</div>
