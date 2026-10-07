// How the roles page lays out the permissions: one group per module, and the set of a role as a list of
// ids. Plain functions, so the rules are table-driven tests.

/**
 * Module ids that have two parts (`core.identity`, `registry.services`, `kpi.ingestion`). A module id of one
 * part (`maturity`, `backup`) is the first part of its permissions. A permission id is
 * `<module id>.<resource>.<action>`, or `<module id>.<action>`.
 */
const TWO_PART_NAMESPACES = ['core', 'registry', 'kpi'] as const;

/** The module a permission belongs to, by the shape of its id. */
export function moduleOf(permission: string): string {
  const parts = permission.split('.');
  const first = parts[0] ?? permission;
  if ((TWO_PART_NAMESPACES as readonly string[]).includes(first) && parts.length > 1) {
    return `${first}.${parts[1]}`;
  }
  return first;
}

export interface PermissionGroup {
  module: string;
  permissions: string[];
}

/** The permissions in groups by module, modules and permissions sorted, so the page is the same every time. */
export function groupPermissions(permissions: readonly string[]): PermissionGroup[] {
  const groups = new Map<string, string[]>();
  for (const permission of [...new Set(permissions)].sort()) {
    const module = moduleOf(permission);
    groups.set(module, [...(groups.get(module) ?? []), permission]);
  }
  return [...groups]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([module, list]) => ({ module, permissions: list }));
}

/** One permission turned on or off in a role's set; the order stays sorted and nothing repeats. */
export function togglePermission(
  current: readonly string[],
  permission: string,
  on: boolean,
): string[] {
  const rest = current.filter((entry) => entry !== permission);
  return on ? [...rest, permission].sort() : rest;
}

/** A whole group turned on or off. */
export function setGroup(
  current: readonly string[],
  group: readonly string[],
  on: boolean,
): string[] {
  const rest = current.filter((entry) => !group.includes(entry));
  return on ? [...rest, ...group].sort() : rest;
}

/** Whether two sets hold the same permissions, whatever their order. */
export function sameSet(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  const left = new Set(a);
  return b.every((entry) => left.has(entry));
}
