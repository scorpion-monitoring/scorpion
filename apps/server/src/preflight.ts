// The CORS step with the methods of the path asked about (M10 sprint 2). `cors()` answers a preflight with one list of methods; given the
// methods of the whole v1 surface, `OPTIONS /api/v1/providers` would claim `POST` the day `POST /api/v1/measurements` exists. This builds
// one `cors()` per distinct list of methods and picks by the path: the methods of the routes whose path matches, else (a path no route has)
// the methods of the whole surface, as before. It lives beside `app.ts` and changes nothing in `pipeline/`: `cors()` is used as it is.
import type { MiddlewareHandler } from 'hono';
import type { AppEnv } from '@scorpion/contracts';
import { cors, type CorsOptions } from './pipeline/cors.ts';

/** A route as the preflight needs it: the method and the full path (with the base path and `/api/v1`, `{param}` for a parameter). */
export interface PreflightRoute {
  method: string;
  path: string;
}

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The methods of the routes whose path `path` matches, upper case, sorted; empty when none does. Pure. */
export function methodsForPath(routes: readonly PreflightRoute[], path: string): string[] {
  const found = new Set<string>();
  for (const route of routes) {
    const pattern = new RegExp(
      `^${route.path
        .split(/\{\w+\}/)
        .map(escapeRegExp)
        .join('[^/]+')}/?$`,
    );
    if (pattern.test(path)) found.add(route.method.toUpperCase());
  }
  return [...found].sort();
}

export function preflightCors(
  options: Omit<CorsOptions, 'methods'>,
  routes: readonly PreflightRoute[],
): MiddlewareHandler<AppEnv> {
  const all = [...new Set(routes.map((route) => route.method.toUpperCase()))].sort();
  const instances = new Map<string, MiddlewareHandler<AppEnv>>();
  const instanceFor = (methods: readonly string[]) => {
    const key = methods.join(',');
    let instance = instances.get(key);
    if (!instance) {
      instance = cors({ ...options, methods });
      instances.set(key, instance);
    }
    return instance;
  };
  return (c, next) => {
    const own = methodsForPath(routes, c.req.path);
    return instanceFor(own.length > 0 ? own : all)(c, next);
  };
}
