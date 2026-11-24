<script lang="ts">
  // The look `combined` (option A of the brainstorm): one control above the list. An ARIA 1.2 combobox whose
  // listbox has two levels, the facets ("Filter by") and a facet's value panel (`PANELS`), and the chips of the
  // chosen facets before the input inside the same box (buttons outside the listbox, reached with Shift+Tab).
  //
  // Keyboard: focusing the box opens the facet list with **no option active** (a reader then says the combobox,
  // its name and "expanded" first; the spike of sprint 3), ↓ and ↑ move, Enter or → opens a facet, typing narrows
  // its values, Space chooses (the panel stays open), Escape or ← (in an empty filter) goes back one level, Escape
  // on the facet list closes it with the focus kept in the box, Backspace in the empty box removes the last chip
  // (announced), Tab leaves, Shift+Tab reaches the chips (out of the tab order, so Tab into the box reaches the
  // input first). The focus stays in the box while the list is open; a range panel takes it into its
  // fields, and its Escape gives it back. The list is drawn in the flow under the box (as the sprint's sketch has it),
  // so it pushes the count line and the table down and never covers a row.
  //
  // Typing on the first level searches the names at once (the shared state sends it) and offers the facet values
  // whose label matches, with counts; Enter on one adds it as a chip and clears the text. `provider:ipk` (the
  // facet by id or by its label in the page's language, a value with spaces quoted) narrows the list to that
  // facet's values and is not sent as a search; an unknown facet name is plain text.
  import { tick } from 'svelte';
  import { chipText, matchingOffers, parseShortcut, type Offer } from './model.ts';
  import { PANELS, type PanelHandle } from './panels.ts';
  import type { LookProps } from './types.ts';

  let { view, results, shortcuts = false }: LookProps = $props();

  const listId = $derived(`${view.id}-list`);
  const optionId = (index: number) => `${listId}-${index}`;

  let input = $state<HTMLInputElement>();
  let popup = $state<HTMLElement>();
  let field = $state<HTMLElement>();
  let open = $state(false);
  /** The facet whose panel is open (the second level), or none. */
  let level = $state<string>();
  /** The text that narrows the open facet's values (the box shows it instead of the search text). */
  let filter = $state('');
  /** The active option of the first level; -1 is none. */
  let active = $state(-1);
  let panel = $state<PanelHandle>();
  let panelActive = $state<string>();
  /** Below `sm` the chips fold after the first into a `+N` chip (the box keeps to two lines), until it is pressed. */
  let narrow = $state(false);
  let unfolded = $state(false);
  /** The list was asked for (↓, a click): it shows the facets even while a typed name offers no value. */
  let asked = $state(false);
  /**
   * A pointer is pressed somewhere. The list is in the flow, so closing it moves the page: when the box loses the
   * focus to a press, the list closes only after that press's click, which then lands where it was aimed.
   */
  let pressing = false;

  $effect(() => {
    const query = window.matchMedia('(max-width: 639px)');
    narrow = query.matches;
    const changed = () => (narrow = query.matches);
    query.addEventListener('change', changed);
    return () => query.removeEventListener('change', changed);
  });

  const shortcut = $derived(level ? undefined : parseShortcut(view.text, view.definitions));
  /** The facet whose values are listed: the open level, or the facet a `facet:value` shortcut names. */
  const shown = $derived(
    view.definitions.find((definition) => definition.id === (level ?? shortcut?.facet.id)),
  );
  const offers = $derived<Offer[]>(
    !level && !shortcut && view.text.trim()
      ? matchingOffers(view.suggestions, view.text, view.state)
      : [],
  );
  /**
   * The first level is one listbox: the matching values while there is text ("Matching values"), then the facets
   * ("Filter by"), so a facet can be opened without giving up the name search. ↓ and ↑ run through both.
   */
  const firstLevel = $derived(offers.length + view.definitions.length);

  const chips = $derived(
    view.definitions.flatMap((definition) => {
      const chip = chipText(definition, view.state);
      return chip ? [{ definition, chip }] : [];
    }),
  );
  const folded = $derived(narrow && !unfolded && chips.length > 1);
  const visibleChips = $derived(folded ? chips.slice(0, 1) : chips);

  const chosenCount = (facet: string) => {
    const value = view.state[facet];
    return Array.isArray(value) ? value.length : value ? 1 : 0;
  };

  /**
   * Whether the list shows. While a name is typed it shows only when it has matching values to offer (or was
   * asked for), so the list never covers the rows the name has found (goal 1 of the sprint: type, no click).
   */
  const expanded = $derived(
    open &&
      (Boolean(level) ||
        Boolean(shortcut) ||
        view.text.trim() === '' ||
        offers.length > 0 ||
        asked),
  );

  const activeDescendant = $derived(
    !expanded ? undefined : shown ? panelActive : active >= 0 ? optionId(active) : undefined,
  );
  const controls = $derived(shown ? `${listId}-panel` : listId);

  function show(ask = false) {
    open = true;
    if (ask) asked = true;
  }

  function close() {
    open = false;
    asked = false;
    level = undefined;
    filter = '';
    active = -1;
  }

  async function enter(facet: string) {
    open = true;
    level = facet;
    filter = '';
    active = -1;
    await tick();
    // A list panel keeps the focus in the box; a range panel takes it into its fields.
    if (view.definitions.find((definition) => definition.id === facet)?.type !== 'checkbox') {
      panel?.focus();
    } else input?.focus();
  }

  function back() {
    // Leaving a `facet:value` text puts back the search it stood in for (it was never sent).
    if (shortcut && !level) view.cancelText();
    // The facet that was open becomes the active option, so a reader says where the person is now (NVDA said
    // only the box when no option was active).
    const left = view.definitions.findIndex((definition) => definition.id === level);
    level = undefined;
    filter = '';
    active = left < 0 ? -1 : offers.length + left;
    input?.focus();
  }

  function take(offer: Offer) {
    view.take(offer);
    active = -1;
  }

  /** The chips' buttons, in order. They are out of the tab order: Tab into the box reaches the input first. */
  const chipControls = () => [
    ...(field?.querySelectorAll<HTMLElement>('[data-chip-control]') ?? []),
  ];

  /** Shift+Tab from the input reaches the last chip; Tab and Shift+Tab move between the chips and back. */
  function onchipkey(event: KeyboardEvent) {
    if (event.key !== 'Tab') return;
    const controls = chipControls();
    const index = controls.indexOf(event.target as HTMLElement);
    if (index < 0) return;
    if (event.shiftKey) {
      if (index === 0) return; // out of the box, to what comes before it
      event.preventDefault();
      controls[index - 1]!.focus();
    } else {
      event.preventDefault();
      (controls[index + 1] ?? input)?.focus();
    }
  }

  function onkeydown(event: KeyboardEvent) {
    const empty = (level ? filter : view.text) === '';
    if (event.key === 'Backspace' && !level && view.text === '' && chips.length > 0) {
      event.preventDefault();
      view.clear(chips[chips.length - 1]!.definition.id, true);
      return;
    }
    if (event.key === 'Tab') {
      close();
      view.endTyping();
      const controls = chipControls();
      if (event.shiftKey && controls.length > 0) {
        event.preventDefault();
        controls[controls.length - 1]!.focus();
      }
      return;
    }
    if (!expanded) {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        show(true);
      } else if (event.key === 'Enter') {
        event.preventDefault();
        view.flushText();
      }
      return;
    }
    if (shown) {
      if (event.key === 'ArrowLeft' && empty) {
        event.preventDefault();
        back();
        return;
      }
      if (panel?.onkey(event)) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        back();
      }
      return;
    }
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        active = Math.min(firstLevel - 1, active + 1);
        break;
      case 'ArrowUp':
        event.preventDefault();
        active = Math.max(0, active - 1);
        break;
      case 'Enter':
      case 'ArrowRight':
        if (active < 0) {
          if (event.key === 'Enter') {
            event.preventDefault();
            view.flushText();
          }
          break;
        }
        if (active < offers.length) {
          if (event.key === 'Enter') {
            event.preventDefault();
            take(offers[active]!);
          }
        } else {
          event.preventDefault();
          const facet = view.definitions[active - offers.length];
          if (facet) void enter(facet.id);
        }
        break;
      case 'Escape':
        // Closes the list; the typed search stays.
        event.preventDefault();
        close();
        break;
    }
  }

  function oninput(event: Event & { currentTarget: HTMLInputElement }) {
    const value = event.currentTarget.value;
    open = true;
    asked = false;
    active = -1;
    if (level) {
      filter = value;
      return;
    }
    const known = parseShortcut(value, view.definitions);
    // A `facet:value` shortcut narrows the list and is not a name search; anything else is.
    view.setText(value, { send: !known });
  }
