import { describe, expect, it } from 'vitest';
import { KernelStartupError } from './errors.ts';
import { resolveOrder, type GraphNode } from './graph.ts';

const node = (id: string, required: string[] = [], optional: string[] = []): GraphNode => ({
  id,
  required,
  optional,
});

function problemsOf(nodes: GraphNode[]): readonly string[] {
  try {
    resolveOrder('p', nodes);
  } catch (error) {
    if (error instanceof KernelStartupError) return error.problems;
    throw error;
  }
  throw new Error('expected resolveOrder to throw');
}

describe('resolveOrder', () => {
  const orders: [string, GraphNode[], string[]][] = [
    ['empty', [], []],
    ['one module', [node('a')], ['a']],
    ['independent modules are ordered by id', [node('c'), node('a'), node('b')], ['a', 'b', 'c']],
    ['a dependency comes first', [node('a', ['b']), node('b')], ['b', 'a']],
    ['a chain', [node('a', ['b']), node('b', ['c']), node('c')], ['c', 'b', 'a']],
    [
      'a diamond',
      [
        node('top', ['left', 'right']),
        node('left', ['base']),
        node('right', ['base']),
        node('base'),
      ],
      ['base', 'left', 'right', 'top'],
    ],
    [
      'an optional dependency that is present counts',
      [node('a', [], ['b']), node('b')],
      ['b', 'a'],
    ],
    ['an optional dependency that is absent is ignored', [node('a', [], ['zzz'])], ['a']],
  ];

  it.each(orders)('%s', (_name, nodes, expected) => {
    expect(resolveOrder('p', nodes)).toEqual(expected);
  });

  it('gives the same order whatever the input order', () => {
    const nodes = [node('a', ['b']), node('b', ['c']), node('c'), node('d', ['a'])];
    expect(resolveOrder('p', [...nodes].reverse())).toEqual(resolveOrder('p', nodes));
  });

  const failures: [string, GraphNode[], string[]][] = [
    [
      'a missing dependency names the path and the profile',
      [node('kpi.ingestion', ['kpi.framework'])],
      ['kpi.ingestion → kpi.framework (not in profile "p")'],
    ],
    [
      'every missing dependency is reported',
      [node('a', ['x', 'y']), node('b', ['x'])],
      ['a → x (not in profile "p")', 'a → y (not in profile "p")', 'b → x (not in profile "p")'],
    ],
    ['a self dependency is a cycle', [node('a', ['a'])], ['dependency cycle: a → a']],
    ['a two-module cycle', [node('a', ['b']), node('b', ['a'])], ['dependency cycle: a → b → a']],
    [
      'a longer cycle is named in full, without the modules leading into it',
      [node('entry', ['a']), node('a', ['b']), node('b', ['c']), node('c', ['a'])],
      ['dependency cycle: a → b → c → a'],
    ],
    [
      'a cycle through an optional dependency is still a cycle',
      [node('a', [], ['b']), node('b', ['a'])],
      ['dependency cycle: a → b → a'],
    ],
    [
      'two separate cycles are both reported',
      [node('a', ['b']), node('b', ['a']), node('c', ['d']), node('d', ['c'])],
      ['dependency cycle: a → b → a', 'dependency cycle: c → d → c'],
    ],
  ];

  it.each(failures)('%s', (_name, nodes, expected) => {
    expect(problemsOf(nodes)).toEqual(expected);
  });

  it('puts the problems in the message', () => {
    expect(() => resolveOrder('kpi-tracker', [node('a', ['b'])])).toThrowError(
      /Cannot resolve profile "kpi-tracker"[\s\S]*a → b \(not in profile "kpi-tracker"\)/,
    );
  });
});
