<script lang="ts">
  // The value panel of a list facet: a listbox of its values with their counts, several to choose (OR within the
  // facet). Above `FILTER_FROM` values a filter field narrows them (by the label in the page's language, without
  // case or accents); at most `LIST_CAP` are drawn, the rest are reached by typing. In `combined` the look's box
  // keeps the focus and types the filter; in `bar` the panel has its own field (or the list takes the focus).
  // Choosing never closes the panel.
  import { FILTER_FROM, visibleOptions } from './model.ts';
  import type { PanelProps } from './panels.ts';

  let {
    view,
    definition,
    listId,
    owned,
    filter = '',
    activeId = $bindable(),
    onback,
  }: PanelProps = $props();

  let own = $state('');
  let active = $state(0);
  /** An arrow key was pressed since the filter last changed: Space then chooses instead of typing. */
  let navigated = false;
  let field = $state<HTMLInputElement>();
  let list = $state<HTMLElement>();

  const options = $derived(definition.type === 'checkbox' ? definition.options : []);
  const text = $derived(owned ? filter : own);
  const found = $derived(visibleOptions(options, text));
  const chosen = $derived.by(() => {
    const value = view.state[definition.id];
    return Array.isArray(value) ? value : [];
  });
  const withField = $derived(!owned && options.length > FILTER_FROM);
  const optionId = (index: number) => `${listId}-${index}`;

  // A new filter starts at the first value; the owner reads the active option for its `aria-activedescendant`.
  $effect.pre(() => {
    void text;
    active = 0;
    navigated = false;
  });
  $effect(() => {
    activeId =
      found.shown.length > 0 ? optionId(Math.min(active, found.shown.length - 1)) : undefined;
  });

  function toggle(index: number) {
    const option = found.shown[index];
    if (!option) return;
    active = index;
    view.toggle(definition.id, option.value, !chosen.includes(option.value));
  }

  /** The keys of the list: ↑ ↓ Home End move, Space and Enter choose (the panel stays open), Escape goes back. */
  export function onkey(event: KeyboardEvent): boolean {
    const last = found.shown.length - 1;
    switch (event.key) {
      case 'ArrowDown':
        active = Math.min(last, active + 1);
        navigated = true;
        break;
      case 'ArrowUp':
        active = Math.max(0, active - 1);
        navigated = true;
        break;
      case 'Home':
        if (!withField && !owned) active = 0;
        else return false;
        break;
      case 'End':
        if (!withField && !owned) active = Math.max(0, last);
        else return false;
        break;
      case ' ':
      case 'Enter':
        if (event.key === ' ' && (owned || withField) && text !== '' && !navigated) {
          // A space while typing a filter is part of the text ("IPK Gat"); after an arrow key it chooses.
          return false;
        }
        toggle(active);
        break;
      case 'Escape':
        onback();
        break;
      default:
        return false;
    }
    event.preventDefault();
    list?.querySelector(`#${CSS.escape(optionId(active))}`)?.scrollIntoView({ block: 'nearest' });
    return true;
  }

  export function focus(): boolean {
    (withField ? field : list)?.focus();
    return true;
  }
</script>

<div class="flex flex-col gap-2">
  {#if withField}
    <input
      bind:this={field}
      bind:value={own}
      type="text"
      role="combobox"
      class="input input-bordered input-sm w-full"
      aria-label={view.t('kit.facetSearch.filterValues', { facet: definition.label })}
      aria-expanded="true"
      aria-controls={listId}
      aria-autocomplete="list"
      aria-activedescendant={activeId}
      autocomplete="off"
      onkeydown={(event) => onkey(event)}
    />
  {/if}
  <ul
    bind:this={list}
    id={listId}
    role="listbox"
    aria-label={definition.label}
    aria-multiselectable="true"
    aria-activedescendant={!owned && !withField ? activeId : undefined}
    tabindex={!owned && !withField ? 0 : undefined}
    class="max-h-72 overflow-y-auto overscroll-contain"
    onkeydown={!owned && !withField ? (event) => onkey(event) : undefined}
  >
    {#each found.shown as option, index (option.value)}
      {@const on = chosen.includes(option.value)}
      <!-- The keys are the box's (`aria-activedescendant`), which keeps the focus: a press must not take it. -->
      <!-- svelte-ignore a11y_click_events_have_key_events -->
      <li
        id={optionId(index)}
        role="option"
        aria-selected={on}
        class={[
          'flex cursor-pointer items-center gap-2 rounded px-2 py-1.5',
          index === active && 'bg-base-200 outline-primary outline-2 -outline-offset-2',
        ]}
        onmousedown={(event) => event.preventDefault()}
        onclick={() => toggle(index)}
      >
        <span
          class={[
            'grid size-4 shrink-0 place-items-center rounded border text-xs',
            on ? 'bg-primary text-primary-content border-primary' : 'border-base-content/50',
          ]}
          aria-hidden="true"
        >
          {on ? '✓' : ''}
        </span>
        <span class="grow">{option.label}</span>
        {#if option.count !== undefined}
          <span class="text-sm opacity-70">
            {view.t('kit.facets.count', { count: option.count })}
          </span>
        {/if}
      </li>
    {/each}
  </ul>
  {#if found.shown.length === 0}
    <p class="px-2 text-sm opacity-70">{view.t('kit.facetSearch.noValue')}</p>
  {/if}
  {#if found.more > 0 || text}
    <p class="px-2 text-sm opacity-70">
      {#if found.more > 0}{view.t('kit.facetSearch.more', { count: found.more })}{/if}
      {#if text}{view.t('kit.facetSearch.matching', {
          count: found.shown.length + found.more,
          total: options.length,
        })}{/if}
    </p>
  {/if}
</div>
