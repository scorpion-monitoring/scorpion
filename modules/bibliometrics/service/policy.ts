// The resource policy of the scoped `bibliometrics.publication.write` (ADR-0056 Decision 4), contributed to the registry
// `authz.resourcePolicy`: an approved member of the service's provider may change its publications. The rule is asked of
// registry.services (`isProviderMemberAsSystem`), which owns the provider links, at EVERY call; nothing is kept, so a
// member who left is refused at the next call. It only adds access; Admin needs no entry.
import { z } from '@scorpion/contracts';
import { PERMISSION_WRITE, RESOURCE_SERVICE } from './permissions.ts';

const isUuid = (value: string) => z.uuid().safeParse(value).success;

export interface WritePolicyDeps {
  /** `registry.services/public`'s read, reached through a function because the service exists only once the module starts. */
  isProviderMember: () => (userId: string, serviceId: string) => Promise<boolean>;
}

export function writePolicy(deps: WritePolicyDeps) {
  return {
    resourceType: RESOURCE_SERVICE,
    async allows(request: {
      actor: { userId: string };
      permission: string;
      resource: { type: string; id?: string | undefined };
    }): Promise<boolean> {
      if (request.permission !== PERMISSION_WRITE) return false;
      if (!request.resource.id || !isUuid(request.resource.id)) return false;
      return deps.isProviderMember()(request.actor.userId, request.resource.id);
    },
  };
}
