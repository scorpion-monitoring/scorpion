<script lang="ts">
  // Filters for a list: groups of checkboxes and number ranges. The selection lives in the address
  // (`?f.status=active`), so a filtered list can be bookmarked and shared; the page reads it with
  // `parseFacets()` and gives it back as `state`. Counts next to an option are the server's.
  import { getShell } from './context.ts';
  import {
    activeFacets,
    clearFacet,
    isRange,
    serializeFacets,
    setRange,
    toggleOption,
    type FacetDefinition,
    type FacetState,
  } from './facets.ts';

  let {
    definitions,
    state = $bindable({}),
    path,
    onchange,
  }: {
    definitions: readonly FacetDefinition[];
    state?: FacetState;
    /** The page's path in the application (`/services`); the filtered address is built from it with `href()`. */
    path?: string;
    onchange?: (state: FacetState) => void;
  } = $props();
  const { t, href, goto } = getShell();
  const base = $props.id();

  function change(next: FacetState) {
    state = next;
    if (path !== undefined) {
      const query = serializeFacets(
        next,
        definitions,
        new URLSearchParams(window.location.search),
      ).toString();
      void goto(href(path) + (query ? `?${query}` : ''), { replace: true });
    }
    onchange?.(next);
  }

  const number = (text: string) => (text.trim() === '' ? undefined : Number(text));
</script>

<section aria-label={t('kit.facets.label')} class="flex flex-col gap-4">
  {#each definitions as definition (definition.id)}
    {@const selected = state[definition.id]}
    <fieldset class="flex flex-col gap-1">
      <legend class="mb-1 font-semibold">{definition.label}</legend>
      {#if definition.type === 'checkbox'}
        {#each definition.options as option (option.value)}
          <label class="flex items-center gap-2">
            <input
              type="checkbox"
              class="checkbox checkbox-sm"
              checked={Array.isArray(selected) && selected.includes(option.value)}
              onchange={(event) =>
                change(
                  toggleOption(state, definition.id, option.value, event.currentTarget.checked),
                )}
            />
            <span>{option.label}</span>
            {#if option.count !== undefined}
              <span class="text-sm opacity-70"
                >{t('kit.facets.count', { count: option.count })}</span
              >
            {/if}
          </label>
        {/each}
      {:else}
        <div class="flex items-center gap-2">
          <label for="{base}-{definition.id}-min" class="text-sm">{t('kit.facets.min')}</label>
          <input
            id="{base}-{definition.id}-min"
            type="number"
            class="input input-sm w-28"
            min={definition.min}
            max={definition.max}
            step={definition.step ?? 1}
            value={isRange(selected) ? (selected.min ?? '') : ''}
            onchange={(event) =>
              change(
                setRange(state, definition.id, {
                  ...(isRange(selected) ? selected : {}),
                  min: number(event.currentTarget.value),
                }),
              )}
          />
          <label for="{base}-{definition.id}-max" class="text-sm">{t('kit.facets.max')}</label>
          <input
            id="{base}-{definition.id}-max"
            type="number"
            class="input input-sm w-28"
            min={definition.min}
            max={definition.max}
            step={definition.step ?? 1}
            value={isRange(selected) ? (selected.max ?? '') : ''}
            onchange={(event) =>
              change(
                setRange(state, definition.id, {
                  ...(isRange(selected) ? selected : {}),
                  max: number(event.currentTarget.value),
                }),
              )}
          />
        </div>
      {/if}
      {#if selected !== undefined}
        <button
          type="button"
          class="btn btn-ghost btn-xs self-start"
          onclick={() => change(clearFacet(state, definition.id))}
        >
          {t('kit.facets.clearOne', { label: definition.label })}
        </button>
      {/if}
    </fieldset>
  {/each}
  {#if activeFacets(state) > 0}
    <button type="button" class="btn btn-sm self-start" onclick={() => change({})}>
      {t('kit.facets.clear')}
    </button>
  {/if}
</section>
