// The permissions of a token as a tree per dotted segment (`kpi.impact.read` is `kpi` > `impact` > `read`). Everything
// here is pure: the component draws what these functions say. The stored value stays the flat list of ids, so the API
// and the form value do not change.

export interface PermissionLike {
  id: string;
  description: string;
}

export interface TreeNode {
  /** The dotted path of the node (`kpi.impact`); unique, and the id of the permission for a leaf. */
  key: string;
  /** The last segment, shown as the label. */
  label: string;
  depth: number;
  /** The permission of this exact path, when there is one (a node can be a permission and have children). */
  permission?: PermissionLike;
  children: TreeNode[];
  /** Every permission id at this node and below it, sorted. */
  ids: string[];
}

export type CheckState = 'checked' | 'mixed' | 'unchecked';

/** Builds the tree from the permissions. Siblings are sorted by label; an id that appears twice counts once. */
export function buildTree(permissions: readonly PermissionLike[]): TreeNode[] {
  const roots: TreeNode[] = [];
  const seen = new Set<string>();
  for (const permission of permissions) {
    if (seen.has(permission.id) || permission.id === '') continue;
    seen.add(permission.id);
    const segments = permission.id.split('.').filter((segment) => segment !== '');
    let level = roots;
    let key = '';
    segments.forEach((segment, index) => {
      key = key === '' ? segment : `${key}.${segment}`;
      let node = level.find((candidate) => candidate.key === key);
      if (!node) {
        node = { key, label: segment, depth: index, children: [], ids: [] };
        level.push(node);
      }
      node.ids.push(permission.id);
      if (index === segments.length - 1) node.permission = permission;
      level = node.children;
    });
  }
  const sort = (nodes: TreeNode[]) => {
    nodes.sort((a, b) => a.label.localeCompare(b.label, 'en'));
    for (const node of nodes) {
      node.ids.sort();
      sort(node.children);
    }
  };
  sort(roots);
  return roots;
}

/** How many of the permissions at and below the node are selected, and how many there are. */
export function count(
  node: TreeNode,
  selected: ReadonlySet<string>,
): { selected: number; total: number } {
  let chosen = 0;
  for (const id of node.ids) if (selected.has(id)) chosen += 1;
  return { selected: chosen, total: node.ids.length };
}

export function stateOf(node: TreeNode, selected: ReadonlySet<string>): CheckState {
  const { selected: chosen, total } = count(node, selected);
  if (chosen === 0) return 'unchecked';
  return chosen === total ? 'checked' : 'mixed';
}

/**
 * The selection after a click or space on a node: everything below it is selected unless it all is already, then
 * everything below it is cleared (so a partly selected parent selects all). Ids outside the node stay as they were;
 * the result keeps the order of `all` and has no duplicates.
 */
export function toggle(
  node: TreeNode,
  selected: readonly string[],
  all: readonly string[],
): string[] {
  const current = new Set(selected);
  const next = new Set(current);
  if (stateOf(node, current) === 'checked') for (const id of node.ids) next.delete(id);
  else for (const id of node.ids) next.add(id);
  return all.filter((id) => next.has(id));
}

/** The nodes that are visible, in order, when only the keys in `expanded` are open. */
export function visibleNodes(
  roots: readonly TreeNode[],
  expanded: ReadonlySet<string>,
): TreeNode[] {
  const out: TreeNode[] = [];
  const walk = (nodes: readonly TreeNode[]) => {
    for (const node of nodes) {
      out.push(node);
      if (node.children.length > 0 && expanded.has(node.key)) walk(node.children);
    }
  };
  walk(roots);
  return out;
}

export type Move = 'up' | 'down' | 'first' | 'last' | 'right' | 'left';

/**
 * Where the focus goes for an arrow key (the WAI-ARIA tree pattern): up and down move through the visible nodes, right
 * opens a closed node and then enters it, left closes an open node and then goes to its parent. Returns the key to focus
 * and the new set of open keys.
 */
export function move(
  roots: readonly TreeNode[],
  expanded: ReadonlySet<string>,
  from: string,
  direction: Move,
): { focus: string; expanded: Set<string> } {
  const visible = visibleNodes(roots, expanded);
  const index = visible.findIndex((node) => node.key === from);
  const open = new Set(expanded);
  if (index < 0) return { focus: visible[0]?.key ?? from, expanded: open };
  const node = visible[index]!;
  switch (direction) {
    case 'up':
      return { focus: visible[Math.max(0, index - 1)]!.key, expanded: open };
    case 'down':
      return { focus: visible[Math.min(visible.length - 1, index + 1)]!.key, expanded: open };
    case 'first':
      return { focus: visible[0]!.key, expanded: open };
    case 'last':
      return { focus: visible[visible.length - 1]!.key, expanded: open };
    case 'right': {
      if (node.children.length === 0) return { focus: from, expanded: open };
      if (!open.has(node.key)) {
        open.add(node.key);
        return { focus: from, expanded: open };
      }
      return { focus: node.children[0]!.key, expanded: open };
    }
    case 'left': {
      if (node.children.length > 0 && open.has(node.key)) {
        open.delete(node.key);
        return { focus: from, expanded: open };
      }
      const parent = parentKey(node.key);
      return { focus: parent ?? from, expanded: open };
    }
  }
}

/** The key of the parent (`kpi.impact` for `kpi.impact.read`), or undefined for a top-level node. */
export function parentKey(key: string): string | undefined {
  const cut = key.lastIndexOf('.');
  return cut < 0 ? undefined : key.slice(0, cut);
}

/** The keys that must be open so that every selected permission is visible (shown after an earlier selection). */
export function openForSelection(
  roots: readonly TreeNode[],
  selected: ReadonlySet<string>,
): Set<string> {
  const open = new Set<string>();
  const walk = (nodes: readonly TreeNode[]) => {
    for (const node of nodes) {
      if (node.children.length > 0 && node.ids.some((id) => selected.has(id))) open.add(node.key);
      walk(node.children);
    }
  };
  walk(roots);
  return open;
}
