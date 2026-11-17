import { describe, expect, it } from 'vitest';
import {
  buildTree,
  count,
  move,
  openForSelection,
  parentKey,
  stateOf,
  toggle,
  visibleNodes,
  type Move,
  type TreeNode,
} from './permission-tree.ts';

const perm = (id: string) => ({ id, description: `Does ${id}` });
const PERMISSIONS = [
  'registry.services.service.read',
  'registry.services.service.write',
  'registry.services.provider.read',
  'registry.organisations.read',
  'kpi.impact.read',
  'kpi.read',
  'kpi.read.all',
  'identity.token.manage',
].map(perm);
const ALL = PERMISSIONS.map((p) => p.id);
const tree = buildTree(PERMISSIONS);
const find = (key: string): TreeNode => {
  const search = (nodes: TreeNode[]): TreeNode | undefined => {
    for (const node of nodes) {
      if (node.key === key) return node;
      const inner = search(node.children);
      if (inner) return inner;
    }
    return undefined;
  };
  const node = search(tree);
  if (!node) throw new Error(`no node ${key}`);
  return node;
};

describe('buildTree', () => {
  it('makes one node per dotted segment, sorted by label', () => {
    expect(tree.map((node) => node.label)).toEqual(['identity', 'kpi', 'registry']);
    expect(find('registry').children.map((node) => node.key)).toEqual([
      'registry.organisations',
      'registry.services',
    ]);
    expect(find('registry.services.service').children.map((node) => node.label)).toEqual([
      'read',
      'write',
    ]);
  });

  it('gives every node the ids at and below it', () => {
    expect(find('registry').ids).toEqual(ALL.filter((id) => id.startsWith('registry.')).sort());
    expect(find('registry.services.service.read').ids).toEqual(['registry.services.service.read']);
  });

  it('lets a node be a permission and have children', () => {
    const node = find('kpi.read');
    expect(node.permission?.id).toBe('kpi.read');
    expect(node.children.map((child) => child.key)).toEqual(['kpi.read.all']);
    expect(node.ids).toEqual(['kpi.read', 'kpi.read.all']);
  });

  it('ignores a repeated id and an empty id', () => {
    const again = buildTree([perm('a.b'), perm('a.b'), perm('')]);
    expect(again).toHaveLength(1);
    expect(again[0]!.ids).toEqual(['a.b']);
  });

  it('is empty for no permissions', () => {
    expect(buildTree([])).toEqual([]);
  });
});

describe('state and count', () => {
  const cases: [string, string[], 'checked' | 'mixed' | 'unchecked', number, number][] = [
    ['registry', [], 'unchecked', 0, 4],
    ['registry', ['registry.organisations.read'], 'mixed', 1, 4],
    ['registry', ALL.filter((id) => id.startsWith('registry.')), 'checked', 4, 4],
    ['registry.services.service', ['registry.services.service.read'], 'mixed', 1, 2],
    ['registry.services.service.read', ['registry.services.service.read'], 'checked', 1, 1],
    ['kpi.read', ['kpi.read.all'], 'mixed', 1, 2],
    ['identity', ['kpi.read'], 'unchecked', 0, 1],
  ];
  it.each(cases)('%s with %j is %s (%i of %i)', (key, selected, state, chosen, total) => {
    const set = new Set(selected);
    expect(stateOf(find(key), set)).toBe(state);
    expect(count(find(key), set)).toEqual({ selected: chosen, total });
  });
});

