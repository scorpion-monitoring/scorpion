<script lang="ts">
  // The settings form shared by the widgets of the dashboard (M11 sprint 4, ADR-0044), drawn from the JSON Schema of the widget's
  // configuration. "Apply" checks the draft against that schema (the server checks it again when the dashboard is saved) and gives the new
  // configuration to the widget, which stores it with the layout. The keys the form does not draw are kept as they are.
  import { getShell } from './context.ts';
  import DashboardDefaults from './DashboardDefaults.svelte';
  import type { JsonSchema } from './json-schema-check.ts';
  import SettingsFields from './SettingsFields.svelte';
  import { fieldsOf, merged, problemsOf } from './widget-settings.ts';
  import Alert from './Alert.svelte';

  let {
    schema,
    config,
    onapply,
    onclose,
  }: {
    schema: JsonSchema;
    config: Record<string, unknown>;
    /** Takes the new configuration (the widget's `setConfig`). */
    onapply: (next: Record<string, unknown>) => void;
    onclose: () => void;
  } = $props();

  const { t } = getShell();
  const fields = $derived(fieldsOf(schema));
  // The form edits a copy; nothing changes until "Apply".
  // svelte-ignore state_referenced_locally
  let draft = $state<Record<string, unknown>>({ ...config });
  let problems = $state<ReadonlySet<string>>(new Set());
  let showDefaults = $state(false);

  // A widget with the dashboard's filter fields offers the dialog of the defaults.
  const hasFilter = $derived(
    fields.some((field) => ['service', 'range', 'category'].includes(field.kind)),
  );
  const ranges = $derived(
    (fields.find((field) => field.kind === 'range') as { options: string[] } | undefined)
      ?.options ?? [],
  );

  function apply(event: SubmitEvent) {
    event.preventDefault();
    const next = merged(config, $state.snapshot(draft), fields);
    const found = problemsOf(schema, next);
    problems = new Set(found.keys());
    if (found.size > 0) return;
    onapply(next);
    onclose();
  }
</script>

<form class="flex flex-col gap-4" onsubmit={apply} novalidate>
  {#if fields.length === 0}
    <p>{t('kit.widget.noSettings')}</p>
  {:else}
    <SettingsFields {fields} bind:draft {problems} />
  {/if}
  {#if problems.size > 0}
    <Alert kind="error">{t('kit.widget.invalid')}</Alert>
  {/if}
  <div class="flex flex-wrap items-center justify-between gap-2">
    {#if hasFilter}
      <button type="button" class="btn btn-ghost btn-sm" onclick={() => (showDefaults = true)}>
        {t('kit.widget.defaults')}
      </button>
    {:else}
      <span></span>
    {/if}
    <div class="flex gap-2">
      <button type="button" class="btn" onclick={onclose}>{t('kit.widget.cancel')}</button>
      <button type="submit" class="btn btn-primary">{t('kit.widget.apply')}</button>
    </div>
  </div>
</form>

{#if showDefaults}
  <DashboardDefaults {ranges} onclose={() => (showDefaults = false)} />
{/if}
