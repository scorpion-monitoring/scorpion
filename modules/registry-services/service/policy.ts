// The resource policy `service.member` (ADR-0036), contributed to the registry `authz.resourcePolicy`.
// It loads the service's provider and asks registry.organisations at EVERY call: nothing is cached, so a
// removal or a demotion is seen at the next call. It only adds access; it never overrides the built-in
// protections of core.authz.
//
//   permission                                 approved manager   approved member
//   service.edit, service.read-contact         yes                yes
//   service.edit-identity                      yes                no
//   anything else                              no                 no
//
// A requested, rejected or left row grants nothing, and neither does a membership of another organisation
// than the service's provider. Which fields `edit` and `edit-identity` cover is the field-rules table
// (`field-rules.ts`), and a move of the provider is narrowed further by the service.
import { z, type UserActor } from '@scorpion/contracts';
import type { Db } from '@scorpion/kernel';
import type { OrganisationsPublic } from '@scorpion/registry-organisations/public';
import { and, eq } from 'drizzle-orm';
import { serviceOrganisation } from '../db/schema.ts';
import {
  MANAGER_PERMISSIONS,
  MEMBER_PERMISSIONS,
  OWNER_ROLE,
  RESOURCE_TYPE,
} from './permissions.ts';

export interface MemberPolicyDeps {
  db: Pick<Db, 'select'>;
  organisations: Pick<OrganisationsPublic, 'isApprovedMemberAsSystem' | 'isManagerAsSystem'>;
}

export interface MemberPolicyRequest {
  actor: UserActor;
  permission: string;
  resource: { type: string; id?: string | undefined };
}

export interface MemberPolicy {
  resourceType: typeof RESOURCE_TYPE;
  allows: (request: MemberPolicyRequest) => Promise<boolean>;
}

const isUuid = (value: string) => z.uuid().safeParse(value).success;

export function createMemberPolicy(deps: MemberPolicyDeps): MemberPolicy {
  return {
    resourceType: RESOURCE_TYPE,
    async allows({ actor, permission, resource }) {
      // A permission this policy does not know grants nothing, so a later one has to be added here.
      const manager = MANAGER_PERMISSIONS.has(permission);
      if (!manager && !MEMBER_PERMISSIONS.has(permission)) return false;
      // A resource without a (valid) id names no service; Postgres would throw on a bad uuid.
      if (!resource.id || !isUuid(resource.id)) return false;
      const providers = await deps.db
        .select({ organisationId: serviceOrganisation.organisationId })
        .from(serviceOrganisation)
        .where(
          and(
            eq(serviceOrganisation.serviceId, resource.id),
            eq(serviceOrganisation.role, OWNER_ROLE),
          ),
        );
      for (const { organisationId } of providers) {
        const holds = manager
          ? await deps.organisations.isManagerAsSystem(actor.userId, organisationId)
          : await deps.organisations.isApprovedMemberAsSystem(actor.userId, organisationId);
        if (holds) return true;
      }
      return false;
    },
  };
}
