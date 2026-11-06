<script lang="ts">
  import { tick, untrack } from 'svelte';
  import { getShell, Icon } from '@scorpion/ui-kit';
  import {
    buildTree,
    count,
    move,
    openForSelection,
    stateOf,
    toggle,
    visibleNodes,
    type Move,
    type PermissionLike,
    type TreeNode,
  } from './permission-tree.ts';

  // The permissions as a tree per dotted segment. A parent is a tri-state checkbox that selects or clears every
  // permission below it and says how many it covers; the value stays the flat list of ids. Native checkboxes carry
  // the semantics (a partly selected parent is `indeterminate`); the arrow keys move between the visible ones and
  // open or close a branch, and only one checkbox is in the tab order.
  let {
    permissions,
    value = $bindable(),
    name = 'scopes',
  }: { permissions: readonly PermissionLike[]; value: string[]; name?: string } = $props();
  const { t } = getShell();

  const roots = $derived(buildTree(permissions));
  const allIds = $derived(roots.flatMap((node) => node.ids).sort());
  const selected = $derived(new Set(value));
  let expanded = $state(new Set<string>(untrack(() => openForSelection(roots, new Set(value)))));
  let focused = $state<string>();
  let list: HTMLUListElement | undefined;

  const visible = $derived(visibleNodes(roots, expanded));
  // The one checkbox in the tab order: the last one focused while it is still visible, else the first.
  const tabStop = $derived(
    focused !== undefined && visible.some((node) => node.key === focused)
      ? focused
      : visible[0]?.key,
  );

  /** `indeterminate` is a property, not an attribute. */
  function partly(element: HTMLInputElement, on: boolean) {
    element.indeterminate = on;
    return {
      update(next: boolean) {
        element.indeterminate = next;
      },
    };
  }

  const flip = (node: TreeNode) => {
    value = toggle(node, value, allIds);
  };

  function open(key: string, on: boolean) {
    const next = new Set(expanded);
    if (on) next.add(key);
    else next.delete(key);
    expanded = next;
  }

  async function focusKey(key: string) {
    focused = key;
    await tick();
    for (const input of list?.querySelectorAll<HTMLInputElement>('input[data-key]') ?? []) {
      if (input.dataset.key === key) {
        input.focus();
        return;
      }
    }
  }

  const KEYS: Record<string, Move> = {
    ArrowUp: 'up',
    ArrowDown: 'down',
    ArrowRight: 'right',
    ArrowLeft: 'left',
    Home: 'first',
    End: 'last',
  };

  function keydown(event: KeyboardEvent, node: TreeNode) {
    const direction = KEYS[event.key];
    if (!direction || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    event.preventDefault();
    const result = move(roots, expanded, node.key, direction);
    expanded = result.expanded;
    void focusKey(result.focus);
  }
</script>

{#snippet branch(nodes: TreeNode[])}
  {#each nodes as node (node.key)}
    {@const state = stateOf(node, selected)}
    {@const tally = count(node, selected)}
    {@const isOpen = expanded.has(node.key)}
    <li>
      <div class="flex items-start gap-1" style:padding-inline-start="{node.depth * 1.25}rem">
        {#if node.children.length > 0}
          <button
            type="button"
            class="btn btn-ghost btn-xs btn-square"
            tabindex="-1"
            aria-expanded={isOpen}
            aria-controls="perm-{node.key}"
            aria-label={t(isOpen ? 'profile.tokens.collapse' : 'profile.tokens.expand', {
              name: node.key,
            })}
            onclick={() => open(node.key, !isOpen)}
          >
            <Icon name={isOpen ? 'chevronDown' : 'chevronRight'} size={14} />
          </button>
        {:else}
          <span class="inline-block w-6 shrink-0"></span>
        {/if}
        <label class="flex min-w-0 flex-1 items-start gap-2 py-0.5">
          <input
            type="checkbox"
            class="checkbox checkbox-sm mt-0.5"
            data-key={node.key}
            name={node.children.length > 0 ? undefined : name}
            value={node.permission?.id ?? node.key}
            aria-label={node.key}
            aria-describedby="perm-info-{node.key}"
            tabindex={tabStop === node.key ? 0 : -1}
            checked={state === 'checked'}
            use:partly={state === 'mixed'}
            onfocus={() => (focused = node.key)}
            onchange={() => flip(node)}
            onkeydown={(event) => keydown(event, node)}
          />
          <span id="perm-info-{node.key}" class="flex min-w-0 flex-col">
            <span class="text-sm">
              <code>{node.label}</code>
              {#if node.children.length > 0}
                <span class="badge badge-ghost badge-sm ms-1" data-testid="perm-count"
                  >{t('profile.tokens.count', {
                    selected: tally.selected,
                    total: tally.total,
                  })}</span
                >
              {/if}
            </span>
            {#if node.permission}
              <span class="text-sm opacity-80">{node.permission.description}</span>
            {/if}
          </span>
        </label>
      </div>
      {#if node.children.length > 0}
        <ul id="perm-{node.key}" hidden={!isOpen} class="flex flex-col">
          {#if isOpen}{@render branch(node.children)}{/if}
        </ul>
      {/if}
    </li>
  {/each}
{/snippet}

<ul bind:this={list} class="flex flex-col" data-testid="permission-tree">
  {@render branch(roots)}
</ul>
