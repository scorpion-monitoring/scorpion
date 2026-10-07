import type { Actor } from '@scorpion/contracts';
import type { AuthzService } from '@scorpion/core-authz/public';
import { KernelStartupError, type ModuleContext } from '@scorpion/kernel';
import type { NavEntry, RouteEntry, ThemeEntry, WidgetEntry } from '../registries.ts';

export interface NavigationItem {
  id: string;
  /** A key of the message catalogue. */
  label: string;
  path: string;
  icon?: string;
  section: string;
  order: number;
}

export interface WidgetItem {
  id: string;
  slot: string;
  component: string;
  order: number;
}

export interface Navigation {
  /** The links the caller may see, sections in the order of their first entry, then `order`, then id. */
  nav: NavigationItem[];
  /** The page paths the caller may open, as registered (`/users/:id`): the catch-all route checks against this list. */
  routes: string[];
  /** The dashboard cards the caller may see. */
  widgets: WidgetItem[];
  themes: ThemeEntry[];
}

export interface NavigationService {
  navigation(actor: Actor): Promise<Navigation>;
}

type Gated = { permission?: string; public?: true };

const byOrder = <T extends { order: number; id: string }>(a: T, b: T) =>
  a.order - b.order || a.id.localeCompare(b.id);

/**
 * Builds the service from the registries. A page or link that names a permission no loaded module
 * declares, a path declared twice, or a link to a page nobody registered stops the start: the
 * navigation must not silently hide (or show) something because of a typo.
 */
export function createNavigationService(
  ctx: Pick<ModuleContext, 'registry' | 'permissions'>,
  authz: Pick<AuthzService, 'can'>,
): NavigationService {
  const routes = ctx.registry('ui.routes') as RouteEntry[];
  const nav = ctx.registry('ui.nav') as NavEntry[];
  const widgets = ctx.registry('ui.widget') as WidgetEntry[];
  const themes = ctx.registry('ui.theme') as ThemeEntry[];

  const declared = new Set(ctx.permissions.map((permission) => permission.id));
  const problems: string[] = [];
  const paths = new Set<string>();
  for (const route of routes) {
    if (paths.has(route.path)) problems.push(`page "${route.path}" is registered twice`);
    paths.add(route.path);
  }
  const ids = new Set<string>();
  for (const entry of nav) {
    if (ids.has(entry.id)) problems.push(`navigation entry "${entry.id}" is registered twice`);
    ids.add(entry.id);
    if (!paths.has(entry.path)) {
      problems.push(`navigation entry "${entry.id}" links to "${entry.path}", which is no page`);
    }
  }
  for (const entry of [...routes, ...nav, ...widgets]) {
    if (entry.permission !== undefined && !declared.has(entry.permission)) {
      const name = 'id' in entry ? `entry "${entry.id}"` : `page "${entry.path}"`;
      problems.push(`${name} names permission "${entry.permission}", which no module declares`);
    }
  }
  for (const [list, label] of [
    [widgets, 'widget'],
    [themes, 'theme'],
  ] as const) {
    const seen = new Set<string>();
    for (const entry of list) {
      if (seen.has(entry.id)) problems.push(`${label} "${entry.id}" is registered twice`);
      seen.add(entry.id);
    }
  }
  if (problems.length > 0)
    throw new KernelStartupError('core.ui-shell: invalid UI entries:', problems);

  return {
    async navigation(actor) {
      // One decision per permission and request, however many entries name it, asked together.
      const wanted = new Set<string>();
      for (const entry of [...routes, ...nav, ...widgets]) {
        if (entry.public !== true && entry.permission !== undefined) wanted.add(entry.permission);
      }
      const granted = new Set<string>();
      await Promise.all(
        [...wanted].map(async (permission) => {
          if (await authz.can(actor, permission)) granted.add(permission);
        }),
      );
      const allowed = (entry: Gated): boolean =>
        entry.public === true || granted.has(entry.permission!);

      const openPaths = new Set(routes.filter(allowed).map((route) => route.path));
      const items: NavEntry[] = nav.filter((entry) => openPaths.has(entry.path) && allowed(entry));
      const sectionRank = new Map<string, number>();
      for (const entry of [...items].sort(byOrder)) {
        if (!sectionRank.has(entry.section)) sectionRank.set(entry.section, sectionRank.size);
      }
      const visibleWidgets: WidgetEntry[] = widgets.filter(allowed);

      return {
        nav: items
          .sort(
            (a, b) => sectionRank.get(a.section)! - sectionRank.get(b.section)! || byOrder(a, b),
          )
          .map(({ id, label, path, icon, section, order }) => ({
            id,
            label,
            path,
            ...(icon === undefined ? {} : { icon }),
            section,
            order,
          })),
        routes: [...openPaths].sort(),
        widgets: visibleWidgets
          .sort(byOrder)
          .map(({ id, slot, component, order }) => ({ id, slot, component, order })),
        themes: [...themes],
      };
    },
  };
}
