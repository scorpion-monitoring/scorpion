import type { Actor } from '@scorpion/contracts';
import type { AuthzService } from '@scorpion/core-authz/public';
import type { InstanceInfo, ModuleContext } from '@scorpion/kernel';

export const PERMISSION_ABOUT_READ = 'core.ui-shell.about.read';

export interface AboutView {
  profile: string;
  version: string;
  /** In module order, dependencies first. */
  modules: { id: string; displayName: string; version: string; kind: 'core' | 'optional' }[];
}

export interface AboutService {
  /** Which profile this instance runs, its Scorpion version and its modules (ADR-0045). Needs `core.ui-shell.about.read`. */
  about(actor: Actor): Promise<AboutView>;
}

/**
 * What the page tells: the profile, the product version and the modules, taken from `ctx.instance`. Nothing else leaves
 * this service: no setting, no environment value, no version of a dependency (ADR-0045).
 */
export function createAboutService(
  ctx: Pick<ModuleContext, 'instance'>,
  authz: Pick<AuthzService, 'require'>,
): AboutService {
  const instance: InstanceInfo = ctx.instance;
  return {
    async about(actor) {
      await authz.require(actor, PERMISSION_ABOUT_READ);
      return {
        profile: instance.profile,
        version: instance.version,
        modules: instance.modules.map(({ id, displayName, version, kind }) => ({
          id,
          displayName,
          version,
          kind,
        })),
      };
    },
  };
}
