// How the sidebar reads the registered `ui.nav` entries: which one is the current page, and which entries are drawn
// under which. Both come from the paths alone (no field of the entry says so), so a module that registers
// `/admin/users` and `/admin/users/pending` gets the hierarchy and the single highlight without asking for either.

export interface NavLike {
  id: string;
  path: string;
  section: string;
}

/** Whether `path` lies strictly below `parent`, at a segment boundary (`/admin/users/pending` below `/admin/users`). */
export const isBelow = (path: string, parent: string): boolean =>
  parent !== '/' && path.startsWith(`${parent}/`);

/**
 * The id of the one entry that is current on the page registered as `pattern` (`/admin/users/:id`): the entry whose
 * path is the page itself or the longest path above it. `/admin/users` is not current on `/admin/users/pending` when
 * that has an entry of its own; it still is on `/admin/users/:id`.
 */
export function currentId(
  items: readonly NavLike[],
  pattern: string | undefined,
): string | undefined {
  if (pattern === undefined) return undefined;
  let best: NavLike | undefined;
  for (const item of items) {
    const matches = item.path === pattern || isBelow(pattern, item.path);
    if (matches && (best === undefined || item.path.length > best.path.length)) best = item;
  }
  return best?.id;
}

export interface Row<T extends NavLike> {
  item: T;
  /** 0 for an entry that lies below no other entry of its section. */
  depth: number;
}

/**
 * The entries of one section in drawing order: an entry whose path lies below another entry's path (in the same
 * section) comes right after that entry, one level deeper; the order of the input is kept among siblings. The nearest
 * ancestor is the parent, so `/a`, `/a/b`, `/a/b/c` are three levels.
 */
export function rowsOf<T extends NavLike>(items: readonly T[]): Row<T>[] {
  const parentOf = new Map<string, T>();
  for (const item of items) {
    let parent: T | undefined;
    for (const other of items) {
      if (other.id !== item.id && isBelow(item.path, other.path)) {
        if (parent === undefined || other.path.length > parent.path.length) parent = other;
      }
    }
    if (parent) parentOf.set(item.id, parent);
  }
  const out: Row<T>[] = [];
  const place = (item: T, depth: number) => {
    out.push({ item, depth });
    for (const child of items) if (parentOf.get(child.id)?.id === item.id) place(child, depth + 1);
  };
  for (const item of items) if (!parentOf.has(item.id)) place(item, 0);
  return out;
}
