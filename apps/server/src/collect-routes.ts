// The routes a set of module manifests register, without a database: each module's `routes()` runs with a
// registrar that only collects the route definitions and with stand-ins for the services, which never run.
// For `pnpm openapi:generate` and for the tests that walk the routes of a profile.
import type { AppRoute } from '@scorpion/contracts';
import type { ModuleManifest } from '@scorpion/kernel';

/** Something that can be called, indexed and awaited without doing anything: a service that never runs. */
function standIn(): unknown {
  const target = function () {};
  return new Proxy(target, {
    get: (_, property) => (property === 'then' ? undefined : standIn()),
    apply: () => standIn(),
  });
}

export function collectRoutes(manifests: readonly ModuleManifest[]) {
  const internal: AppRoute[] = [];
  const v1: AppRoute[] = [];
  for (const manifest of manifests) {
    manifest.routes?.(
      {
        internal: (route) => internal.push(route),
        public: (_version, route) => v1.push(route),
        service: () => standIn() as never,
      },
      standIn() as never,
    );
  }
  return { internal, v1 };
}
