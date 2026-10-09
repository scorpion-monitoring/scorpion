// The resource policy `organisation.member` (plan §7 item 6, ADR-0034), contributed to the registry
// `authz.resourcePolicy`. It answers per permission and reads the caller's approved membership of the
// organisation from the database on every call: no cache, so a removal or a demotion is seen at the
// next call. It only adds access. The built-in protection of core.authz (nobody decides on their own
// request) runs before it and it cannot undo that.
//
//   permission                               approved manager   approved member
//   membership.view-members                  yes                while the setting is on
//   membership.decide / manage-roles / remove, organisation.read-contact
//                                            yes                no
//   anything else                            no                 no
//
// A requested, rejected or left row grants nothing, and neither does a membership of another
// organisation. `remove` is narrowed further by the service (a manager removes plain members only).
import { z, type UserActor } from '@scorpion/contracts';
import type { Db } from '@scorpion/kernel';
import { and, eq } from 'drizzle-orm';
import { membership } from '../db/schema.ts';
import type { OrganisationsSettings } from '../settings-schema.ts';
import { MANAGER_PERMISSIONS, PERMISSION_VIEW_MEMBERS, RESOURCE_TYPE } from './permissions.ts';

export interface MemberPolicyDeps {
  db: Pick<Db, 'select'>;
  settings: () => Promise<OrganisationsSettings>;
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
      if (permission !== PERMISSION_VIEW_MEMBERS && !MANAGER_PERMISSIONS.has(permission)) {
        return false;
      }
      // A resource without a (valid) id names no organisation; Postgres would throw on a bad uuid.
      if (!resource.id || !isUuid(resource.id)) return false;
      const [row] = await deps.db
        .select({ role: membership.role })
        .from(membership)
        .where(
          and(
            eq(membership.organisationId, resource.id),
            eq(membership.userId, actor.userId),
            eq(membership.state, 'approved'),
          ),
        );
      if (!row) return false;
      if (row.role === 'manager') return true;
      return (
        permission === PERMISSION_VIEW_MEMBERS &&
        (await deps.settings()).membership.membersVisibleToMembers
      );
    },
  };
}
