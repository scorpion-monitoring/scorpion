// The resource policy of the scoped permission `kpi.ingestion.measurement.submit` (ADR-0041 Decision 4), contributed to the
// registry `authz.resourcePolicy`: an approved member of the service's provider may submit measurements for it. The rule
// is asked of registry.services (`isProviderMemberAsSystem`), which owns the provider links, so it is written once. It asks
// at EVERY call and keeps nothing, so a removed or left member is refused at the next call. It only adds access and grants
// no other permission; Admin needs no entry (core.authz resolves every declared permission for the role).
import { z } from '@scorpion/contracts';
import { PERMISSION_SUBMIT, RESOURCE_SERVICE } from './permissions.ts';

const isUuid = (value: string) => z.uuid().safeParse(value).success;

export interface SubmitPolicyDeps {
  /** `registry.services/public`'s read, reached through a function because the service exists only once the module starts. */
  isProviderMember: () => (userId: string, serviceId: string) => Promise<boolean>;
}

export function submitPolicy(deps: SubmitPolicyDeps) {
  return {
    resourceType: RESOURCE_SERVICE,
    async allows(request: {
      actor: { userId: string };
      permission: string;
      resource: { type: string; id?: string | undefined };
    }): Promise<boolean> {
      if (request.permission !== PERMISSION_SUBMIT) return false;
      // A resource without a (valid) id names no service; the read would only say no.
      if (!request.resource.id || !isUuid(request.resource.id)) return false;
      return deps.isProviderMember()(request.actor.userId, request.resource.id);
    },
  };
}
