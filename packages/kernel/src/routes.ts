// Loader step 6 (routes): each module's `routes(r, ctx)` registers its routes here. Registration
// is where a route is checked: it needs a permission of its own module, or `public: true` with a
// reason.
import {
  checkRouteAccess,
  describeRoute,
  type AnyHandler,
  type AppRoute,
} from '@scorpion/contracts';
import type { ModuleContext } from './context.ts';
import { KernelStartupError } from './errors.ts';
import type { RouteRegistrar } from './manifest.ts';
import type { ResolvedModule } from './resolve.ts';

export type RouteSurface = 'internal' | 'v1';

export interface RegisteredRoute {
  module: string;
  surface: RouteSurface;
  route: AppRoute;
  handler: AnyHandler;
}

/** Runs `routes()` of every module in order and returns all routes, or throws with every problem. */
export function collectRoutes(
  modules: readonly ResolvedModule[],
  contextFor: (module: ResolvedModule) => ModuleContext,
  serviceOf: (moduleId: string) => unknown,
): RegisteredRoute[] {
  const registered: RegisteredRoute[] = [];
  const problems: string[] = [];
  const taken = new Map<string, string>();

  for (const module of modules) {
    if (!module.manifest.routes) continue;
    const declared = new Set(Object.keys(module.manifest.permissions ?? {}));
    let open = true;

    const add = (surface: RouteSurface, route: AppRoute, handler: AnyHandler) => {
      if (!open)
        throw new KernelStartupError(`Module "${module.id}" registered a route too late:`, [
          'routes() has returned',
        ]);
      const name = describeRoute(route);
      const fail = (what: string) => problems.push(`${module.id}: ${name} ${what}`);
      const access = checkRouteAccess(route, declared);
      if (access) fail(access);
      if (typeof route.path !== 'string' || !route.path.startsWith('/'))
        fail('has a path that does not start with "/"');
      if (typeof handler !== 'function') fail('has no handler');
      const key = `${surface} ${name}`;
      const owner = taken.get(key);
      if (owner) fail(`is already registered by ${owner} on the ${surface} surface`);
      else taken.set(key, module.id);
      registered.push({ module: module.id, surface, route, handler });
    };

    const registrar: RouteRegistrar = {
      internal: (route, handler) => add('internal', route, handler),
      public: (version, route, handler) => add(version, route, handler),
      service: <T>() => serviceOf(module.id) as T,
    };
    try {
      module.manifest.routes(registrar, contextFor(module));
    } finally {
      open = false;
    }
  }

  if (problems.length > 0) throw new KernelStartupError('Cannot register routes:', problems);
  return registered;
}
