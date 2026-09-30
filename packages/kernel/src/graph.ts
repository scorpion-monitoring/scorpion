import { KernelStartupError } from './errors.ts';

export interface GraphNode {
  id: string;
  required: readonly string[];
  optional: readonly string[];
}

/**
 * Orders the nodes so that every module comes after its dependencies. Optional dependencies
 * count only if they are in the graph. Ties are broken by id, so the order is deterministic.
 *
 * Throws a `KernelStartupError` naming each missing dependency
 * (`kpi.ingestion → kpi.framework (not in profile "kpi-tracker")`) and each cycle
 * (`a → b → a`).
 */
export function resolveOrder(profileName: string, nodes: readonly GraphNode[]): string[] {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const problems: string[] = [];

  for (const node of [...nodes].sort((a, b) => a.id.localeCompare(b.id))) {
    for (const dependency of node.required) {
      if (!byId.has(dependency)) {
        problems.push(`${node.id} → ${dependency} (not in profile "${profileName}")`);
      }
    }
  }

  const edges = (node: GraphNode) =>
    [...node.required, ...node.optional].filter((id) => byId.has(id)).sort();

  // Depth-first search: `visiting` is the current path, so meeting a node on it is a cycle.
  const order: string[] = [];
  const done = new Set<string>();
  const path: string[] = [];
  const reported = new Set<string>();

  function visit(id: string): void {
    if (done.has(id)) return;
    const at = path.indexOf(id);
    if (at !== -1) {
      const cycle = path.slice(at);
      // Report each cycle once, however it is entered.
      const key = [...cycle].sort().join(',');
      if (!reported.has(key)) {
        reported.add(key);
        problems.push(`dependency cycle: ${[...cycle, id].join(' → ')}`);
      }
      return;
    }
    path.push(id);
    for (const dependency of edges(byId.get(id)!)) visit(dependency);
    path.pop();
    done.add(id);
    order.push(id);
  }

  for (const id of [...byId.keys()].sort()) visit(id);

  if (problems.length > 0) {
    throw new KernelStartupError(`Cannot resolve profile "${profileName}":`, problems);
  }
  return order;
}
