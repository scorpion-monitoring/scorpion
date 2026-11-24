<script lang="ts">
  // The value panel of a range facet: from and to, within the facet's `min`, `max` and `step`. Enter (or Apply)
  // applies; a range that cannot be (from > to, or outside the limits) is refused here with a message and never
  // sent. Either end may stay empty (`Year: ≥ 2018`). The fields take the focus, in both looks.
  import { isRange, type RangeValue } from '../facets.ts';
  import { rangeProblem } from './model.ts';
  import type { PanelProps } from './panels.ts';

  let { view, definition, listId, activeId = $bindable(), onback }: PanelProps = $props();

  const limits = $derived(
    definition.type === 'range' ? definition : { min: 0, max: 0, step: undefined },
  );
  const current = $derived.by((): RangeValue => {
    const value = view.state[definition.id];
    return isRange(value) ? value : {};
  });
  // `bind:value` of a number field gives a number, or `null` when it is empty.
  // svelte-ignore state_referenced_locally
  let from = $state<number | null | undefined>(current.min);
  // svelte-ignore state_referenced_locally
  let to = $state<number | null | undefined>(current.max);
  let problem = $state<'order' | 'bounds' | undefined>();
  let first = $state<HTMLInputElement>();

  $effect(() => {
    activeId = undefined;
  });

  const number = (value: number | null | undefined) =>
    value === null || value === undefined ? undefined : Number(value);

  function apply() {
    const range = { min: number(from), max: number(to) };
    problem =
      definition.type === 'range' && (Number.isNaN(range.min) || Number.isNaN(range.max))
        ? 'bounds'
        : definition.type === 'range'
          ? rangeProblem(definition, range)
          : undefined;
    if (!problem) view.setRange(definition.id, range);
  }

  function key(event: KeyboardEvent) {
    if (event.key === 'Enter') {
      event.preventDefault();
      apply();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      onback();
    }
  }

  export function onkey(): boolean {
    return false;
  }

  export function focus(): boolean {
    first?.focus();
    return true;
  }
</script>

<div id={listId} role="group" aria-label={definition.label} class="flex flex-col gap-2 p-1">
  <div class="flex flex-wrap items-end gap-2">
    <label class="flex flex-col gap-1 text-sm">
      {view.t('kit.facets.min')}
      <input
        bind:this={first}
        bind:value={from}
        type="number"
        class="input input-bordered input-sm w-28"
        min={limits.min}
        max={limits.max}
        step={limits.step ?? 1}
        aria-invalid={problem ? 'true' : undefined}
        aria-describedby={problem ? `${listId}-problem` : undefined}
        onkeydown={key}
      />
    </label>
    <label class="flex flex-col gap-1 text-sm">
      {view.t('kit.facets.max')}
      <input
        bind:value={to}
        type="number"
        class="input input-bordered input-sm w-28"
        min={limits.min}
        max={limits.max}
        step={limits.step ?? 1}
        aria-invalid={problem ? 'true' : undefined}
        aria-describedby={problem ? `${listId}-problem` : undefined}
        onkeydown={key}
      />
    </label>
    <button type="button" class="btn btn-sm" onclick={apply} onkeydown={key}>
      {view.t('kit.facetSearch.apply')}
    </button>
  </div>
  {#if problem}
    <p id="{listId}-problem" role="alert" class="text-error text-sm">
      {problem === 'order'
        ? view.t('kit.facetSearch.range.order')
        : view.t('kit.facetSearch.range.bounds', { min: limits.min, max: limits.max })}
    </p>
  {/if}
</div>
