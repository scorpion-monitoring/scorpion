// How the roles page lays out the permissions: one group per declaring module (as the API says, not guessed from
// the id), and the set of a role as a list of ids. Plain functions, so the rules are table-driven tests.

/** A permission as `GET /permissions` lists it. */
export interface PermissionInfo {
  id: string;
  /** The id of the module that declares it. */
  module: string;
  description: string;
}

export interface PermissionGroup {
  module: string;
  permissions: PermissionInfo[];
}

/** The permissions in groups by their declaring module, modules and permissions sorted, so the page is the same every time. */
export function groupPermissions(permissions: readonly PermissionInfo[]): PermissionGroup[] {
  const groups = new Map<string, PermissionInfo[]>();
  const seen = new Set<string>();
  for (const permission of [...permissions].sort((a, b) => a.id.localeCompare(b.id))) {
    if (seen.has(permission.id)) continue;
    seen.add(permission.id);
    groups.set(permission.module, [...(groups.get(permission.module) ?? []), permission]);
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