</script>

<svelte:window
  onpointerdown={() => (pressing = true)}
  onclick={() => {
    if (!pressing) return;
    pressing = false;
    const inside = (node: Element | null) =>
      Boolean(node && (field?.contains(node) || popup?.contains(node)));
    if (!inside(document.activeElement)) close();
  }}
/>

{#snippet facetOptions()}
  {#each view.definitions as definition, at (definition.id)}
    {@const index = offers.length + at}
    {@const count = chosenCount(definition.id)}
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <div
      id={optionId(index)}
      role="option"
      tabindex="-1"
      aria-selected={index === active}
      class={[
        'flex cursor-pointer items-center gap-2 rounded px-2 py-1.5',
        index === active && 'bg-base-200 outline-primary outline-2 -outline-offset-2',
      ]}
      onmousedown={(event) => event.preventDefault()}
      onclick={() => void enter(definition.id)}
      aria-label={count > 0
        ? `${definition.label}, ${count} ${view.t('kit.facetSearch.chosen')}`
        : undefined}
    >
      <span class="grow">{definition.label}</span>
      {#if count > 0}<span class="badge badge-sm badge-primary" aria-hidden="true">
          {count}
        </span>{/if}
      <span aria-hidden="true">›</span>
    </div>
  {/each}
{/snippet}

<div class="flex flex-col gap-1">
  <label class="text-sm font-medium" for="{view.id}-search">{view.label}</label>
  <div class="relative">
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
      bind:this={field}
      class="input input-bordered flex h-auto min-h-12 w-full flex-wrap items-center gap-1 py-1.5"
      onkeydown={onchipkey}
      onclick={(event) => {
        if (event.target === event.currentTarget) input?.focus();
      }}
    >
      {#each visibleChips as { definition, chip } (definition.id)}
        <span class="badge badge-outline badge-lg h-auto max-w-full gap-1 py-0.5 pr-0">
          <button
            type="button"
            tabindex="-1"
            data-chip-control
            class="truncate"
            aria-label={view.t('kit.facetSearch.openChip', { chip: chip.name })}
            onclick={() => void enter(definition.id)}
          >
            {chip.short}
          </button>
          <button
            type="button"
            tabindex="-1"
            data-chip-control
            class="btn btn-ghost btn-xs btn-circle"
            aria-label={view.t('kit.facetSearch.remove', { chip: chip.name })}
            onclick={() => {
              view.clear(definition.id, true);
              input?.focus();
            }}
          >
            <span aria-hidden="true">×</span>
          </button>
        </span>
      {/each}
      {#if folded}
        <button
          type="button"
          tabindex="-1"
          data-chip-control
          class="badge badge-ghost badge-lg"
          aria-label={view.t('kit.facetSearch.moreChips', { count: chips.length - 1 })}
          onclick={() => {
            unfolded = true;
            input?.focus();
          }}
        >
          +{chips.length - 1}
        </button>
      {/if}
      <input
        bind:this={input}
        id="{view.id}-search"
        type="text"
        role="combobox"
        class="min-w-24 grow bg-transparent outline-none"
        autocomplete="off"
        spellcheck="false"
        maxlength={100}
        aria-expanded={expanded}
        aria-controls={controls}
        aria-autocomplete="list"
        aria-activedescendant={activeDescendant}
        value={level ? filter : view.text}
        onfocus={() => show()}
        onclick={() => show(true)}
        {oninput}
        {onkeydown}
        onblur={(event) => {
          // Into the open list (a range panel's fields): the list stays. Anywhere else: it closes, after the
          // click when a pointer press took the focus.
          if (popup?.contains(event.relatedTarget as Node | null)) return;
          view.endTyping();
          if (!pressing) close();
        }}
      />
      {#if view.text || chips.length > 0}
        <button
          type="button"
          class="btn btn-ghost btn-sm btn-circle"
          aria-label={view.t('kit.facetSearch.clearBox')}
          onclick={() => {
            view.clearAll();
            close();
            input?.focus();
          }}
        >
          <span aria-hidden="true">✕</span>
        </button>
      {/if}
    </div>

    {#if expanded}
      <div
        bind:this={popup}
        class="bg-base-100 border-base-300 rounded-box mt-1 max-h-80 w-full overflow-y-auto overscroll-contain border p-1 shadow-sm sm:max-w-md"
      >
        {#if shown}
          {@const Panel = PANELS[shown.type]}
          <button
            type="button"
            tabindex="-1"
            class="btn btn-ghost btn-sm w-full justify-start"
            aria-label={view.t('kit.facetSearch.backFrom', { facet: shown.label })}
            onmousedown={(event) => event.preventDefault()}
            onclick={back}
          >
            <span aria-hidden="true">‹</span>
            {shown.label}
          </button>
          <Panel
            bind:this={panel}
            bind:activeId={panelActive}
            {view}
            definition={shown}
            listId="{listId}-panel"
            owned
            filter={level ? filter : (shortcut?.value ?? '')}
            onback={back}
          />
        {:else}
          <div id={listId} role="listbox" aria-label={view.t('kit.facetSearch.filterBy')}>
            {#if offers.length > 0}
              <div role="group" aria-labelledby="{listId}-offers">
                <div
                  id="{listId}-offers"
                  role="presentation"
                  class="px-2 pt-1 text-xs font-semibold opacity-70"
                >
                  {view.t('kit.facetSearch.offers')}
                </div>
                {#each offers as offer, index (`${offer.facet.id}/${offer.option.value}`)}
                  <!-- svelte-ignore a11y_click_events_have_key_events -->
                  <div
                    id={optionId(index)}
                    role="option"
                    tabindex="-1"
                    aria-selected={index === active}
                    class={[
                      'cursor-pointer rounded px-2 py-1.5',
                      index === active && 'bg-base-200 outline-primary outline-2 -outline-offset-2',
                    ]}
                    onmousedown={(event) => event.preventDefault()}
                    onclick={() => take(offer)}
                  >
                    {view.t('kit.facetSearch.offer', {
                      facet: offer.facet.label,
                      value: offer.option.label,
                      count: offer.option.count ?? 0,
                    })}
                  </div>
                {/each}
              </div>
            {/if}
            {#if offers.length > 0}
              <div role="group" aria-labelledby="{listId}-facets">
                <div
                  id="{listId}-facets"
                  role="presentation"
                  class="px-2 pt-1 text-xs font-semibold opacity-70"
                >
                  {view.t('kit.facetSearch.filterBy')}
                </div>
                {@render facetOptions()}
              </div>
            {:else}
              {@render facetOptions()}
            {/if}
          </div>
        {/if}
      </div>
    {/if}
  </div>
  {#if shortcuts}
    <div class="flex flex-wrap gap-2" role="group" aria-label={view.t('kit.facetSearch.filterBy')}>
      {#each view.definitions as definition (definition.id)}
        <button
          type="button"
          class="btn btn-ghost btn-xs"
          onclick={() => {
            input?.focus();
            void enter(definition.id);
          }}
        >
          {definition.label} <span aria-hidden="true">▾</span>
        </button>
      {/each}
    </div>
  {/if}
</div>
<div class="flex min-w-0 flex-col gap-3">
  {@render results()}
</div>
