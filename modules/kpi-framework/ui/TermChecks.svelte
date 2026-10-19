<script lang="ts">
  // A multi-select as a group of checkboxes in a fieldset, for the means of measurement and the tools: the
  // terms come from a vocabulary. A term the row has but the vocabulary deactivated stays in the list (checked), so
  // a save never drops it silently.
  import { getShell } from '@scorpion/ui-kit';
  import { labelOf, offered, type Term } from './terms.ts';

  let {
    legend,
    hint,
    terms,
    selected = $bindable([]),
    errors = [],
  }: {
    legend: string;
    hint?: string;
    terms: readonly Term[];
    selected?: string[];
    errors?: readonly string[];
  } = $props();
  const { t, locale } = getShell();
  const id = $props.id();
  const choices = $derived(offered(terms, selected));
  const describedBy = $derived(
    [hint ? `${id}-hint` : '', errors.length > 0 ? `${id}-error` : ''].filter(Boolean).join(' ') ||
      undefined,
  );

  function toggle(key: string, checked: boolean) {
    selected = checked
      ? [...selected.filter((k) => k !== key), key]
      : selected.filter((k) => k !== key);
  }
</script>

<fieldset class="flex flex-col gap-1" aria-describedby={describedBy}>
  <legend class="text-sm font-medium">{legend}</legend>
  {#if choices.length === 0}
    <p class="text-sm opacity-70">{t('kpi.indicator.form.terms.none')}</p>
  {:else}
    <div class="flex flex-wrap gap-x-6 gap-y-2">
      {#each choices as term (term.key)}
        <label class="flex cursor-pointer items-center gap-2">
          <input
            type="checkbox"
            class="checkbox checkbox-sm"
            checked={selected.includes(term.key)}
            onchange={(event) => toggle(term.key, event.currentTarget.checked)}
          />
          <span>{labelOf(terms, term.key, locale())}</span>
        </label>
      {/each}
    </div>
  {/if}
  {#if hint}<p id="{id}-hint" class="text-sm opacity-70">{hint}</p>{/if}
  {#if errors.length > 0}<p id="{id}-error" class="text-error text-sm">{errors.join(' ')}</p>{/if}
</fieldset>