describe('toggle', () => {
  const cases: [string, string[], string[]][] = [
    // unchecked selects every leaf below
    [
      'registry.services.service',
      [],
      ['registry.services.service.read', 'registry.services.service.write'],
    ],
    // partly selected selects all
    [
      'registry.services.service',
      ['registry.services.service.read'],
      ['registry.services.service.read', 'registry.services.service.write'],
    ],
    // fully selected clears all and keeps the rest
    [
      'registry.services.service',
      ['registry.services.service.read', 'registry.services.service.write', 'kpi.read'],
      ['kpi.read'],
    ],
    // a leaf toggles itself
    ['kpi.impact.read', ['kpi.read'], ['kpi.read', 'kpi.impact.read']],
    ['kpi.impact.read', ['kpi.impact.read'], []],
  ];
  it.each(cases)('%s from %j gives %j (in the order of the list)', (key, from, expected) => {
    const result = toggle(find(key), from, ALL);
    expect(new Set(result)).toEqual(new Set(expected));
    expect(result).toEqual(ALL.filter((id) => expected.includes(id)));
  });

  it('keeps an id it does not know out of the result', () => {
    expect(toggle(find('kpi.impact'), ['gone.away'], ALL)).toEqual(['kpi.impact.read']);
  });

  it('never selects a parent that is not a permission, only the ids below it', () => {
    const result = toggle(find('registry'), [], ALL);
    expect(result.every((id) => ALL.includes(id))).toBe(true);
    expect(result).not.toContain('registry');
  });
});

describe('visibleNodes and move', () => {
  it('shows only the top level while nothing is open', () => {
    expect(visibleNodes(tree, new Set()).map((node) => node.key)).toEqual([
      'identity',
      'kpi',
      'registry',
    ]);
  });

  it('shows the children of an open node, in order', () => {
    expect(visibleNodes(tree, new Set(['kpi', 'kpi.read'])).map((node) => node.key)).toEqual([
      'identity',
      'kpi',
      'kpi.impact',
      'kpi.read',
      'kpi.read.all',
      'registry',
    ]);
  });

  const closed = new Set<string>();
  const open = new Set(['kpi', 'kpi.read']);
  const cases: [string, Set<string>, string, Move, string, string[]][] = [
    ['down from the first', closed, 'identity', 'down', 'kpi', []],
    ['up from the first stays', closed, 'identity', 'up', 'identity', []],
    ['down from the last stays', closed, 'registry', 'down', 'registry', []],
    ['first', closed, 'registry', 'first', 'identity', []],
    ['last', closed, 'identity', 'last', 'registry', []],
    ['right opens a closed node', closed, 'kpi', 'right', 'kpi', ['kpi']],
    ['right enters an open node', new Set(['kpi']), 'kpi', 'right', 'kpi.impact', ['kpi']],
    ['right on a leaf stays', open, 'kpi.read.all', 'right', 'kpi.read.all', ['kpi', 'kpi.read']],
    ['left closes an open node', open, 'kpi.read', 'left', 'kpi.read', ['kpi']],
    [
      'left on a leaf goes to the parent',
      open,
      'kpi.read.all',
      'left',
      'kpi.read',
      ['kpi', 'kpi.read'],
    ],
    ['left on a closed top node stays', closed, 'kpi', 'left', 'kpi', []],
    ['an unknown key goes to the first node', closed, 'nope', 'down', 'identity', []],
  ];
  it.each(cases)('%s', (_name, expanded, from, direction, focus, opened) => {
    const result = move(tree, expanded, from, direction);
    expect(result.focus).toBe(focus);
    expect([...result.expanded].sort()).toEqual([...opened].sort());
  });

  it('does not change the set it was given', () => {
    const input = new Set<string>();
    move(tree, input, 'kpi', 'right');
    expect(input.size).toBe(0);
  });
});

describe('parentKey and openForSelection', () => {
  it('names the parent of a key', () => {
    expect(parentKey('kpi.impact.read')).toBe('kpi.impact');
    expect(parentKey('kpi')).toBeUndefined();
  });

  it('opens the nodes that hold a selected permission', () => {
    expect([...openForSelection(tree, new Set(['kpi.read.all']))].sort()).toEqual([
      'kpi',
      'kpi.read',
    ]);
    expect(openForSelection(tree, new Set()).size).toBe(0);
  });
});
