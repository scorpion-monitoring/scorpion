<script lang="ts">
  // The field `kpi.indicatorId` of the settings of bibliometrics (widget `bibliometrics-indicator`, ADR-0057): a choice of the
  // numeric indicators in the thematic category Bibliographic, or none (no KPI). It only offers what the server accepts; the server
  // refuses anything else with a 422 that shows here. Two reads when the settings page opens: the indicators of the category and the
  // value types (which of them are numeric).
  import { unwrap } from '@scorpion/contracts/client';
  import { FieldShell, getShell, type WidgetProps } from '@scorpion/ui-kit';

  let { node, value, onchange, errors, disabled }: WidgetProps = $props();
  const { t, api } = getShell();

  const CATEGORY = 'Bibliographic';
  let choices = $state<{ id: string; name: string }[]>();
  let failed = $state(false);

  $effect(() => {
    let current = true;
    Promise.all([
      unwrap(
        api.GET('/kpi/indicators', {
          params: {
            query: { thematic: CATEGORY, qualitative: 'false', page: '0', pageSize: '100' },
          },
        }),
      ),
      unwrap(api.GET('/kpi/value-types')),
    ]).then(
      ([indicators, types]) => {
        const numeric = new Set(types.result.filter((type) => type.numeric).map((type) => type.id));
        if (current)
          choices = indicators.result
            .filter((row) => row.thematic === CATEGORY && numeric.has(row.valueType))
            .map((row) => ({ id: row.id, name: row.name }));
      },
      () => {
        if (current) failed = true;
      },
    );
    return () => {
      current = false;
    };
  });

  const selected = $derived(typeof value === 'string' ? value : '');
  // A saved id the list no longer offers stays visible, so a save of another setting does not drop it unseen.
  const missing = $derived(
    selected !== '' && choices !== undefined && !choices.some((choice) => choice.id === selected),
  );
</script>

<FieldShell label={node.label} hint={node.description} {errors}>
  {#snippet children({ id, describedBy, invalid })}
    <select
      {id}
      class="select select-bordered w-full max-w-md"
      aria-describedby={describedBy}
      aria-invalid={invalid ? 'true' : undefined}
      disabled={disabled || choices === undefined}
      value={selected}
      onchange={(event) => {
        const next = event.currentTarget.value;
        onchange(next === '' ? undefined : next);
      }}
    >
      <option value="">{t('biblio.picker.none')}</option>
      {#if missing}
        <option value={selected}>{t('biblio.picker.missing')}</option>
      {/if}
      {#each choices ?? [] as choice (choice.id)}
        <option value={choice.id}>{choice.name}</option>
      {/each}
    </select>
  {/snippet}
</FieldShell>
{#if failed}
  <p class="text-error text-sm" role="alert">{t('biblio.picker.failed')}</p>
{:else if choices === undefined}
  <p class="text-sm opacity-70" role="status">{t('biblio.picker.loading')}</p>
{:else if choices.length === 0}
  <p class="text-sm opacity-70">{t('biblio.picker.empty')}</p>
{/if}
